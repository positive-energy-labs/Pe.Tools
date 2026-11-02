import type { RevitDetailSpaceScene } from "@pe/host-contracts/generated";
import type { z } from "zod";
import type { AdmittedRoute } from "./route-kernel-admission.ts";
import type { ReadingSnapshot } from "./route-kernel-bodies.ts";
import type { Immutable } from "./route-kernel-data.ts";
import type {
  AcceptanceToken,
  CausalParentId,
  DecodeResult,
  IdentityId,
  InvocationToken,
  Many,
  ScopeToken,
} from "./route-kernel-page.ts";
import type { WorkKey, WorkWrite } from "./route-state.ts";

export type GeometryCost = Immutable<RevitDetailSpaceScene.Artifact.GeometryCost>;
export type SceneContextRepresentation = RevitDetailSpaceScene.Req.SceneContextRepresentation;
export type GeometryScope =
  | {
      readonly kind: "subjects";
      readonly ids: readonly [IdentityId<"element">, ...IdentityId<"element">[]];
    }
  | { readonly kind: "region"; readonly id: IdentityId<"local"> }
  | { readonly kind: "family-document"; readonly id: IdentityId<"document"> };
/** Owner-issued for a human/Pea explicit request, never a dependency/focus refresh. */
export declare class ExplicitDetailRequest {
  private constructor();
  private readonly explicitAuthority: void;
  readonly token: AcceptanceToken;
}
/** Prepared by the geometry owner; finite reach >= 5 feet. Region only admits this reach.
 * Exact instance is checked on use, so copying reachFt cannot substitute a smaller reach. */
export declare class PreparedDetailReach {
  private constructor();
  private readonly reachAuthority: void;
  readonly reachFt: number;
  readonly subject: GeometryScope;
  readonly explicit: ExplicitDetailRequest;
}
/** An unparameterized request can ONLY ask for the zero-tessellation overview. */
export type GeometryRequest<R extends SceneContextRepresentation = "overview"> =
  R extends "overview"
    ? {
        readonly representation: "overview";
        readonly subjects: Many<IdentityId<"element">>;
        readonly scope: ScopeToken;
      }
    : { readonly representation: R; readonly reach: PreparedDetailReach };
/** No numeric refusal. Required metadata uses the generated host contract verbatim. */
export type GeometryOutcome<T> =
  | {
      readonly kind: "ready";
      readonly value: T;
      readonly representation: SceneContextRepresentation;
      readonly geometryCost: GeometryCost;
    }
  | { readonly kind: "unavailable" | "cancelled"; readonly reason: string };

/** Resolver-owned identity, not the logical route/Reading name. sortedKeyInput is canonical
 * JSON with recursively sorted object keys; array order is retained. Generation belongs to
 * the host freshness owner. Process/document values are lifetime ids, never addresses or pid. */
export interface ResolvedReadKey {
  readonly op: string;
  readonly processIncarnation: string;
  readonly documentLifetime: string;
  readonly sortedKeyInput: string;
  readonly freshnessGeneration: number;
}
export declare class ResolvedRead<T> {
  private constructor();
  private readonly readAuthority: void;
  readonly key: ResolvedReadKey;
  readonly output: z.ZodType<T>;
  readonly route: AdmittedRoute;
}
export type ResolvedGeometryRead<T> = ResolvedRead<GeometryOutcome<T>> & {
  readonly request: GeometryRequest<SceneContextRepresentation>;
};
/** These are synchronous acquisition/submission ports, not a Promise or fiber runtime.
 * D's scoped Effect services own the acquisitions behind handles; release interrupts reads,
 * unsubscribe closes SSE, and command lifetime belongs to ActionJournal after submit.
 * TODO: D proves fixture isolation/missing-seed refusal and native transport import exclusion. */
export interface ReadHandle<T> {
  readonly lifetime: "read";
  readonly key: ResolvedReadKey;
  read(): ReadingSnapshot<T>;
  release(): void;
}
export interface ReadCapability {
  readonly lifetime: "read";
  acquire<T>(request: ResolvedRead<T>, token: AcceptanceToken): ReadHandle<T>;
}
export interface GeometryReadCapability {
  readonly lifetime: "read";
  /** Called only for a declared explicit verb; rejects background/dependency attempts. */
  requestDetail(invocation: InvocationToken): DecodeResult<ExplicitDetailRequest>;
  prepareReach(
    subject: GeometryScope,
    reachFt: number,
    explicit: ExplicitDetailRequest,
  ): DecodeResult<PreparedDetailReach>;
  acquire<T>(
    request: ResolvedGeometryRead<T>,
    token: AcceptanceToken,
  ): ReadHandle<GeometryOutcome<T>>;
}
export interface ReadingsSubscriptionCapability {
  readonly lifetime: "subscription";
  subscribe<T>(
    request: ResolvedRead<T>,
    token: AcceptanceToken,
    deliver: (value: ReadingSnapshot<T>) => void,
  ): () => void;
}
/** Journal-owned status and cancellation; no invoke/re-execute function escapes. */
export interface JournalCommandHandle {
  readonly lifetime: "command";
  readonly id: string;
  readonly causalParent: CausalParentId;
}
export interface NativeWriteRequest {
  readonly route: AdmittedRoute;
  readonly invocation: InvocationToken;
  readonly entry: string;
  readonly input: unknown;
}
export declare class NativeWriteCapability {
  private constructor();
  private readonly submitAuthority: void;
  readonly lifetime: "command";
  /** Admission and invocation are revalidated, then journal accepts responsibility before return. */
  submit(request: NativeWriteRequest): JournalCommandHandle;
}
export interface WorkReadCapability {
  readonly lifetime: "read";
  read(
    scope: ScopeToken,
  ): {
    readonly key: Immutable<WorkKey>;
    readonly revision: number;
    readonly value: unknown;
  } | null;
}
export interface WorkSubmitCapability {
  readonly lifetime: "command";
  submit(
    route: AdmittedRoute,
    invocation: InvocationToken,
    write: Immutable<WorkWrite>,
  ): JournalCommandHandle;
}
export interface ClockCapability {
  readonly lifetime: "read";
  now(): number;
}
export interface RouteEnvironment {
  readonly reads: ReadCapability;
  readonly readings: ReadingsSubscriptionCapability;
  readonly work: { readonly read: WorkReadCapability; readonly submit: WorkSubmitCapability };
  readonly clock: ClockCapability;
  readonly geometry: GeometryReadCapability;
  readonly availability: Readonly<
    Record<string, { readonly available: boolean; readonly reason?: string }>
  >;
  readonly nativeWrite?: NativeWriteCapability;
}
/** Same operations with isolated Work and seed-backed reads. Missing seed is unavailable,
 * never a fallback to native transport. Types are not a sandbox for arbitrary JS bodies. */
export type FixtureEnvironment = Omit<RouteEnvironment, "nativeWrite"> & {
  readonly nativeWrite?: never;
};
