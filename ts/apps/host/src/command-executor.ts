import type { z } from "zod";
import type { RouteWorkspace } from "@pe/runtime";
import type {
  ActionAdmission,
  ActionStep,
  ActionReceipt,
  Basis,
  Caller,
  Claim,
  Command,
  Consumed,
  Effect,
  Footprint,
  WorkHandle,
  WorkPath,
  RouteStateSpec,
  ExecutionTarget,
  ActionNeed,
  CommandRefusal,
} from "@pe/agent-contracts";
import type { ActionExecution } from "./action-journal.ts";

export class CommandRejected extends Error {
  constructor(readonly refusal: CommandRefusal) {
    super(
      "message" in refusal
        ? refusal.message
        : refusal.kind === "stale_revision"
          ? `Work changed to r${refusal.live}`
          : refusal.kind === "claimed"
            ? `Resource is reserved by ${refusal.by}`
            : "Consumed input changed",
    );
  }
}
/** Domain rejection says why. Only the engine and transport boundary know dispatch facts. */
export const refused = (message: string, code = "domain.refused") =>
  new CommandRejected({ kind: "domain", code, message });

/** An independently observed transport outcome, never a domain eligibility decision. */
export class StepFailure extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly outcome: "refused" | "failed" | "cancelled" | "unknown",
    readonly result?: unknown,
    readonly details?: {
      nativeOutcome?: string;
      issues?: Extract<ActionStep, { state: "failed" }>["issues"];
    },
  ) {
    super(message);
  }
}

type WorkSpec<S extends z.ZodType = z.ZodType> = RouteStateSpec<S> & {
  editable: readonly WorkPath[];
};
interface WorkSelection<W> {
  /** Concrete cell paths, constrained at runtime by the tool's editable universe. */
  cells?: readonly WorkPath[];
  /** Freeze edited-cell membership in these declared ranges; suggestions remain unrelated. */
  edits?: readonly WorkPath[];
  /** Non-cell facts used by this command. The first segment belongs to this Work schema. */
  facts?: readonly (readonly [keyof W & string, ...(string | number)[]])[];
}
export interface CommandContext {
  admission: ActionAdmission;
  caller: Caller;
  basis: Basis | null;
  /** The same owner the journal gates and publishes. Throws only when a workless fixture uses it. */
  readonly work: RouteWorkspace;
  consumed: Consumed[];
  selectWork<S extends z.ZodType>(
    spec: WorkSpec<S>,
    handle: WorkHandle,
    select?: (
      doc: z.output<S>,
      cells: readonly { path: WorkPath; cell: import("@pe/agent-contracts").CellLike }[],
    ) => WorkSelection<z.output<S>>,
  ): Promise<z.output<S>>;
  read: { receipts(id?: string): ActionReceipt[] };
}
export interface CommandBinding {
  consumes?: Consumed[];
  claims?: Claim[];
  effects: Footprint;
  basis?: Basis | null;
  /** Closes over already bound source facts. It runs after consent and never on resume. */
  prepare?(): Promise<unknown>;
}
export type StepRecovery = (
  step: ActionStep,
  prepared: unknown,
  target: ExecutionTarget,
) => Promise<{
  step: ActionStep;
  evidence: unknown;
  observation?: Extract<import("@pe/agent-contracts").ReceiptFact, { kind: "native" }>;
}>;

/** One stable executor per command. Only bind creates invocation-local closures. */
export interface CommandExecutor {
  definition: Command | ((context: CommandContext) => Command | Promise<Command>);
  prepared: z.ZodType;
  bind(context: CommandContext): Promise<CommandBinding>;
  run(context: CommandContext, execution: ActionExecution): Promise<unknown>;
  recover?: StepRecovery;
  cancel?(requestId: string): Promise<unknown>;
}
export type CommandRegistry = (key: string) => CommandExecutor;
/** Resource I/O only. Control hooks belong to the stable registry entries. */
export interface CommandResources {
  work?: RouteWorkspace;
  probe(dependency: Exclude<Consumed, { kind: "work" }>): Promise<unknown>;
  target?(target: ExecutionTarget, needs: ActionNeed): Promise<void>;
  effectPath?(effect: Extract<Effect, { kind: "member" }>): Promise<string | undefined>;
}
export interface CommandEnvironment extends CommandResources {
  resolve: CommandRegistry;
}

/** Type erasure occurs here after the journal validates the command and preparation schemas. */
export function command<C extends Command, S extends z.ZodType>(
  definition: C,
  prepared: S,
  implementation: Omit<CommandExecutor, "definition" | "prepared" | "bind" | "run" | "recover"> & {
    bind(
      context: Omit<CommandContext, "admission"> & {
        admission: Omit<ActionAdmission, "input"> & { input: z.output<C["input"]> };
      },
    ): Promise<CommandBinding>;
    run(
      context: Omit<CommandContext, "admission"> & {
        admission: Omit<ActionAdmission, "input"> & { input: z.output<C["input"]> };
      },
      execution: Omit<ActionExecution, "prepared"> & { readonly prepared: z.output<S> },
    ): Promise<unknown>;
    recover?(
      step: ActionStep,
      prepared: z.output<S>,
      target: ExecutionTarget,
    ): ReturnType<StepRecovery>;
  },
): CommandExecutor {
  return { definition, prepared, ...implementation } as CommandExecutor;
}
