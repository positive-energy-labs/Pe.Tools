import { Schema } from "effect";

export const CommandId = Schema.String.pipe(Schema.brand("CommandId"));
export type CommandId = typeof CommandId.Type;
export const Generation = Schema.String.pipe(Schema.brand("CommandGeneration"));
export const ExecutionId = Schema.String.pipe(Schema.brand("CommandExecutionId"));
export const StepRequestId = Schema.String.pipe(Schema.brand("CommandStepRequestId"));
export type StepRequestId = typeof StepRequestId.Type;
export const CommandRef = Schema.Struct({ id: CommandId });
export type CommandRef = typeof CommandRef.Type;

/** JSON text is decoded by the command's intent schema only after the root continuation gate. */
export const NewCommand = Schema.Struct({ key: Schema.String, input: Schema.String });
export type NewCommand = typeof NewCommand.Type;
export const InertTicket = Schema.TaggedStruct("InertTicket", {
  ref: CommandRef,
  intent: NewCommand,
});
export type InertTicket = typeof InertTicket.Type;

export const OwnerOutcome = Schema.Struct({
  outcome: Schema.Literals(["completed", "refused", "failed", "cancelled", "unknown"]),
  dispatch: Schema.Literals(["not-dispatched", "dispatched", "unknown"]),
  value: Schema.NullOr(Schema.String),
  evidence: Schema.String,
});
export type OwnerOutcome = typeof OwnerOutcome.Type;

export const CommandProblem = Schema.Literals([
  "unavailable",
  "conflict",
  "stopped",
  "incompatible",
  "overload",
  "storage",
  "unauthorized",
  "invalid",
  "observation-lost",
]);

export const CommandObservation = Schema.Struct({
  ref: CommandRef,
  state: Schema.Literals(["allocated", "accepted", "stopped", "blocked", "terminal"]),
  stop: Schema.Boolean,
  /** An inspectable result never grants fresh effect authority. */
  result: Schema.NullOr(Schema.String),
  problem: Schema.NullOr(CommandProblem),
});
export type CommandObservation = typeof CommandObservation.Type;

export class CommandFailure extends Schema.TaggedError<CommandFailure>()("CommandFailure", {
  problem: CommandProblem,
  ref: Schema.NullOr(CommandRef),
  cause: Schema.optional(Schema.Defect()),
}) {
  override get message() {
    return `Command ${this.problem}${this.ref ? ` (${this.ref.id})` : ""}`;
  }
}

export const InvocationRecord = Schema.Union([
  Schema.TaggedStruct("Allocating", { intent: NewCommand }),
  Schema.TaggedStruct("Allocated", { ticket: InertTicket }),
  Schema.TaggedStruct("SubmissionPending", { ticket: InertTicket }),
  Schema.TaggedStruct("Accepted", { ticket: InertTicket, observation: CommandObservation }),
  Schema.TaggedStruct("Terminal", { ticket: InertTicket, observation: CommandObservation }),
  Schema.TaggedStruct("Unavailable", { ref: Schema.NullOr(CommandRef) }),
]);
export type InvocationRecord = typeof InvocationRecord.Type;
