import { randomUUID } from "node:crypto";
import { Effect } from "effect";
import {
  ductsReadingSchema,
  readingKey,
  type DuctsReadingRequest,
  type DuctsReadingEnvelope,
} from "@pe/agent-contracts";
import { BridgeError, type HostBridgeEvent, type RevitBridge } from "./bridge.ts";
import { InvalidRead } from "./native-reads.ts";
import type { DoorFailure } from "@pe/host-internal/request-contracts";

export type NativeResult = Effect.Success<ReturnType<RevitBridge["Service"]["invoke"]>>;
export type DuctsBody = {
  json: string;
  version: string;
  nativeRequestId: string;
  target: NativeResult["target"];
  nativeTakingId?: string;
};
export type DuctsReadOptions = {
  version?: string;
  refresh?: string;
  /** Decoded host source evidence, never an HTTP version header. */
  source?: { readonly revision?: string; readonly beforeReady?: (body: DuctsBody) => Effect.Effect<void, DoorFailure> };
};
type Entry = {
  request: DuctsReadingRequest;
  envelope: DuctsReadingEnvelope;
  listeners: Set<(value: DuctsReadingEnvelope) => void>;
  body?: DuctsBody;
  bytes: number;
  used: number;
  readers: number;
};
const refused = (message: string) => new InvalidRead({ message, status: 409, problem: "read.retained" });
const identity = (request: DuctsReadingRequest) =>
  request.kind === "ducts-snapshot"
    ? { target: request.target, session: request.target.session }
    : { target: null, session: request.session };

export const ductsSubject = (raw: DuctsReadingRequest): DuctsReadingRequest => {
  const parsed = ductsReadingSchema.parse(raw);
  return parsed.kind === "ducts-snapshot" && parsed.slots && !Object.keys(parsed.slots).length
    ? { ...parsed, slots: undefined } : parsed;
};

/** Only Ducts acquisition is retained. Immutable JSON is bounded by both subjects and UTF-8 bytes. */
export class DuctsReadings {
  private readonly entries = new Map<string, Entry>();
  private bytes = 0;
  constructor(
    private readonly limits: { entries: number; bytes: number; idleMs: number } = {
      entries: 16,
      bytes: 256 * 1024 * 1024,
      idleMs: 900_000,
    },
  ) {}

