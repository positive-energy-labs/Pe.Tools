import type { GeometryReadDoor, ResolvedReadDescriptor } from "./native-read-door.ts";
import type { RevitDetailSpaceScene } from "@pe/host-contracts/generated";
import type { z } from "zod";
import type { AdmittedRoute } from "./route-kernel-admission.ts";
import type { ReadingSnapshot } from "./route-kernel-bodies.ts";
import type { Immutable, RouteGraphJson } from "./route-kernel-data.ts";
import type {
  AcceptanceToken,
  CausalParentId,
  DecodeResult,
  IdentityId,
  InvocationToken,
  Many,
  ScopeToken,
} from "./route-kernel-page.ts";

export type GeometryCost = Immutable<RevitDetailSpaceScene.Artifact.GeometryCost>;
export type SceneContextRepresentation = RevitDetailSpaceScene.Req.SceneContextRepresentation;
export type GeometryScope =
  | {
      readonly kind: "subjects";
      readonly ids: readonly [IdentityId<"element">, ...IdentityId<"element">[]];
    }
  | {
      readonly kind: "subjects";
      /** Native ids are invocation input, never stable Page identities. */
      readonly ids: readonly [number, ...number[]];
      readonly scope: ScopeToken;
    }
  | { readonly kind: "region"; readonly id: IdentityId<"local"> }
  | { readonly kind: "family-document"; readonly id: IdentityId<"document"> };
let mintExplicit: (token: AcceptanceToken) => ExplicitDetailRequest;
let mintReach: (
  subject: GeometryScope,
  reachFt: number,
  explicit: ExplicitDetailRequest,
) => PreparedDetailReach;
let mintRead: <T>(
  key: ResolvedReadKey,
  output: z.ZodType<T>,
  route: AdmittedRoute,
) => ResolvedRead<T>;
let mintGeometry: <T>(
  key: ResolvedReadKey,
  output: z.ZodType<GeometryOutcome<T>>,
  route: AdmittedRoute,
  token: AcceptanceToken,
  request: GeometryRequest<SceneContextRepresentation>,
) => ResolvedGeometryRead<T>;
let newGeometry: <T>(
  key: ResolvedReadKey,
  output: z.ZodType<GeometryOutcome<T>>,
  route: AdmittedRoute,
  token: AcceptanceToken,
  request: GeometryRequest<SceneContextRepresentation>,
  descriptor: ResolvedReadDescriptor,
) => ResolvedGeometryRead<T>;
let mintNative: (
  submit: import("./work-journal-door.ts").WorkJournalDoor["submit"],
) => NativeWriteCapability;

