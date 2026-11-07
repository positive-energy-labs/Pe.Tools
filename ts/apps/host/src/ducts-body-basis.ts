/** Original retained-owner evidence; native bytes remain in the one taking store. */
import { Effect, Result, Schema } from "effect";
import { attemptFor, CurrentInputAttempt, CurrentInputConsumption } from "./input-occurrence.ts";
import { z } from "zod";
import { ductsReadingSchema, readingKey, type DuctsReadingRequest } from "@pe/agent-contracts";
import { canonicalJson, HostNativeRead, type NativeReadInput } from "@pe/host-internal/native-read";
import type { DoorFailure } from "@pe/host-internal/request-contracts";
import { InvalidRead } from "./native-reads.ts";
import { ductsSubject, type DuctsBody } from "./ducts-readings.ts";
import { captureInput, replayInput, inputBindingKey, nativeInputIdentity,
  type HostInputLane, type Taking, type TakingObserver } from "./native-recording.ts";

type Answer = Effect.Success<ReturnType<HostNativeRead["Service"]["read"]>>;
const target = z.strictObject({ session: z.string(), document: z.string().nullable(),
  documentRef: z.strictObject({ session: z.string(), openId: z.string() }).optional() });
const basisSchema = z.strictObject({ subject: ductsReadingSchema, version: z.string().min(1),
  nativeRequestId: z.string().min(1), target, nativeTakingId: z.string().min(1),
  native: z.strictObject({ key: z.string(), args: z.string(), scope: z.string() }) });
export type DuctsBodyBasis = z.infer<typeof basisSchema>;
const refused = (message: string, problem = "recording.mismatch") =>
  new InvalidRead({ message, status: 409, problem });
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
const sameTarget = (a: unknown, b: unknown) => a === undefined || b === undefined ? a === b :
  canonicalJson(JSON.parse(JSON.stringify(a))) === canonicalJson(JSON.parse(JSON.stringify(b)));

/** Same subject normalization as the retained owner, independent of live SDK/bridge construction. */
export function ductBodySubject(input: NativeReadInput): DuctsReadingRequest {
  const session = input.scope.bridgeSessionId;
  if (!session) throw refused("Retained Ducts read needs an exact canonical session", "read.target");
  const args = input.input && typeof input.input === "object" ? input.input : {};
  if (input.key === "ducts.tables") return ductsSubject(ductsReadingSchema.parse({ ...args, kind: "ducts-tables", session }));
  if (input.key !== "ducts.snapshot.roster" && input.key !== "ducts.snapshot.walk")
    throw refused("Operation has no retained Ducts subject", "read.contract");
  return ductsSubject(ductsReadingSchema.parse({ ...args, kind: "ducts-snapshot",
    ...(input.key === "ducts.snapshot.roster" ? { selector: { kind: "roster" } } : {}),
    target: { session, openId: input.scope.openDocumentId } }));
}

export interface DuctsBasisRead {
  readonly recorded?: DuctsBodyBasis;
  readonly refuse: (error: DoorFailure) => Effect.Effect<never, DoorFailure>;
  readonly link: (answer: Answer) => Effect.Effect<string | undefined, DoorFailure>;
  readonly consume: (body: DuctsBody, admittedTarget: Answer["actualTarget"]) => Effect.Effect<void, DoorFailure>;
}
export interface DuctsBodyBasisSource {
  readonly replaying: boolean;
  readonly observed: TakingObserver;
  readonly prepare: (input: NativeReadInput, subject: DuctsReadingRequest) => Effect.Effect<DuctsBasisRead, DoorFailure>;
}