  private entry(raw: DuctsReadingRequest): Entry {
    const request = ductsSubject(raw);
    const key = readingKey(request);
    const existing = this.entries.get(key);
    if (existing) {
      existing.used = Date.now();
      return existing;
    }
    for (const [key, entry] of this.entries)
      if (!entry.listeners.size && !entry.readers && Date.now() - entry.used > this.limits.idleMs)
        this.drop(key, entry);
    while (this.entries.size >= this.limits.entries)
      if (!this.evict())
        throw refused("Shared Ducts reading capacity is occupied; retry after a reader leaves");
    const entry: Entry = {
      request,
      envelope: { revision: randomUUID(), version: null, state: "idle", ...identity(request) },
      listeners: new Set(),
      bytes: 0,
      used: Date.now(),
      readers: 0,
    };
    this.entries.set(key, entry);
    return entry;
  }
  private drop(key: string, entry: Entry) {
    this.bytes -= entry.bytes;
    this.entries.delete(key);
  }
  private evict(except?: Entry): boolean {
    const candidate = [...this.entries]
      .filter(([, entry]) => entry !== except && !entry.readers && !entry.listeners.size)
      .sort((a, b) => a[1].used - b[1].used)[0];
    if (!candidate) return false;
    this.drop(...candidate);
    return true;
  }
  private publish(entry: Entry) {
    for (const listener of entry.listeners) listener(entry.envelope);
  }
  private invalidate(entry: Entry, state: "stale" | "closed" | "failed" = "stale", error?: string) {
    this.bytes -= entry.bytes;
    entry.bytes = 0;
    entry.body = undefined;
    entry.envelope = {
      revision: randomUUID(),
      version: null,
      state,
      ...identity(entry.request),
      ...(error ? { error } : {}),
    };
    this.publish(entry);
  }
  observe(
    request: DuctsReadingRequest,
    listener: (value: DuctsReadingEnvelope) => void,
  ): () => void {
    const entry = this.entry(request);
    entry.listeners.add(listener);
    listener(entry.envelope);
    return () => {
      entry.listeners.delete(listener);
      entry.used = Date.now();
    };
  }
  /** An explicit refresh retires retained bodies before its semantic receipt is published. */
  refresh(target: { session: string; openId: string }): void {
    for (const entry of this.entries.values()) {
      const scope = identity(entry.request);
      if (
        scope.session === target.session &&
        (!scope.target || scope.target.openId === target.openId)
      )
        this.invalidate(entry);
    }
  }
  /** Called synchronously by the bridge tap, before another response can publish. */
  changed(event: HostBridgeEvent): void {
    let changed: unknown;
    if (event.kind === "event" && event.eventName === "document-changed") {
      try {
        changed = JSON.parse(event.payloadJson ?? "{}").changedOpenIds;
      } catch {
        changed = null;
      }
    }
    for (const entry of this.entries.values()) {
      if (identity(entry.request).session !== event.sessionId) continue;
      if (event.kind === "disconnected")
        this.invalidate(
          entry,
          "failed",
          "Revit bridge disconnected; reconnect before reading again",
        );
      else if (event.kind === "connected") this.invalidate(entry);
      else if (
        entry.request.kind === "ducts-snapshot" &&
        event.kind === "state-sync" &&
        event.openDocumentIds &&
        !event.openDocumentIds.includes(entry.request.target.openId)
      )
        this.invalidate(entry, "closed", "The exact open document closed");
      else if (
        entry.request.kind === "ducts-snapshot" &&
        event.kind === "event" &&
        event.eventName === "document-changed" &&
        (!Array.isArray(changed) || changed.includes(entry.request.target.openId))
      )
        this.invalidate(entry);
    }
  }
  read = Effect.fn("DuctsReadings.read")(function* <E, R>(this: DuctsReadings,
    request: DuctsReadingRequest,
    acquire: Effect.Effect<NativeResult & { nativeRequestId: string; nativeTakingId?: string }, E, R>,
    options: DuctsReadOptions = {},
  ) {
    const entry = yield* Effect.try({ try: () => this.entry(request), catch: retainedFailure });
    const original = options.source?.revision;
    if (original !== undefined) {
      if (options.refresh !== undefined)
        return yield* new InvalidRead({ message: "A recorded Ducts body cannot refresh live inputs", status: 409, problem: "recording.historical" });
      if (!original || (entry.envelope.revision !== original &&
          (entry.body || entry.envelope.state !== "idle")))
        return yield* new InvalidRead({ message: "Recorded Ducts version conflicts with the retained acquisition", status: 409, problem: "recording.mismatch" });
      entry.envelope = { ...entry.envelope, revision: original };
    }
    if (options.refresh === entry.envelope.revision) this.invalidate(entry);
    if (options.version) {
      if (entry.body?.version !== options.version)
        return yield* refused("Ducts body version is no longer current; observe the reading again");
      return { ...entry.body, reused: true };
    }
    if (entry.envelope.state === "closed" || entry.envelope.state === "failed")
      return yield* refused(entry.envelope.error ?? "Ducts acquisition failed; explicitly refresh to retry");
    if (entry.body) return { ...entry.body, reused: true };
    const revision = entry.envelope.revision;
    entry.readers++;
    entry.envelope = { ...entry.envelope, state: "loading" };
    this.publish(entry);
    return yield* Effect.gen({ self: this }, function* () {
        const result = yield* acquire;
        if (entry.envelope.revision !== revision)
          return yield* refused("Ducts acquisition was invalidated before it completed");
        const actual = result.target.documentRef;
        if (
          result.target.session !== identity(request).session ||
          (request.kind === "ducts-snapshot" &&
            (actual?.session !== request.target.session || actual.openId !== request.target.openId))
        )
          return yield* refused("Ducts native response did not confirm the exact requested document");
        const json = JSON.stringify(result.value);
        const bytes = Buffer.byteLength(json, "utf8");
        if (bytes > this.limits.bytes)
          return yield* refused("Ducts snapshot exceeds the shared reading byte budget; graph was not clipped");
        const { value: _, ...native } = result;
        const body: DuctsBody = { ...native, json, version: revision };
        // Acquisition readers keep their own taking; only cache hits above reuse a peer's body.
        yield* options.source?.beforeReady?.(body) ?? Effect.void;
        // Metadata capture can await disk; a change still retires this revision.
        if (entry.envelope.revision !== revision)
          return yield* refused("Ducts acquisition was invalidated while retaining its basis");
        if (entry.body) return { ...body, reused: false };
        while (this.bytes + bytes > this.limits.bytes)
          if (!this.evict(entry))
            return yield* refused("Shared Ducts reading byte budget is occupied; graph was not clipped");
        entry.body = body;
        entry.bytes = bytes;
        this.bytes += bytes;
        entry.envelope = { ...entry.envelope, state: "ready", version: revision };
        this.publish(entry);
        return { ...body, reused: false };
    }).pipe(Effect.tapError((error) => Effect.sync(() => {
        if (entry.envelope.revision === revision && !entry.body) {
          entry.envelope = { ...entry.envelope, state: "failed", error: retainedFailure(error).message };
          this.publish(entry);
        }
    })), Effect.ensuring(Effect.sync(() => {
      entry.readers--;
      if (!entry.readers && entry.envelope.revision === revision && entry.envelope.state === "loading") {
        entry.envelope = { ...entry.envelope, state: "idle" };
        this.publish(entry);
      }
    })));
  });

  assertCurrent(request: DuctsReadingRequest, version: string): void {
    if (this.entry(request).body?.version !== version)
      throw refused("Ducts response was invalidated before publication");
  }
}

const owners = new WeakMap<RevitBridge["Service"], DuctsReadings>();
export function ductsReadings(bridge: RevitBridge["Service"]): DuctsReadings {
  let owner = owners.get(bridge);
  if (!owner) {
    owner = new DuctsReadings();
    bridge.subscribe((event) => owner!.changed(event));
    owners.set(bridge, owner);
  }
  return owner;
}

const retainedFailure = (error: unknown) => new InvalidRead({
  message: error instanceof Error || error instanceof BridgeError ? error.message : String(error),
  status: error instanceof BridgeError ? error.statusCode : 409,
  problem: "read.retained",
});
