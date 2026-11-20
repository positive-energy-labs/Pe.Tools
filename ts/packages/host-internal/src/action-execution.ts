import type { FileSystem, Path, Effect } from "effect";
import type { HttpClient } from "effect/http";
import type {
  ActionStep,
  Effect as RouteEffect,
  NativeProcess,
  RouteStatePatch,
  RouteStateWriteResult,
  WorkKey,
  WorkPath,
} from "@pe/agent-contracts";
import type { RequestIdentity as IdentityKey } from "./request-contracts.d.ts";

export type StepOptions<A> = {
  process?: NativeProcess;
  /** Domain postcondition, evaluated only after the operation returned a concrete outcome. */
  check?(result: A): void;
};
/** The services the journal Layer holds once for every attempt it owns. */
export type AttemptHost = FileSystem.FileSystem | Path.Path | HttpClient.HttpClient;
/** An attempt reads its journal-owned identity, never its submitter's request context. */
export type AttemptServices = AttemptHost | IdentityKey;
/** A step of an owned attempt: the error channel carries what the step threw, typed or not. */
export type Step<A> = Effect.Effect<A, unknown, AttemptServices>;
export type ActionExecution = {
  step<A>(
    kind: ActionStep["kind"],
    key: string,
    input: unknown,
    execute: (requestId: string) => Step<A>,
    options?: StepOptions<A>,
  ): Step<A>;
  effect(effect: RouteEffect): Step<void>;
  publishWork(
    key: WorkKey,
    route: string,
    patches: readonly RouteStatePatch[],
  ): Step<Extract<RouteStateWriteResult, { ok: true }>>;
  retireWork(
    key: WorkKey,
    route: string,
    paths: readonly WorkPath[],
  ): Step<{ retired: WorkPath[]; revision: number }>;
  readonly prepared: unknown;
  recorded(kind: ActionStep["kind"], key: string): ActionStep | undefined;
};
