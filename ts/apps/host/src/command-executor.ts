import type { RouteWorkspace } from "@pe/runtime";
import type { Consumed, Effect as RouteEffect, ExecutionTarget, ActionNeed, ActionAdmission } from "@pe/agent-contracts";
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
  target?(target: ExecutionTarget, needs: ActionNeed): Promise<void>;
  effectPath?(effect: Extract<RouteEffect, { kind: "member" }>): Promise<string | undefined>;
}
export interface CommandEnvironment extends CommandResources {
  resolve: CommandRegistry;
}
