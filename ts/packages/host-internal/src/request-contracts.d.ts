import type { Cause, Context, Effect, Schema } from "effect";
import type { Caller } from "../../agent-contracts/src/caller.ts";
import type { Refusal } from "../../agent-contracts/src/caller.ts";
import type { CommandRefusal } from "../../agent-contracts/src/command.ts";
import type {
  NativeReadDoor,
  NativeReadResult,
  ResolvedReadDescriptor,
  ReadCost,
} from "../../agent-contracts/src/native-read-door.ts";
import type {
  NativeWriteCapability,
  ReadingsSubscriptionCapability,
  JournalCommandHandle,
} from "../../agent-contracts/src/route-kernel-environment.ts";
import type { InvocationBasis } from "../../agent-contracts/src/route-kernel-page.ts";
import type { Immutable } from "../../agent-contracts/src/route-kernel-data.ts";
import type { HostSessionScope } from "../../host-contracts/src/operation-types.ts";
import type { Resolved } from "../../host-contracts/src/vendor/generated/pe-revit-contract.ts";
import type { NativeOutcome } from "../../agent-contracts/src/work-journal-door.ts";

export type {
  ResolvedReadDescriptor,
  NativeReadResult,
  ReadCost,
  NativeWriteCapability,
  JournalCommandHandle,
  NativeOutcome,
};
export type {
  AcceptedResult,
  Observation,
  WorkFeedState,
  WorkJournalDoor,
} from "../../agent-contracts/src/work-journal-door.ts";
export type NativeReadCapability<Request, A> = NativeReadDoor<Request, A>;
export type SubscriptionCapability = ReadingsSubscriptionCapability;
export type WorkSubscriptionCapability = Pick<
  import("../../agent-contracts/src/work-journal-door.ts").WorkJournalDoor,
  "lifetime" | "open"
>;

/** Admission owns minting. Neither a selector nor a caller's raw JSON is a prepared read. */
export type ReadDescriptor<F extends "verified" | "unavailable" = "verified"> = Omit<
  ResolvedReadDescriptor,
  "freshnessGeneration" | "freshnessEvidence"
> & {
  readonly operation: {
    readonly key: ResolvedReadDescriptor["operationKey"];
    readonly intent: "Read";
  };
  readonly responseSchemaVersion: string;
} & (F extends "verified"
    ? { readonly freshnessGeneration: string; readonly freshnessEvidence?: never }
    : { readonly freshnessGeneration: null; readonly freshnessEvidence: "unavailable" });

/** No public constructor. Slice B's private admission module owns the runtime mint.
 * The weaker variant explicitly cannot promise fresh-after-write isolation.
 * normalizedInput is Schema-encoded with recursively sorted keys and ordered arrays.
 * Dispatch ids and caller attribution never participate in read equivalence. */
export declare class PreparedRead<A, F extends "verified" | "unavailable" = "verified"> {
  private readonly admissionAuthority: void;
  private constructor();
  readonly descriptor: ReadDescriptor<F>;
  readonly response: Schema.Schema<A>;
}

export interface NativeAnswer<A, F extends "verified" | "unavailable" = "verified"> {
  readonly value: A;
  readonly nativeRequestId: string;
  readonly actualTarget: Pick<
    ResolvedReadDescriptor,
    "processIncarnation" | "openDocumentLifetime"
  >;
  readonly freshness: Pick<ReadDescriptor<F>, "freshnessGeneration" | "freshnessEvidence">;
  readonly cost: ReadCost;
  readonly outcome: NativeOutcome;
  /** Shared answers cannot carry caller authority, even through structural assignment. */
  readonly caller?: never;
  readonly requestId?: never;
  readonly owner?: never;
  readonly causalParent?: never;
}

declare const validatedOwner: unique symbol;
/** Host-only authority minted after validation, never a client-supplied string. */
export type ValidatedOwner = string & { readonly [validatedOwner]: true };
export interface CancellationPolicy {
  readonly descendants: "active-admitted";
  readonly committedWrites: "preserve";
  readonly parentSettlement: "await-required-descendant-terminal-evidence";
}
export type NativeTerminalEvidence = {
  readonly nativeRequestId: string;
} & (
  | {
      readonly outcome: Exclude<
        NativeOutcome,
        "unknown-until-reconciled" | "native-cancel-requested"
      >;
      readonly settlement: "terminal";
    }
  | { readonly outcome: NativeOutcome; readonly settlement: "unknown-until-reconciled" }
);
export type CausalTerminalState =
  | {
      readonly kind: "unsettled";
      readonly requiredDescendants: readonly JournalCommandHandle["id"][];
      readonly evidence: readonly NativeTerminalEvidence[];
    }
  | {
      readonly kind: "settled";
      readonly requiredDescendants: readonly [];
      readonly evidence: readonly (NativeTerminalEvidence & { readonly settlement: "terminal" })[];
    };
/** Host-only. The parent cannot settle while any policy-required descendant lacks terminal
 * evidence, including unknown native outcomes. Committed writes remain committed.
 * Promotion to an agent-contracts wire contract requires a separate counsel ruling. */
export interface CausalOwnership {
  readonly owner: ValidatedOwner;
  readonly causalParent: InvocationBasis["causalParent"];
  readonly policy: CancellationPolicy;
  readonly terminal: CausalTerminalState;
}
/** Host-only, validated separately from submit/join/observe. Stop cancels active admitted
 * descendants of this owner and preserves committed writes. The returned parent remains
 * unsettled until all required descendants have terminal evidence, including unknown work. */