/** Owner-issued for a human/Pea explicit request, never a dependency/focus refresh. */
export class ExplicitDetailRequest {
  declare private readonly explicitAuthority: void;
  private constructor(readonly token: AcceptanceToken) {
    Object.freeze(this);
  }
  static {
    mintExplicit = (token) => new ExplicitDetailRequest(token);
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
  static {
    mintReach = (subject, reachFt, explicit) => new PreparedDetailReach(subject, reachFt, explicit);
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
      readonly subjects: Many<IdentityId<"element">>;
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
  static {
    mintRead = <T>(key: ResolvedReadKey, output: z.ZodType<T>, route: AdmittedRoute) =>
      new ResolvedRead(key, output, route);
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
  static {
    mintGeometry = <T>(
      key: ResolvedReadKey,
      output: z.ZodType<GeometryOutcome<T>>,
      route: AdmittedRoute,
      token: AcceptanceToken,
      request: GeometryRequest<SceneContextRepresentation>,
    ) => new ResolvedGeometryRead(key, output, route, token, request);
    newGeometry = (key, output, route, token, request, descriptor) =>
      new ResolvedGeometryRead(
        key,
        output,
        route,
        token,
        Object.freeze({ ...request }),
        descriptor,
      );
  }
}
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
    deliver: (value: ReadingSnapshot<T>) => void,
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
  static {
    mintNative = (submit) => new NativeWriteCapability(submit);
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

/** Kernel-private authority, retained at composition rather than exposed to route bodies.
 * Validators at acquisition still own admission and token/invocation freshness. */
export function createRouteEnvironmentIssuer() {
  const issued = new WeakSet<object>();
  const own = <T extends object>(value: T): T => {
    issued.add(value);
    return value;
  };
  const owns = (value: unknown): boolean =>
    typeof value === "object" && value !== null && issued.has(value);
  return Object.freeze({
    owns,
    mintExplicit: (token: AcceptanceToken) => own(mintExplicit(token)),
    mintReach: (subject: GeometryScope, reachFt: number, explicit: ExplicitDetailRequest) => {
      if (
        !owns(explicit) ||
        !(explicit instanceof ExplicitDetailRequest) ||
        !Number.isFinite(reachFt) ||
        reachFt < 5
      )
        throw new Error("Invalid explicit detail reach");
      if (
        subject.kind === "subjects" &&
        ("scope" in subject
          ? subject.scope !== explicit.token.scope ||
            subject.scope.identity.target?.kind !== "document" ||
            !subject.ids.length ||
            !subject.ids.every((id) => Number.isSafeInteger(id) && id > 0)
          : subject.ids.some((id) => typeof id !== "string"))
      )
        throw new Error("Native detail subjects require the invocation document scope");
      const captured: GeometryScope =
        subject.kind === "subjects"
          ? "scope" in subject
            ? Object.freeze({
                ...subject,
                ids: Object.freeze([subject.ids[0], ...subject.ids.slice(1)] as const),
              })
            : Object.freeze({
                ...subject,
                ids: Object.freeze([subject.ids[0], ...subject.ids.slice(1)] as const),
              })
          : Object.freeze({ ...subject });
      return own(mintReach(captured, reachFt, explicit));
    },
    mintRead: <T>(key: ResolvedReadKey, output: z.ZodType<T>, route: AdmittedRoute) =>
      own(mintRead(Object.freeze({ ...key }), output, route)),
    mintGeometry: <T>(
      key: ResolvedReadKey,
      output: z.ZodType<GeometryOutcome<T>>,
      route: AdmittedRoute,
      token: AcceptanceToken,
      request: GeometryRequest<SceneContextRepresentation>,
    ) => {
      if (
        request.representation === "overview"
          ? request.scope !== token.scope
          : !owns(request.reach) ||
            !(request.reach instanceof PreparedDetailReach) ||
            request.reach.explicit.token !== token
      )
        throw new Error("Geometry request/attempt mismatch");
      const captured =
        request.representation === "overview"
          ? Object.freeze({
              ...request,
              subjects:
                request.subjects.kind === "all"
                  ? Object.freeze({ kind: "all" as const })
                  : Object.freeze({
                      kind: "ids" as const,
                      ids: Object.freeze([...request.subjects.ids]),
                    }),
            })
          : Object.freeze({ ...request });
      if (key.sortedKeyInput !== canonicalEnvironmentInput(captured))
        throw new Error("Geometry key/request mismatch");
      return own(mintGeometry(Object.freeze({ ...key }), output, route, token, captured));
    },
    mintGeometryFromHost: <T>(
      descriptor: ResolvedReadDescriptor,
      output: z.ZodType<GeometryOutcome<T>>,
      route: AdmittedRoute,
      token: AcceptanceToken,
      request: GeometryRequest<SceneContextRepresentation>,
    ) => {
      if (
        request.representation === "overview"
          ? request.scope !== token.scope
          : !owns(request.reach) || request.reach.explicit.token !== token
      )
        throw Error("Geometry request/attempt mismatch");
      const nativeTarget =
        request.representation !== "overview" &&
        request.reach.subject.kind === "subjects" &&
        "scope" in request.reach.subject
          ? request.reach.subject.scope.identity.target
          : undefined;
      if (
        (request.native && descriptor.operationKey !== request.native.operationKey) ||
        (nativeTarget?.kind === "document" &&
          (!("openId" in descriptor.openDocumentLifetime) ||
            descriptor.openDocumentLifetime.openId !== nativeTarget.ref.openId)) ||
        descriptor.representation !==
          (request.representation === "overview" ? "overview" : "detail")
      )
        throw Error("Host descriptor/request mismatch");
      const freeze = (value: unknown): void => {
        if (value && typeof value === "object" && !Object.isFrozen(value)) {
          Object.values(value).forEach(freeze);
          Object.freeze(value);
        }
      };
      freeze(descriptor);
      const captured = descriptor;
      const key: ResolvedReadKey = Object.freeze({
        op: captured.operationKey,
        processIncarnation: canonicalEnvironmentInput(captured.processIncarnation),
        documentLifetime: canonicalEnvironmentInput(captured.openDocumentLifetime),
        sortedKeyInput: captured.normalizedInput,
        freshnessGeneration: captured.freshnessGeneration,
      });
      // Host identity stays host-owned; only this exact D instance gains nominal authority.
      return own(newGeometry(key, output, route, token, request, captured));
    },
    mintNative: (submit: import("./work-journal-door.ts").WorkJournalDoor["submit"]) =>
      own(mintNative(submit)),
  });
}
export type RouteEnvironmentIssuer = ReturnType<typeof createRouteEnvironmentIssuer>;

export type WorkReadCapability = Pick<
  import("./work-journal-door.ts").WorkJournalDoor,
  "lifetime" | "open" | "receipts"
>;
export type WorkSubmitCapability = Pick<
  import("./work-journal-door.ts").WorkJournalDoor,
  "submitWork" | "submit" | "accepted"
>;
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
/** Baseline services are installed once by application composition. A route cannot
 * request an optional group without declaring it, even through a non-literal variable. */
export type KernelServices = Pick<
  RouteEnvironment,
  "reads" | "readings" | "clock" | "availability"
> & {
  readonly local?: LocalCommandPort;
  readonly work?: import("./work-journal-door.ts").WorkJournalDoor;
  readonly geometry?: GeometryReadDoor<unknown>;
  readonly target?: () => ScopeToken["identity"]["target"];
  readonly nativeWrite?: import("./work-journal-door.ts").WorkJournalDoor;
  readonly submitNative?: import("./work-journal-door.ts").WorkJournalDoor["submit"];
};
/** Application effects stay outside pure route bodies and the native action journal. */
export type LocalCommandCall = Readonly<{ verb: string; entry: string; input: unknown }>;
export type LocalCommandPort = (call: LocalCommandCall, signal: AbortSignal) => Promise<unknown>;
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
