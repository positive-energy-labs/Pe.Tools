import { Context, Effect, Result } from "effect";
import { canonicalJson } from "./native-read.ts";
import { InvalidRead } from "./read-errors.ts";
import type { ConsumerRecipe, RecordedInput, TakingObserver } from "./input-recording.ts";

declare const readSetBrand: unique symbol;
/** Host-minted before first consumption; never derived from a request, a time or an ordinal. */
export type ReadSetId = string & { readonly [readSetBrand]: "ReadSetId" };

export interface InputOccurrence {
  readonly readSet: ReadSetId;
  readonly input: RecordedInput;
  readonly scope: string;
  /** Zero-based, per (inputIdentity(input), scope), within this context. */
  readonly start: number;
}
export interface InputAttempt {
  readonly occurrence: InputOccurrence;
  /** The exact durable taking this occurrence read (replay only). */
  readonly selected: Effect.Effect<string, InvalidRead>;
  /** Binds this attempt to the actual taking its capture appended. */
  readonly observed: TakingObserver;
}
export interface InputConsumption {
  readonly id: ReadSetId;
  readonly recipe: ConsumerRecipe;
  readonly child: (recipe: ConsumerRecipe) => Result.Result<InputConsumption, InvalidRead>;
  readonly start: (input: RecordedInput, scope: string) => Result.Result<InputAttempt, InvalidRead>;
  readonly linkTaking: (name: string, takingId: string) => Effect.Effect<void, InvalidRead>;
  readonly taking: (name: string) => Effect.Effect<string, InvalidRead>;
  readonly linkReadSet: (name: string, id: ReadSetId) => Effect.Effect<void, InvalidRead>;
  readonly dependency: (name: string) => Effect.Effect<ReadSetId, InvalidRead>;
  readonly exportBasis: (
    contract: { readonly key: string },
    basis: string,
  ) => Effect.Effect<void, InvalidRead>;
  readonly seal: Effect.Effect<void, InvalidRead>;
  /** Idempotent; an unsealed context stays incomplete and never synthesizes links. */
  readonly close: Effect.Effect<void>;
}
/** The consumption a boundary reads under; provided per request or frame, never global. */
export class CurrentInputConsumption extends Context.Service<
  CurrentInputConsumption,
  InputConsumption
>()("pe/CurrentInputConsumption") {}
/** An attempt a boundary reserved before entering a Promise owner; lower helpers reuse it. */
export class CurrentInputAttempt extends Context.Service<CurrentInputAttempt, InputAttempt>()(
  "pe/CurrentInputAttempt",
) {}

/** One input's identity across takings: its whole canonical discriminant. */
export const inputIdentity = (input: RecordedInput) => canonicalJson(input);
/** The root's explicit binding key for one non-native input occurrence: its identity and its scope. */
export const inputBindingKey = (input: RecordedInput, scope: string) =>
  canonicalJson([inputIdentity(input), scope]);

/**
 * The attempt one input read runs under: a reserved CurrentInputAttempt (which must name this
 * exact input and scope), else a fresh start in the CurrentInputConsumption, else none at all
 * (a caller outside any consumer, served by the legacy exact-binding path).
 */
export const attemptFor = (input: RecordedInput, scope: string) =>
  Effect.gen(function* () {
    const reserved = yield* Effect.serviceOption(CurrentInputAttempt);
    if (reserved._tag === "Some")
      return inputBindingKey(reserved.value.occurrence.input, reserved.value.occurrence.scope) ===
        inputBindingKey(input, scope)
        ? Result.succeed(reserved.value)
        : Result.fail(
            new InvalidRead({
              message: "The reserved attempt names another input or scope",
              status: 409,
              problem: "recording.mismatch",
            }),
          );
    const consumption = yield* Effect.serviceOption(CurrentInputConsumption);
    return consumption._tag === "Some" ? consumption.value.start(input, scope) : null;
  });
