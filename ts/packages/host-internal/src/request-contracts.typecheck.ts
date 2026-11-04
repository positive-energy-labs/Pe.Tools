import type { Context, Effect, Schema } from "effect";
import type {
  CausalOwnership,
  CausalTerminalState,
  DoorFailure,
  DoorFailureMapper,
  NativeAnswer,
  NativeOutcome,
  NativeReadCapability,
  NativeWriteCapability,
  PreparedRead,
  ReadDescriptor,
  RequestIdentity,
  RequestIdentityData,
  ResolvedReadDescriptor,
  SdkSessionService,
  StopCapability,
  SubscriptionCapability,
  WorkSubscriptionCapability,
} from "./request-contracts.d.ts";
import type { InvocationBasis } from "../../agent-contracts/src/route-kernel-page.ts";
import type { NativeOutcome as JournalNativeOutcome } from "../../agent-contracts/src/work-journal-door.ts";

type Assert<T extends true> = T;
type Assignable<A, B> = [A] extends [B] ? true : false;
type Equal<A, B> = Assignable<A, B> extends true ? Assignable<B, A> : false;

/** Compile-only. Each expected diagnostic must remain present; this file emits no runtime. */
export type FreezeAssertions = [
  Assert<Equal<NativeOutcome, JournalNativeOutcome>>,
  Assert<Equal<CausalOwnership["causalParent"], InvocationBasis["causalParent"]>>,
  Assert<Assignable<typeof RequestIdentity, Context.Service<RequestIdentity, RequestIdentityData>>>,
  Assert<Equal<Effect.Services<ReturnType<SdkSessionService["resolve"]>>, RequestIdentity>>,
  Assert<Equal<Effect.Services<ReturnType<StopCapability["stop"]>>, RequestIdentity>>,
  Assert<Equal<NativeReadCapability<never, never>["lifetime"], "read">>,
  Assert<Equal<NativeWriteCapability["lifetime"], "command">>,
  Assert<Equal<SubscriptionCapability["lifetime"], "subscription">>,
  Assert<Equal<WorkSubscriptionCapability["lifetime"], "subscription">>,
  Assert<Assignable<ReadDescriptor<"unavailable">, ResolvedReadDescriptor>>,
  Assert<
    Assignable<PreparedRead<number, "unavailable">["descriptor"], ReadDescriptor<"unavailable">>
  >,
  Assert<Assignable<DoorFailure, Error>>,
  Assert<
    // @ts-expect-error A descriptor and decoder cannot forge admission's nominal authority.
    Assignable<
      { descriptor: ReadDescriptor; response: Schema.Schema<number> },
      PreparedRead<number>
    >
  >,
  // @ts-expect-error A command cannot be admitted as a read.
  Assert<Assignable<{ key: string; intent: "Write" }, ReadDescriptor["operation"]>>,
  // @ts-expect-error An active-document selector is not a resolved lifetime.
  Assert<Assignable<{ kind: "active-document" }, ReadDescriptor["openDocumentLifetime"]>>,
  // @ts-expect-error A process PID alone is not a resolved process incarnation.
  Assert<Assignable<{ pid: number }, ReadDescriptor["processIncarnation"]>>,
  Assert<
    // @ts-expect-error RequestIdentity cannot disappear from the admitted environment.
    Assignable<
      Effect.Effect<number, DoorFailure, RequestIdentity>,
      Effect.Effect<number, DoorFailure>
    >
  >,
  // @ts-expect-error Observers cannot submit.
  SubscriptionCapability["submit"],
  // @ts-expect-error Observers cannot Stop.
  SubscriptionCapability["stop"],
  // @ts-expect-error Work observers cannot submit.
  WorkSubscriptionCapability["submit"],
  // @ts-expect-error Work observers cannot Stop.
  WorkSubscriptionCapability["stop"],
  // @ts-expect-error Submit authority has no raw bridge launcher.
  NativeWriteCapability["invoke"],
  // @ts-expect-error Submit authority has no raw journal launcher.
  NativeWriteCapability["launch"],
  // @ts-expect-error A subscription cannot masquerade as read lifetime.
  Assert<Assignable<SubscriptionCapability, Pick<NativeReadCapability<never, never>, "lifetime">>>,
  Assert<
    // @ts-expect-error Shared native answers cannot acquire caller attribution.
    Assignable<Omit<NativeAnswer<number>, "caller"> & { caller: string }, NativeAnswer<number>>
  >,
  // @ts-expect-error A mapper must handle StoreClosed as well as every other frozen tag.
  Assert<Assignable<Omit<DoorFailureMapper<string>, "StoreClosed">, DoorFailureMapper<string>>>,
  Assert<
    // @ts-expect-error A descriptor without a generation cannot become a verified prepared read.
    Assignable<
      Omit<ResolvedReadDescriptor, "freshnessGeneration">,
      PreparedRead<number>["descriptor"]
    >
  >,
  // @ts-expect-error Today's null generation is explicitly weaker than verified freshness.
  Assert<Assignable<ReadDescriptor<"unavailable">, PreparedRead<number>["descriptor"]>>,
  // @ts-expect-error A verified read cannot accept the unrefined string-or-null door descriptor.
  Assert<Assignable<ResolvedReadDescriptor, PreparedRead<number>["descriptor"]>>,
  Assert<
    // @ts-expect-error A settled parent cannot retain unresolved required descendants.
    Assignable<
      { kind: "settled"; requiredDescendants: readonly [string]; evidence: readonly [] },
      CausalTerminalState
    >
  >,
  Assert<
    // @ts-expect-error Unknown native outcomes cannot establish terminal settlement of a parent.
    Assignable<
      {
        kind: "settled";
        requiredDescendants: readonly [];
        evidence: readonly [
          {
            nativeRequestId: string;
            outcome: "unknown-until-reconciled";
            settlement: "unknown-until-reconciled";
          },
        ];
      },
      CausalTerminalState
    >
  >,
];
