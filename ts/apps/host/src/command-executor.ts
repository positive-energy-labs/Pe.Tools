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
  ExecutionTarget,
  ActionNeed,
} from "@pe/agent-contracts";
import type { ActionExecution, ActionJournal } from "./action-journal.ts";

export interface CommandContext {
  admission: ActionAdmission;
  caller: Caller;
  basis: Basis | null;
  owner: ActionJournal;
  work?: RouteWorkspace;
  consumed: Consumed[];
  read: {
    work(handle: WorkHandle, route: string): Promise<{ doc: unknown; revision: number }>;
    receipts(id?: string): ActionReceipt[];
  };
}

export interface CommandBinding {
  consumes?: Consumed[];
  claims?: Claim[];
  effects: Footprint;
  basis?: Basis | null;
}

/** Domain facts and execution, with lifecycle and fencing owned by ActionJournal. */
export interface CommandExecutor {
  definition: Command;
  bind(context: CommandContext): Promise<CommandBinding>;
  prepared: z.ZodType;
  prepare?(context: CommandContext): Promise<unknown>;
  run(context: CommandContext, execution: ActionExecution): Promise<unknown>;
  recover?(
    step: ActionStep,
    prepared: unknown,
  ): Promise<{
    step: ActionStep;
    evidence: unknown;
    observation?: import("@pe/agent-contracts").ReceiptFact & { kind: "native" };
  }>;
  cancel?(requestId: string): Promise<unknown>;
}

/** Readers return current domain facts. The journal owns when and how they compare. */
export interface CommandReads {
  work?: RouteWorkspace;
  read(
    consumed: Exclude<Consumed, { kind: "work" | "receipt" | "file" | "capture" }>,
  ): Promise<unknown>;
  cancel?(requestId: string): Promise<unknown>;
  target?(target: ExecutionTarget, needs: ActionNeed): Promise<void>;
  effectPath?(effect: Extract<Effect, { kind: "member" }>): Promise<string | undefined>;
  recover?(
    step: ActionStep,
  ): Promise<{
    step: ActionStep;
    evidence: unknown;
    observation?: Extract<import("@pe/agent-contracts").ReceiptFact, { kind: "native" }>;
  }>;
}

export type CommandFactory = (
  context: CommandContext,
) => CommandExecutor | Promise<CommandExecutor>;
export type CommandRegistry = (key: string) => CommandFactory;
export const hasEffects = (effects: readonly Effect[]) => effects.length > 0;