export interface StopCapability {
  readonly ownership: CausalOwnership;
  readonly stop: () => Effect.Effect<CausalTerminalState, DoorFailure, RequestIdentity>;
}
export interface RequestIdentityData {
  readonly requestId: string;
  readonly caller: Immutable<Caller>;
  readonly scope: Immutable<HostSessionScope>;
  readonly ownership: Immutable<CausalOwnership>;
}
declare const requestIdentity: unique symbol;
export interface RequestIdentity {
  readonly [requestIdentity]: true;
}
/** Required Context.Service, with no default. Admission provides this once. */
export declare const RequestIdentity: Context.Service<RequestIdentity, RequestIdentityData>;

export type ResolvedSdkSession = Readonly<{
  sessionId: string;
  processIncarnation: ResolvedReadDescriptor["processIncarnation"];
  openDocumentLifetime: ResolvedReadDescriptor["openDocumentLifetime"];
  resolved: Readonly<Resolved>;
}>;
export type AttachmentTarget =
  | { readonly session: string }
  | { readonly sdkSession: string }
  | { readonly id: string };
export interface SdkSessionService {
  /** Full SDK eligibility/incarnation checks; never merely attachment resolution.
   * CLI and bounded, generation-invalidated cache are scoped service dependencies. */
  readonly resolve: (
    scope: Readonly<HostSessionScope>,
  ) => Effect.Effect<ResolvedSdkSession, DoorFailure, RequestIdentity>;
  readonly resolveAttachment: (
    target: AttachmentTarget,
  ) => Effect.Effect<ResolvedSdkSession, DoorFailure, RequestIdentity>;
}
declare const sdkSession: unique symbol;
export interface SdkSession {
  readonly [sdkSession]: true;
}
export declare const SdkSession: Context.Service<SdkSession, SdkSessionService>;

/** Schema-backed error constructors are implemented by the owning slices, not this freeze.
 * Owners project internal failures here; the router maps the closed union once.
 * Interruption stays interruption, never a DoorFailure. */
export interface DoorEvidence {
  readonly nativeRequestId?: string;
  readonly receiptId?: string;
  readonly actualTarget?: NativeAnswer<never>["actualTarget"];
}
type FailureFields = {
  readonly message: Schema.String;
  readonly status: Schema.Number;
  readonly problem: Schema.String;
  readonly evidence: Schema.optionalKey<Schema.declare<DoorEvidence>>;
  readonly nativeOutcome: Schema.optionalKey<Schema.declare<NativeOutcome>>;
};
type FrozenError<
  Self,
  Tag extends string,
  Fields extends Schema.Struct.Fields = FailureFields,
> = Schema.Class<Self, Schema.TaggedStruct<Tag, Fields>, Cause.YieldableError>;

declare const InvalidRequestBase: FrozenError<InvalidRequest, "InvalidRequest", FailureFields>;
export declare class InvalidRequest extends InvalidRequestBase {}

declare const RefusedBase: FrozenError<
  Refused,
  "Refused",
  FailureFields & { readonly refusal: Schema.declare<Refusal> }
>;
export declare class Refused extends RefusedBase {}

declare const NoRevitSessionBase: FrozenError<NoRevitSession, "NoRevitSession", FailureFields>;
export declare class NoRevitSession extends NoRevitSessionBase {}

declare const BridgeErrorBase: FrozenError<BridgeError, "BridgeError", FailureFields>;
export declare class BridgeError extends BridgeErrorBase {}

declare const CancelledBase: FrozenError<Cancelled, "Cancelled", FailureFields>;
export declare class Cancelled extends CancelledBase {}

declare const ReadBusyBase: FrozenError<ReadBusy, "ReadBusy", FailureFields>;
export declare class ReadBusy extends ReadBusyBase {}

declare const ReadRetiringBase: FrozenError<ReadRetiring, "ReadRetiring", FailureFields>;
export declare class ReadRetiring extends ReadRetiringBase {}

declare const CommandRejectedBase: FrozenError<
  CommandRejected,
  "CommandRejected",
  FailureFields & { readonly refusal: Schema.declare<CommandRefusal> }
>;
export declare class CommandRejected extends CommandRejectedBase {}

declare const StepFailureBase: FrozenError<StepFailure, "StepFailure", FailureFields>;
export declare class StepFailure extends StepFailureBase {}

declare const LocalOpErrorBase: FrozenError<LocalOpError, "LocalOpError", FailureFields>;
export declare class LocalOpError extends LocalOpErrorBase {}

declare const ConsentPersistFailedBase: FrozenError<
  ConsentPersistFailed,
  "ConsentPersistFailed",
  FailureFields
>;
export declare class ConsentPersistFailed extends ConsentPersistFailedBase {}

declare const ConsentNotifyFailedBase: FrozenError<
  ConsentNotifyFailed,
  "ConsentNotifyFailed",
  FailureFields
>;
export declare class ConsentNotifyFailed extends ConsentNotifyFailedBase {}

declare const StoreClosedBase: FrozenError<StoreClosed, "StoreClosed", FailureFields>;
export declare class StoreClosed extends StoreClosedBase {}

export type DoorFailure =
  | InvalidRequest
  | Refused
  | NoRevitSession
  | BridgeError
  | Cancelled
  | ReadBusy
  | ReadRetiring
  | CommandRejected
  | StepFailure
  | LocalOpError
  | ConsentPersistFailed
  | ConsentNotifyFailed
  | StoreClosed;
export type DoorFailureMapper<A> = {
  readonly [Tag in DoorFailure["_tag"]]: (
    failure: Extract<DoorFailure, { readonly _tag: Tag }>,
  ) => A;
};
