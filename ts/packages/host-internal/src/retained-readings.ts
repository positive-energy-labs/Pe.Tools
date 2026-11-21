import { randomUUID } from "node:crypto";
import { Effect } from "effect";
import { z } from "zod";
import {
  canonicalRouteInput,
  documentRefSchema,
  type RetainedReadingEnvelope,
} from "@pe/agent-contracts";
import type { ProductDeclaration } from "@pe/agent-contracts/product";
import { BridgeError, staleBy, type HostBridgeEvent, type RevitBridge } from "./bridge.ts";
import type { NativeReadInput } from "./native-read.ts";
import { InvalidRead } from "./read-errors.ts";
import type { DoorFailure } from "./request-contracts.d.ts";

/** The child read set every retained acquisition runs in. */
export const RETAINED_FRAME = "reading.retained";
/** Whether a retained answer came from a body another reader acquired. */
export const RETAINED_REUSED_HEADER = "x-pe-reading-reused";

/** A reading a product declares with `load.resource`: its request, as the product's schema parses it. */
const requestSchema = z.looseObject({ kind: z.string() });
export type RetainedRequest = Readonly<z.output<typeof requestSchema>>;
const documentScope = z.looseObject({ target: documentRefSchema });
const sessionScope = z.looseObject({ session: z.string() });
type Declared = {
  readonly product: string;
  readonly kind: string;
  readonly input: z.ZodType;
  readonly scope: "document" | "session";
  readonly calls: readonly string[];
  readonly fixes: Readonly<Record<string, Readonly<Record<string, unknown>> | undefined>>;
};
const kinds = new Map<string, Declared>();
const calls = new Map<string, Declared>();
/** Called by `implement()`: the kernel retains what a product declares, and names none itself. */
export function declareRetained(product: ProductDeclaration) {
  for (const { handle, load } of Object.values(product.readings)) {
    if (!load?.resource) continue;
    const input = handle.input;
    const literal = input instanceof z.ZodObject ? input.shape.kind : undefined;
    const kind = literal instanceof z.ZodLiteral ? literal.value : undefined;
    if (typeof kind !== "string" || !load.scope)
      throw Error(`Retained reading ${handle.key} needs a literal kind and a declared scope`);
    const declared: Declared = {
      product: product.id,
      kind,
      input,
      scope: load.scope,
      calls: Object.keys(load.calls ?? {}),
      fixes: load.fixes ?? {},
    };
    for (const [key, table] of [
      [kind, kinds] as const,
      ...declared.calls.map((call) => [call, calls] as const),
    ]) {
      if (table.has(key)) throw Error(`Retained reading ${key} is declared twice`);
      table.set(key, declared);
    }
  }
}
const refused = (message: string, problem = "read.retained") =>
  new InvalidRead({ message, status: 409, problem });
const kindOf = (raw: unknown) =>
  kinds.get(raw && typeof raw === "object" && "kind" in raw ? String(raw.kind) : "");
const declaredFor = (request: RetainedRequest) => {
  const declared = kinds.get(request.kind);
  if (!declared) throw refused("Request names no retained reading", "read.contract");
  return declared;
};
/** The request when it is a declared retained reading; undefined for every other resource. */
export const retainedRequest = (raw: unknown): RetainedRequest | undefined =>
  requestSchema.safeParse(kindOf(raw)?.input.safeParse(raw).data).data;
/** The retained reading a native call serves, with its declared scope. */
export const retainedReadingOf = (key: string): Pick<Declared, "scope" | "product"> | undefined =>
  calls.get(key);
/** One identity however a caller spelled the request: the product's schema is the only normaliser. */
const retainedSubject = (raw: RetainedRequest): RetainedRequest =>
  requestSchema.parse(declaredFor(raw).input.parse(raw));