export function createDuctsBodyBasis(lane: HostInputLane, observed: TakingObserver = () => Effect.void): DuctsBodyBasisSource | undefined {
  if (lane.kind === "live" && !lane.captureStore) return undefined;
  // Provenance index only: exact observer outputs, bounded by the underlying taking store.
  // Multiple matching occurrences refuse; this index never chooses first/latest or stores bodies.
  const native = new Map<string, Taking[]>();
  const observer: TakingObserver = (taking) => observed(taking).pipe(Effect.andThen(Effect.sync(() => {
    if (taking.input.kind === "native" && taking.outcome.kind === "answered") {
      const ids = native.get(taking.outcome.nativeRequestId) ?? [];
      if (!ids.some((entry) => entry.id === taking.id)) ids.push(taking);
      native.set(taking.outcome.nativeRequestId, ids);
    }
  })));
  return { replaying: lane.kind === "recording", observed: observer, prepare: (input, subject) => Effect.gen(function* () {
    if (lane.kind === "fixture") return yield* refused("Fixture has no recorded Ducts basis", "recording.fixture");
    const store = lane.kind === "live" ? lane.captureStore! : lane.recordingStore;
    const stopCapture = (error: DoorFailure) => {
      if (lane.kind !== "live") return Effect.fail(error);
      const at = lane.captureStore!.capture.begin();
      return at === null ? Effect.void : lane.captureStore!.capture.stop(at,
        error.problem === "recording.full" ? "full" : error.problem === "recording.io" ? "io" : "observer", { site: "builtin", op: input.key });
    };
    const scope = canonicalJson(JSON.parse(JSON.stringify(input.scope)));
    const selector = canonicalJson(["ducts-body-basis", JSON.parse(JSON.stringify(subject))]);
    const basisInput = { kind: "document", scope: selector } as const;
    const matches = (taking: Taking) => {
      if (taking.input.kind !== "native" || taking.input.key !== input.key || taking.scope !== scope) return false;
      try { return readingKey(ductBodySubject({ key: taking.input.key, input: JSON.parse(taking.input.args), scope: input.scope })) === readingKey(subject); }
      catch { return false; }
    };
    const validate = (value: unknown): value is DuctsBodyBasis => {
      const parsed = basisSchema.safeParse(value);
      if (!parsed.success) return false;
      const basis = parsed.data;
      const taking = store.taking(basis.nativeTakingId);
      return readingKey(basis.subject) === readingKey(subject) && !!taking && matches(taking) &&
        taking.input.kind === "native" && taking.outcome.kind === "answered" &&
        same(basis.native, { key: taking.input.key, args: taking.input.args, scope: taking.scope }) &&
        basis.nativeRequestId === taking.outcome.nativeRequestId &&
        basis.target.session === (subject.kind === "ducts-snapshot" ? subject.target.session : subject.session) &&
        (subject.kind === "ducts-snapshot"
          ? sameTarget(basis.target.documentRef, subject.target) && "openId" in taking.outcome.actualTarget.openDocumentLifetime &&
            taking.outcome.actualTarget.openDocumentLifetime.openId === subject.target.openId
          : !basis.target.documentRef && "kind" in taking.outcome.actualTarget.openDocumentLifetime);
    };
    const codec = Schema.declare(validate);
    // A consumer's basis occurrence is reserved ONCE, here at prepare; link and consume reuse it.
    const consumption = yield* Effect.serviceOption(CurrentInputConsumption);
    const reserved = yield* attemptFor(basisInput, scope);
    if (reserved && Result.isFailure(reserved)) {
      if (lane.kind === "recording") return yield* reserved.failure;
      yield* stopCapture(reserved.failure);
    }
    const attempt = reserved && Result.isSuccess(reserved) ? reserved.success : undefined;
    const under = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
      attempt ? Effect.provideService(effect, CurrentInputAttempt, attempt) : effect;
    const recorded = lane.kind === "recording" ? yield* under(replayInput(store, basisInput, scope, codec,
      lane.bindings?.get(inputBindingKey(basisInput, scope)))) : undefined;
    // The original native acquisition this consumer's basis rests on: its stored link, else the
    // root's exact binding. Never a scan by request id.
    const nativeLink = recorded && consumption._tag === "Some"
      ? yield* consumption.value.taking("native")
      : recorded && lane.kind === "recording" ? lane.bindings?.get(yield* nativeInputIdentity(input)) : undefined;
    if (recorded && nativeLink !== recorded.nativeTakingId)
      return yield* refused("The native read link does not name this retained basis taking");
    const checked = (id: string | undefined) => {
      const taking = id ? store.taking(id) : undefined;
      return taking && matches(taking) && taking.outcome.kind === "answered" ? taking : null;
    };
    return {
      recorded,
      // A refused lookup has no body or native acquisition to link. Capture must preserve its failure (K4).
      refuse: (error: DoorFailure) => lane.kind === "live"
        ? under(captureInput(lane.captureStore!, basisInput, scope, codec, Effect.fail(error), observed, input.key)).pipe(
            Effect.andThen(Effect.fail(error)), Effect.catch(() => Effect.fail(error)))
        : Effect.fail(error),
      link: (answer: Answer) => Effect.gen(function* () {
        if (lane.kind === "live" && lane.captureStore!.capture.truncated()) return undefined;
        const candidates = recorded ? [recorded.nativeTakingId] :
          (native.get(answer.nativeRequestId) ?? []).filter(matches).map((taking) => taking.id);
        if (candidates.length !== 1) return yield* refused("Native taking observer has no unique acquisition for this body",
          candidates.length ? "recording.ambiguous" : "recording.miss");
        const taking = checked(candidates[0]);
        if (!taking || taking.outcome.kind !== "answered" || taking.outcome.nativeRequestId !== answer.nativeRequestId ||
            !sameTarget(taking.outcome.actualTarget, answer.actualTarget) || taking.outcome.nativeOutcome !== answer.outcome)
          return yield* refused("Native answer disagrees with the retained basis dependency");
        const value = yield* store.observation(taking);
        if (!sameTarget(value, answer.value)) return yield* refused("Native value disagrees with its exact taking");
        return taking.id;
      }).pipe(Effect.catch((error) => stopCapture(error).pipe(Effect.as(undefined)))),
      consume: (body: DuctsBody, admittedTarget: Answer["actualTarget"]) => Effect.gen(function* () {
        if (lane.kind === "live" && lane.captureStore!.capture.truncated()) return;
        const taking = checked(body.nativeTakingId);
        if (!taking || taking.input.kind !== "native" || taking.outcome.kind !== "answered")
          return yield* refused("Retained body has no exact native taking", "recording.miss");
        if (!sameTarget(taking.outcome.actualTarget, admittedTarget))
          return yield* refused("Retained Ducts acquisition no longer matches the admitted target", "read.target");
        const basis: DuctsBodyBasis = { subject: JSON.parse(JSON.stringify(subject)), version: body.version, nativeRequestId: body.nativeRequestId,
          target: body.target, nativeTakingId: taking.id,
          native: { key: taking.input.key, args: taking.input.args, scope: taking.scope } };
        if (!validate(basis) || (recorded && !sameTarget(recorded, basis)))
          return yield* refused("Retained owner evidence disagrees with the original basis");
        if (lane.kind !== "live") return;
        yield* under(captureInput(lane.captureStore!, basisInput, scope, codec, Effect.succeed(basis), observed, input.key));
        // Hits included: the ORIGINAL durable native acquisition; a hit adds no native taking.
        if (consumption._tag === "Some" && !lane.captureStore!.capture.truncated())
          yield* consumption.value.linkTaking("native", taking.id);
      }).pipe(Effect.catch(stopCapture)),
    } satisfies DuctsBasisRead;
  }) };
}
