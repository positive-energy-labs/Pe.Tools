import {
  commands,
  type ActionReceipt,
  type Command,
  type ExecutionTarget,
  type Tool,
  type WorkHandle,
  type SemanticActionKey,
} from "@pe/agent-contracts";
import type { z } from "zod";
import { runSemanticAction } from "../../../../packages/mcps/src/shared/takeoff-action-client";
import { defineRoute, type RouteManifest } from "./manifest";

type WithoutWork<I> = I extends unknown ? Omit<I, "work"> : never;
type CommandResult<C> = C extends { result: z.ZodType<infer R> } ? R : unknown;
type CommandReceipt<C> =
  | Exclude<ActionReceipt, { state: "succeeded" }>
  | (Extract<ActionReceipt, { state: "succeeded" }> & { result: CommandResult<C> });
export type BoundCommands = {
  readonly [K in keyof typeof commands]: (
    input: WithoutWork<z.input<(typeof commands)[K]["input"]>>,
    selection?: { work?: WorkHandle; target?: ExecutionTarget },
  ) => Promise<CommandReceipt<(typeof commands)[K]>>;
};

/** Catalog/manifest dispatch is the dynamic boundary; literal consumers retain typed inputs. */
export const invokeBoundCommand = (
  bound: BoundCommands,
  key: SemanticActionKey,
  input: Record<string, unknown>,
) => (bound[key] as (input: Record<string, unknown>) => Promise<ActionReceipt>)(input);

/** A press closes over the Work that rendered it. The outbox retains that exact invocation. */
export function bindCommands(
  target: ExecutionTarget,
  handle: WorkHandle | null,
  refused: (row: ActionReceipt) => void,
): BoundCommands {
  return Object.fromEntries(
    Object.entries(commands).map(([key, definition]) => [
      key,
      async (
        input: Record<string, unknown>,
        selection?: { work?: WorkHandle; target?: ExecutionTarget },
      ) => {
        const association = (definition as Command).work;
        const rendered = selection?.work ?? handle;
        const destination = selection?.target ?? target;
        if (association && !rendered) throw Error("Work has not been read yet");
        const intent = association ? association.bind(input, rendered!) : input;
        const row = await runSemanticAction(
          key as keyof typeof commands,
          structuredClone(intent) as Record<string, unknown>,
          destination,
        );
        if (row.state !== "succeeded") refused(row as ActionReceipt);
        return row as ActionReceipt;
      },
    ]),
  ) as unknown as BoundCommands;
}

/** Portable Work identity and schema bind once; grouping and readiness stay presentation. */
export function presentation<W, R extends string, P, A extends string>(
  tool: Tool,
  manifest: Omit<RouteManifest<W, R, P, A>, "work">,
): RouteManifest<W, R, P, A> {
  return defineRoute({ ...manifest, ...(tool.work ? { work: tool.work as never } : {}) });
}