/** What a retained body belongs to: its session, and its document unless the reading is session-scoped. */
export const retainedScope = (request: RetainedRequest) => {
  if (declaredFor(request).scope === "session")
    return { target: null, session: sessionScope.parse(request).session };
  const { target } = documentScope.parse(request);
  return { target, session: target.session };
};
export const canonicalRetained = (request: RetainedRequest, session: string): RetainedRequest => {
  const { target } = retainedScope(request);
  return target ? { ...request, target: { ...target, session } } : { ...request, session };
};
const same = (a: unknown, b: unknown) => canonicalRouteInput(a) === canonicalRouteInput(b);
/** The native call a retained request acquires through: the call whose fixed fields it carries. */
export function retainedNative(request: RetainedRequest): NativeReadInput {
  const declared = declaredFor(request);
  const { target, session } = retainedScope(request);
  const { kind: _, [declared.scope === "session" ? "session" : "target"]: __, ...input } = request;
  const fixed = (key: string) => Object.entries(declared.fixes[key] ?? {});
  const key =
    declared.calls.find(
      (key) => fixed(key).length && fixed(key).every(([name, value]) => same(input[name], value)),
    ) ?? declared.calls.find((key) => !fixed(key).length);
  if (!key) throw refused("Retained reading declares no native call for this request");
  return {
    key,
    input,
    scope: { bridgeSessionId: session, ...(target ? { openDocumentId: target.openId } : {}) },
  };
}
/** The inverse of `retainedNative`, independent of live SDK/bridge construction. */
export function retainedCallSubject(input: NativeReadInput): RetainedRequest {
  const session = input.scope.bridgeSessionId;
  if (!session) throw refused("Retained read needs an exact canonical session", "read.target");
  const declared = calls.get(input.key);
  if (!declared) throw refused("Operation has no retained subject", "read.contract");
  return retainedSubject({
    ...(input.input && typeof input.input === "object" ? input.input : {}),
    kind: declared.kind,
    ...declared.fixes[input.key],
    ...(declared.scope === "session"
      ? { session }
      : { target: { session, openId: input.scope.openDocumentId } }),
  });
}
const readingKey = (request: RetainedRequest) => canonicalRouteInput(request);

export type NativeResult = Effect.Success<ReturnType<RevitBridge["Service"]["invoke"]>>;
export type RetainedBody = {
  json: string;
  version: string;
  nativeRequestId: string;
  target: NativeResult["target"];
  nativeTakingId?: string;
};
export type RetainedReadOptions = {
  version?: string;
  refresh?: string;
  /** Decoded host source evidence, never an HTTP version header. */
  source?: {
    readonly revision?: string;
    readonly beforeReady?: (body: RetainedBody) => Effect.Effect<void, DoorFailure>;
  };
};
type Entry = {
  request: RetainedRequest;
  envelope: RetainedReadingEnvelope;
  listeners: Set<(value: RetainedReadingEnvelope) => void>;
  body?: RetainedBody;
  bytes: number;
  used: number;
  readers: number;
};
export const isRetainedReadFailure = (error: DoorFailure): error is InvalidRead =>
  error._tag === "InvalidRequest" && error.status === 409 && error.problem === "read.retained";

/** Only declared acquisitions are retained. Immutable JSON is bounded by both subjects and UTF-8 bytes. */
export class RetainedReadings {
  private readonly entries = new Map<string, Entry>();
  private bytes = 0;
  constructor(
    private readonly limits: { entries: number; bytes: number; idleMs: number } = {
      entries: 16,
      bytes: 256 * 1024 * 1024,
      idleMs: 900_000,
    },
  ) {}

