import { randomUUID } from "node:crypto";
import { Effect } from "effect";
import {
  ductsReadingSchema,
  readingKey,
  type DuctsReadingRequest,
  type DuctsReadingEnvelope,
} from "@pe/agent-contracts";
import { BridgeError, type HostBridgeEvent, type RevitBridge } from "./bridge.ts";

type NativeResult = {
  value: unknown;
  target: {
    session: string;
    document: string | null;
    documentRef?: { session: string; openId: string };
  };
};
type DuctsBody = {
  json: string;
  version: string;
  nativeRequestId: string;
  target: NativeResult["target"];
};
type Entry = {
  request: DuctsReadingRequest;
  envelope: DuctsReadingEnvelope;
  listeners: Set<(value: DuctsReadingEnvelope) => void>;
  body?: DuctsBody;
  bytes: number;
  used: number;
  flight?: Promise<DuctsBody>;
  flightRevision?: string;
};
const refused = (message: string) => new BridgeError(message, 409, { notDispatched: true });
const identity = (request: DuctsReadingRequest) =>
  request.kind === "ducts-snapshot"
    ? { target: request.target, session: request.target.session }
    : { target: null, session: request.session };

/** Only Ducts acquisition is retained. Immutable JSON is bounded by both subjects and UTF-8 bytes. */
export class DuctsReadings {
  private readonly entries = new Map<string, Entry>();
  private bytes = 0;
  constructor(
    private readonly limits: { entries: number; bytes: number; idleMs: number; waitMs?: number } = {
      entries: 16,
      bytes: 256 * 1024 * 1024,
      idleMs: 900_000,
    },
  ) {}

  private entry(raw: DuctsReadingRequest): Entry {
    const parsed = ductsReadingSchema.parse(raw);
    const request =
      parsed.kind === "ducts-snapshot" && parsed.slots && !Object.keys(parsed.slots).length
        ? { ...parsed, slots: undefined }
        : parsed;
    const key = readingKey(request);
    const existing = this.entries.get(key);
    if (existing) {
      existing.used = Date.now();
      return existing;
    }
    for (const [key, entry] of this.entries)
      if (!entry.listeners.size && !entry.flight && Date.now() - entry.used > this.limits.idleMs)
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
      .filter(([, entry]) => entry !== except && !entry.flight && !entry.listeners.size)
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
  async read(
    request: DuctsReadingRequest,
    acquire: () => Promise<NativeResult & { nativeRequestId: string }>,
    options: { version?: string; refresh?: string } = {},
  ): Promise<DuctsBody> {
    const entry = this.entry(request);
    if (options.refresh === entry.envelope.revision) this.invalidate(entry);
    if (options.version) {
      if (entry.body?.version !== options.version)
        throw refused("Ducts body version is no longer current; observe the reading again");
      return entry.body;
    }
    if (entry.envelope.state === "closed" || (entry.envelope.state === "failed" && !entry.flight))
      throw refused(
        entry.envelope.error ?? "Ducts acquisition failed; explicitly refresh to retry",
      );
    if (entry.body) return entry.body;
    if (entry.flight) {
      const revision = entry.flightRevision;
      try {
        return await entry.flight;
      } catch (error) {
        if (revision === entry.envelope.revision) throw error;
        return this.read(request, acquire);
      }
    }
    const revision = entry.envelope.revision;
    entry.flightRevision = revision;
    entry.envelope = { ...entry.envelope, state: "loading" };
    // A timed-out native operation may still be running. Fence its answer, but retain its flight
    // until it settles so refresh cannot dispatch a second operation behind an unanswered first.
    const deadline = setTimeout(() => {
      if (entry.envelope.revision === revision)
        this.invalidate(
          entry,
          "failed",
          "Ducts acquisition sent no answer in 120 s; refresh after the native read settles",
        );
    }, this.limits.waitMs ?? 120_000);
    const flight = Promise.resolve().then(async () => {
      try {
        const result = await acquire();
        if (entry.envelope.revision !== revision)
          throw refused("Ducts acquisition was invalidated before it completed");
        const actual = result.target.documentRef;
        if (
          result.target.session !== identity(request).session ||
          (request.kind === "ducts-snapshot" &&
            (actual?.session !== request.target.session || actual.openId !== request.target.openId))
        )
          throw refused("Ducts native response did not confirm the exact requested document");
        const json = JSON.stringify(result.value);
        const bytes = Buffer.byteLength(json, "utf8");
        if (bytes > this.limits.bytes)
          throw refused(
            "Ducts snapshot exceeds the shared reading byte budget; graph was not clipped",
          );
        while (this.bytes + bytes > this.limits.bytes)
          if (!this.evict(entry))
            throw refused("Shared Ducts reading byte budget is occupied; graph was not clipped");
        entry.body = {
          json,
          version: revision,
          nativeRequestId: result.nativeRequestId,
          target: result.target,
        };
        entry.bytes = bytes;
        this.bytes += bytes;
        entry.envelope = { ...entry.envelope, state: "ready", version: revision };
        this.publish(entry);
        return entry.body;
      } catch (error) {
        if (entry.envelope.revision === revision) {
          entry.envelope = {
            ...entry.envelope,
            state: "failed",
            error:
              error instanceof Error || error instanceof BridgeError
                ? error.message
                : String(error),
          };
          this.publish(entry);
        }
        throw error;
      } finally {
        clearTimeout(deadline);
        if (entry.flight === flight) entry.flight = undefined;
      }
    });
    entry.flight = flight;
    this.publish(entry);
    return flight;
  }

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

/** SDK session aliases and bridge ids must enter the same exact owner, never a second cache. */
export async function canonicalDuctsSession(
  bridge: RevitBridge["Service"],
  id: string,
): Promise<string> {
  const sessions = await Effect.runPromise(bridge.list);
  const matches = sessions.filter(
    (session) => session.connected && (session.sessionId === id || session.sdkSessionId === id),
  );
  if (matches.length !== 1 || !matches[0]!.sessionId)
    throw refused("The exact Ducts bridge attachment is unavailable or ambiguous");
  return matches[0]!.sessionId!;
}
