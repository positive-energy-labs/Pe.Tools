import { Effect } from "effect";
import { z } from "zod";
import { commands, refusalText, workHandleSchema, type WorkKey } from "@pe/agent-contracts";
import {
  FINDINGS_DOORS,
  FINDINGS_OWNER,
  findingSchema,
  findingsWorkSchema,
  type Finding,
  type FindingInput,
} from "@pe/agent-contracts/slots";
import type { RouteWorkspace } from "@pe/runtime";
import { command, io, refused, StepFailure, type CommandWorkReads } from "../command-executor.ts";
import { productRouteWorkPath } from "../product-paths.ts";

/*
 * The host side of findings (ADR 0035 rule 9): two catalog doors over one Work per document under
 * owner key `findings` on the existing bindings. `findings.write` is a Work write (the host stamps
 * `by` and `at`), never a ModelWrite; `findings.list` is a Read. Pea reaches both through the
 * catalog; undo is the Work journal's per-author step (`RouteWorkspace.step` with `own`).
 */

/** `reads` is the invocation's own Work reader (`CommandContext.work`), which carries its read context. */
export async function findingsList(reads: Pick<CommandWorkReads, "view">, key: WorkKey, subject?: string): Promise<readonly Finding[]> {
  const view = await reads.view(key, FINDINGS_OWNER);
  const { findings } = findingsWorkSchema.parse(view?.doc ?? {});
  return Object.values(findings).filter((f) => subject === undefined || f.subject === subject);
}

export async function findingsWrite(
  workspace: RouteWorkspace,
  handle: z.output<typeof workHandleSchema>,
  input: FindingInput,
  by: Finding["by"],
): Promise<{ readonly revision: number }> {
  // The contract refuses a verdict the kind does not declare, before any Work changes.
  const finding = findingSchema.parse({ ...input, by, at: new Date().toISOString() });
  const result = await workspace.write(handle.key, FINDINGS_OWNER, by === "pea" ? "pea" : "human", {
    kind: "apply",
    press: `finding:${finding.id}`,
    label: `${finding.kind} on ${finding.subject}`,
    expectedRevision: handle.revision,
    patches: [{ path: ["findings", finding.id], value: finding }],
  });
  if (!result.ok) throw new StepFailure(refusalText(result), 409, "refused", result);
  return { revision: result.revision };
}

const handleOf = (input: { work?: z.output<typeof workHandleSchema> }) => {
  if (!input.work) throw refused("The document's findings Work handle is required");
  return input.work;
};

export const findingsExecutors = (workspace: RouteWorkspace | undefined) => ({
  [FINDINGS_DOORS.list]: command(commands[FINDINGS_DOORS.list], commands[FINDINGS_DOORS.list].input, {
    async bind({ admission: { input } }) {
      if (!workspace) throw refused("Work storage is unavailable");
      handleOf(input);
      return { effects: [], prepare: async () => input };
    },
    run: (ctx, execution) =>
      io(async () => ({ findings: await findingsList(ctx.work, handleOf(execution.prepared).key, execution.prepared.subject) })),
  }),
  [FINDINGS_DOORS.write]: command(commands[FINDINGS_DOORS.write], commands[FINDINGS_DOORS.write].input, {
    async bind({ admission: { input } }) {
      if (!workspace) throw refused("Work storage is unavailable");
      handleOf(input);
      return { effects: [{ kind: "directory", path: productRouteWorkPath() }], prepare: async () => input };
    },
    run: ({ caller }, execution) =>
      workspace
        ? execution.step("publication", FINDINGS_DOORS.write, execution.prepared, () =>
            io(() =>
              findingsWrite(workspace, handleOf(execution.prepared), execution.prepared.finding, caller.kind === "pea" ? "pea" : "person"),
            ),
          )
        : Effect.fail(refused("Work storage is unavailable")),
  }),
});
