import type {
  GeometryOutcome,
  GeometryRequest,
  SceneContextRepresentation,
} from "./route-kernel-environment.ts";
import type { ScopeToken } from "./route-kernel-page.ts";
import type { Observation } from "./work-journal-door.ts";

/** Host-owned data, not D's nominal authority. D mints its ResolvedGeometryRead FROM
 * this descriptor. The host never mints D's brand; D never invents incarnation or freshness.
 * No caller attribution belongs in this shared identity or its shared answer. */
export interface ResolvedReadDescriptor {
  readonly operationKey: string;
  readonly processIncarnation: {
    readonly pid: number;
    /** Process start in UTC Unix milliseconds; a PID alone is not an incarnation. */
    readonly startedAt: number;
  };
  readonly openDocumentLifetime: { readonly openId: string } | { readonly kind: "session-only" };
  /** Host canonicalization: schema-encoded JSON, recursively sorted object keys,
   * ordered arrays. Includes the resolved target/subject, never an active-doc placeholder. */
  readonly normalizedInput: string;
  /** Opaque host token. Fresh-after-write must not join a pre-write flight. */
  readonly freshnessGeneration: string | null;
  /** null means today's wire cannot establish fresh-after-write isolation. */
  readonly freshnessEvidence?: "unavailable";
  /** Overview stays overview; every explicit non-overview geometry mode maps to detail.
   * normalizedInput retains the exact requested mode, so distinct detail modes never share. */
  readonly representation: "overview" | "detail";
}

/** Overview is cheap by default and performs zero tessellation. Detail is explicit.
 * Report every available measurement, including detail cost; none is a refusal threshold.
 * GeometryOutcome additionally retains the kernel's generated geometryCost contract. */
export interface ReadCost {
  readonly elements?: number;
  readonly triangles?: number;
  readonly bytes?: number;
  /** Milliseconds. */
  readonly elapsed?: number;
}

/** Typed host/admission failure, never a numeric cost refusal. */
export interface NativeReadFailure {
  readonly code: string;
  readonly message: string;
}

export type NativeReadRefusal = {
  readonly kind: "refused";
  readonly failure: NativeReadFailure;
};

export type NativeReadResult<A> =
  | {
      readonly kind: "value";
      readonly value: A;
      readonly descriptor: ResolvedReadDescriptor;
      readonly cost: ReadCost;
    }
  | NativeReadRefusal
  /** Retryable after terminal settlement, never join or duplicate a cancelling dispatch. */
  | { readonly kind: "retiring" }
  /** Native outcome is uncertain; transport cancellation does not establish settlement. */
  | { readonly kind: "unknown" };

/** Application composition binds the declared reading/operation to this door.
 * Every caller passes admission before sharing. The host owns in-flight identity,
 * refcounts and retirement until native settlement; this is not a successful-value cache. */
export interface NativeReadDoor<Request, A> {
  readonly lifetime: "read";
  /** Resolves the declared overview/detail reading and admitted target/subject.
   * scope carries the target; request carries the reading's subject/input.
   * Implicit/active-document targets resolve HERE, never during join. */
  resolve(
    request: Request,
    scope: ScopeToken,
  ): Observation<ResolvedReadDescriptor | NativeReadRefusal>;
  /** Unsubscribe IS release. The last release of a running read sends op.cancel.
   * This is phase 5 slice B's contract. Today's wire cancels the last joiner only
   * when the host sees request close, FALSIFIED live at 3d0c1f04. Until slice B
   * lands, clients must treat release as best-effort, never native-stop evidence. */
  join(descriptor: ResolvedReadDescriptor): Observation<NativeReadResult<A>>;
}

export type GeometryReadDoor<
  T,
  R extends SceneContextRepresentation = SceneContextRepresentation,
> = NativeReadDoor<GeometryRequest<R>, GeometryOutcome<T>>;
