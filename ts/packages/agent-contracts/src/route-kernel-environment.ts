import type { ResolvedReadDescriptor } from "./native-read-door.ts";
import type { DocumentKey, SubjectRefCode } from "./subject-ref.ts";
import type { RevitDetailSpaceScene } from "@pe/host-contracts/generated";
import type { z } from "zod";
import type { AdmittedRoute } from "./route-kernel-admission.ts";
import type { ReadingState } from "./route-kernel-bodies.ts";
import type { Immutable, RouteGraphJson } from "./route-kernel-data.ts";
import type {
  AcceptanceToken,
  CausalParentId,
  DecodeResult,
  InvocationToken,
  Many,
  ScopeToken,
} from "./route-kernel-page.ts";

type GeometryCost = Immutable<RevitDetailSpaceScene.Artifact.GeometryCost>;
export type SceneContextRepresentation = RevitDetailSpaceScene.Req.SceneContextRepresentation;
export type GeometryScope =
  | {
      readonly kind: "subjects";
      readonly ids: readonly [SubjectRefCode, ...SubjectRefCode[]];
    }
  | {
      readonly kind: "subjects";
      /** Native ids are invocation input, never stable Page identities. */
      readonly ids: readonly [number, ...number[]];
      readonly scope: ScopeToken;
    }
  | { readonly kind: "region"; readonly id: SubjectRefCode }
  | { readonly kind: "family-document"; readonly id: DocumentKey };

/** Owner-issued for a human/Pea explicit request, never a dependency/focus refresh. */
export class ExplicitDetailRequest {
  declare private readonly explicitAuthority: void;
  private constructor(readonly token: AcceptanceToken) {
    Object.freeze(this);
  }
}
/** Prepared by the geometry owner; finite reach >= 5 feet. */
export class PreparedDetailReach {
  declare private readonly reachAuthority: void;
  private constructor(
    readonly subject: GeometryScope,
    readonly reachFt: number,
    readonly explicit: ExplicitDetailRequest,
  ) {
    Object.freeze(this);
  }
}
/** An unparameterized request can ONLY ask for the zero-tessellation overview. */
export type GeometryRequest<R extends SceneContextRepresentation = "overview"> = {
  /** Admitted entry arguments, encoded once by the kernel reading plan. */
  readonly native?: {
    readonly operationKey: string;
    readonly input: unknown;
    readonly readingId?: string;
  };
} & (R extends "overview"
  ? {
      readonly representation: "overview";
      readonly subjects: Many<SubjectRefCode>;
      readonly scope: ScopeToken;
    }
  : { readonly representation: R; readonly reach: PreparedDetailReach });
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
  readonly freshnessGeneration: number | string | null;
}
export class ResolvedRead<T> {
  declare private readonly readAuthority: void;
  private constructor(
    readonly key: ResolvedReadKey,
    readonly output: z.ZodType<T>,
    readonly route: AdmittedRoute,
  ) {
    Object.freeze(this);
  }
}
/** Exact resolver-issued composite; copies/proxies refuse at acquisition. Membership does
 * not establish admission, document freshness or the current scope/attempt. */
export class ResolvedGeometryRead<T> {
  declare private readonly geometryAuthority: void;
  private constructor(
    readonly key: ResolvedReadKey,
    readonly output: z.ZodType<GeometryOutcome<T>>,
    readonly route: AdmittedRoute,
    readonly token: AcceptanceToken,
    readonly request: GeometryRequest<SceneContextRepresentation>,
    readonly descriptor?: ResolvedReadDescriptor,
  ) {
    Object.freeze(this);
  }
}
/** These are synchronous acquisition/submission ports, not a Promise or fiber runtime.
 * D's scoped Effect services own the acquisitions behind handles; release interrupts reads,
 * unsubscribe closes SSE, and command lifetime belongs to ActionJournal after submit.
 * TODO: D proves fixture isolation/missing-seed refusal and native transport import exclusion. */
interface ReadHandle<T> {
  readonly lifetime: "read";
  readonly key: ResolvedReadKey;
  read(): ReadingState<T>;
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
  /** Refuse copied/rebound descriptors and tokens other than the captured live attempt. */
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
    deliver: (value: ReadingState<T>) => void,
  ): () => void;
}
/** Journal-owned status and cancellation; no invoke/re-execute function escapes. */
export interface JournalCommandHandle {
  readonly lifetime: "command";
  readonly id: string;
  readonly causalParent: CausalParentId;
}
export class NativeWriteCapability {
  declare private readonly submitAuthority: void;
  readonly lifetime = "command";
  private constructor(readonly submit: import("./work-journal-door.ts").WorkJournalDoor["submit"]) {
    Object.freeze(this);
  }
}

/** Recursively sorted JSON input, with array order retained. */
export function canonicalEnvironmentInput(value: unknown): string {
  const sorted = (part: unknown): unknown => {
    if (Array.isArray(part)) return part.map(sorted);
    if (part !== null && typeof part === "object")
      return Object.fromEntries(
        Object.entries(part)
          .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
          .map(([key, item]) => [key, sorted(item)]),
      );
    return part;
  };
  const encoded = JSON.stringify(sorted(value));
  if (encoded === undefined) throw new Error("Read input must be JSON");
  return encoded;
}

type WorkReadCapability = Pick<
  import("./work-journal-door.ts").WorkJournalDoor,
  "lifetime" | "open" | "receipts"
>;
type WorkSubmitCapability = Pick<
  import("./work-journal-door.ts").WorkJournalDoor,
  "submitWork" | "submit" | "accepted"
>;
interface ClockCapability {
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
/** Baseline services are installed once by application composition. A route cannot
 * request an optional group without declaring it, even through a non-literal variable. */
export type KernelServices = Pick<
  RouteEnvironment,
  "reads" | "readings" | "clock" | "availability"
> & {
  readonly local?: LocalCommandPort;
  readonly work?: import("./work-journal-door.ts").WorkJournalDoor;
  readonly target?: () => ScopeToken["identity"]["target"];
  readonly nativeWrite?: import("./work-journal-door.ts").WorkJournalDoor;
  readonly submitNative?: import("./work-journal-door.ts").WorkJournalDoor["submit"];
};
/** Application effects stay outside pure route bodies and the native action journal. */
type LocalCommandCall = Readonly<{ verb: string; entry: string; input: unknown }>;
type LocalCommandPort = (call: LocalCommandCall, signal: AbortSignal) => Promise<unknown>;
type GroupFor<
  D extends Pick<RouteGraphJson, "capabilities">,
  C extends RouteGraphJson["capabilities"][number],
  K extends keyof RouteEnvironment,
> = C extends D["capabilities"][number]
  ? { readonly [P in K]-?: NonNullable<RouteEnvironment[P]> }
  : { readonly [P in K]?: never };
export type EnvironmentFor<D extends Pick<RouteGraphJson, "capabilities">> = Pick<
  RouteEnvironment,
  "reads" | "readings" | "clock" | "availability"
> &
  GroupFor<D, "work", "work"> &
  GroupFor<D, "geometry", "geometry"> &
  GroupFor<D, "native-write", "nativeWrite">;

/** Same operations with isolated Work and seed-backed reads. Missing seed is unavailable,
 * never a fallback to native transport. Types are not a sandbox for arbitrary JS bodies. */
export type FixtureEnvironment = Omit<RouteEnvironment, "nativeWrite"> & {
  readonly nativeWrite?: never;
};