  private entry(raw: RetainedRequest): Entry {
    const request = retainedSubject(raw);
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
        throw refused("Shared reading capacity is occupied; retry after a reader leaves");
    const entry: Entry = {
      request,
      envelope: { revision: randomUUID(), version: null, state: "idle", ...retainedScope(request) },
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
      ...retainedScope(entry.request),
      ...(error ? { error } : {}),
    };
    this.publish(entry);
  }
  observe(
    request: RetainedRequest,
    listener: (value: RetainedReadingEnvelope) => void,
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
      const scope = retainedScope(entry.request);
      if (
        scope.session === target.session &&
        (!scope.target || scope.target.openId === target.openId)
      )
        this.invalidate(entry);
    }
  }
  /** Called synchronously by the bridge tap, before another response can publish. */
  changed(event: HostBridgeEvent): void {
    const stale = staleBy(event);
    for (const entry of this.entries.values()) {
      // A session-scoped body (`target` null) goes stale only when its session connects or drops.
      const { session, target } = retainedScope(entry.request);
      const why = stale(session, target?.openId);
      if (why === "disconnected")
        this.invalidate(
          entry,
          "failed",
          "Revit bridge disconnected; reconnect before reading again",
        );
      else if (why === "closed") this.invalidate(entry, "closed", "The exact open document closed");
      else if (why) this.invalidate(entry);
    }
  }
  read = Effect.fn("RetainedReadings.read")(function* <E, R>(
    this: RetainedReadings,
    request: RetainedRequest,
    acquire: Effect.Effect<
      NativeResult & { nativeRequestId: string; nativeTakingId?: string },
      E,
      R
    >,
    options: RetainedReadOptions = {},
  ) {
    const entry = yield* Effect.try({ try: () => this.entry(request), catch: retainedFailure });
    const original = options.source?.revision;
    if (original !== undefined) {
      if (options.refresh !== undefined)
        return yield* new InvalidRead({
          message: "A recorded retained body cannot refresh live inputs",
          status: 409,
          problem: "recording.historical",
        });
      if (
        !original ||
        (entry.envelope.revision !== original && (entry.body || entry.envelope.state !== "idle"))
      )
        return yield* new InvalidRead({
          message: "Recorded body version conflicts with the retained acquisition",
          status: 409,
          problem: "recording.mismatch",
        });
      entry.envelope = { ...entry.envelope, revision: original };
    }
    if (options.refresh === entry.envelope.revision) this.invalidate(entry);
    if (options.version) {
      if (entry.body?.version !== options.version)
        return yield* refused(
          "Retained body version is no longer current; observe the reading again",
        );
      return { ...entry.body, reused: true };
    }
    if (entry.envelope.state === "closed" || entry.envelope.state === "failed")
      return yield* refused(
        entry.envelope.error ?? "Retained acquisition failed; explicitly refresh to retry",
      );
    if (entry.body) return { ...entry.body, reused: true };
    const revision = entry.envelope.revision;
    entry.readers++;
    entry.envelope = { ...entry.envelope, state: "loading" };
    this.publish(entry);
    return yield* Effect.gen({ self: this }, function* () {
      const result = yield* acquire;
      if (entry.envelope.revision !== revision)
        return yield* refused("Retained acquisition was invalidated before it completed");
      const actual = result.target.documentRef;
      const scope = retainedScope(request);
      if (
        result.target.session !== scope.session ||
        (scope.target &&
          (actual?.session !== scope.target.session || actual.openId !== scope.target.openId))
      )
        return yield* refused("Native response did not confirm the exact requested document");
      const json = JSON.stringify(result.value);
      const bytes = Buffer.byteLength(json, "utf8");
      if (bytes > this.limits.bytes)
        return yield* refused(
          "Reading exceeds the shared reading byte budget; the body was not clipped",
        );
      const { value: _, ...native } = result;
      const body: RetainedBody = { ...native, json, version: revision };
      // Acquisition readers keep their own taking; only cache hits above reuse a peer's body.
      yield* options.source?.beforeReady?.(body) ?? Effect.void;
      // Metadata capture can await disk; a change still retires this revision.
      if (entry.envelope.revision !== revision)
        return yield* refused("Retained acquisition was invalidated while retaining its basis");
      if (entry.body) return { ...body, reused: false };
      while (this.bytes + bytes > this.limits.bytes)
        if (!this.evict(entry))
          return yield* refused("Shared reading byte budget is occupied; the body was not clipped");
      entry.body = body;
      entry.bytes = bytes;
      this.bytes += bytes;
      entry.envelope = { ...entry.envelope, state: "ready", version: revision };
      this.publish(entry);
      return { ...body, reused: false };
    }).pipe(
      Effect.tapError((error) =>
        Effect.sync(() => {
          if (entry.envelope.revision === revision && !entry.body) {
            entry.envelope = {
              ...entry.envelope,
              state: "failed",
              error: retainedFailure(error).message,
            };
            this.publish(entry);
          }
        }),
      ),
      Effect.ensuring(
        Effect.sync(() => {
          entry.readers--;
          if (
            !entry.readers &&
            entry.envelope.revision === revision &&
            entry.envelope.state === "loading"
          ) {
            entry.envelope = { ...entry.envelope, state: "idle" };
            this.publish(entry);
          }
        }),
      ),
    );
  });

  assertCurrent(request: RetainedRequest, version: string): void {
    if (this.entry(request).body?.version !== version)
      throw refused("Retained response was invalidated before publication");
  }
}

const owners = new WeakMap<RevitBridge["Service"], RetainedReadings>();
/** One owner per bridge: every product's retained readings share its entries and its bytes. */
export function retainedReadings(bridge: RevitBridge["Service"]): RetainedReadings {
  let owner = owners.get(bridge);
  if (!owner) {
    owner = new RetainedReadings();
    bridge.subscribe((event) => owner!.changed(event));
    owners.set(bridge, owner);
  }
  return owner;
}

const retainedFailure = (error: unknown) =>
  new InvalidRead({
    message: error instanceof Error || error instanceof BridgeError ? error.message : String(error),
    status: error instanceof BridgeError ? error.statusCode : 409,
    problem: "read.retained",
  });
