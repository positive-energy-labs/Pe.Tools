import { z } from "zod";
import { instancesStartSchema, type Claim, type ActionReceipt } from "@pe/agent-contracts";
import { CommandRejected } from "@pe/host-internal/command-executor";
import type { RouteWorkspace } from "@pe/runtime";
import type {
  Consumed,
  Effect as RouteEffect,
  ExecutionTarget,
  ActionNeed,
  ActionAdmission,
} from "@pe/agent-contracts";
import type { CommandRegistry, CommandWorkReads } from "@pe/host-internal/command-executor";

/** Resource I/O only. Control hooks belong to the stable registry entries. */
export interface CommandResources {
  readonly readOwnership?: import("./reads/read-ownership.ts").ReadOwnership;
  work?: RouteWorkspace;
  workReads?: (admission: ActionAdmission) => CommandWorkReads;
  /**
   * `moment` is the gate that asks; absent means the strongest reading. `pass` is one gate's walk
   * over an action's consumed facts: probes of one pass may share a read, and no read outlives it.
   */
  probe(
    dependency: Exclude<Consumed, { kind: "work" }>,
    moment?: string,
    pass?: object,
  ): Promise<unknown>;
  /** Confirms the target against the command contract; answers a document's Address, null when unsaved. */
  target?(target: ExecutionTarget, needs: ActionNeed): Promise<string | null | void>;
  effectPath?(effect: Extract<RouteEffect, { kind: "member" }>): Promise<string | undefined>;
}
export interface CommandEnvironment extends CommandResources {
  resolve: CommandRegistry;
}

const slotYear = z.object({ year: instancesStartSchema.shape.year });
const lifecycleVerb = new Map([
  ["instances.start", "started"],
  ["instances.open", "opened"],
  ["instances.stop", "stopped"],
]);

function describeClaim(claim: Claim, holder: ActionReceipt): string {
  switch (claim.kind) {
    case "session-slot": {
      const year = slotYear.safeParse(claim.selector);
      const revit = year.success ? `Revit ${year.data.year}` : "This Revit";
      const verb = lifecycleVerb.get(holder.key);
      const held = verb
        ? `${revit} is already being ${verb}.`
        : `Another action is using ${revit}.`;
      return `${held} Try again when that action finishes.`;
    }
    case "receipt":
      return holder.state === "running"
        ? "Another action is applying this plan. Wait for it to finish, then generate a fresh plan."
        : "An earlier apply already used this plan. Generate a fresh plan before trying again.";
    case "reconciliation":
      return "Pe is already cleaning up after this action. Wait for cleanup to finish, then check the action’s outcome.";
  }
}

export const claimRejected = (claim: Claim, holder: ActionReceipt) =>
  new CommandRejected({ kind: "claimed", claim, by: holder.id }, 409, describeClaim(claim, holder));
