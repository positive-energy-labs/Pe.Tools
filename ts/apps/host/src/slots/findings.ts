import { Effect } from "effect";
import { z } from "zod";
import { address, bindWork, commands, refusalText, workHandle, workHandleSchema, type ActionAdmission, type WorkKey } from "@pe/agent-contracts";
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
import type { RevitBridge } from "../bridge.ts";
import { currentDocument } from "../document-lifetime.ts";
import { productRouteWorkPath } from "../product-paths.ts";

/*
 * The host side of findings (ADR 0035 rule 9): two catalog doors over one Work per document under
 * owner key `findings` on the existing bindings. `findings.write` is a Work write (the host stamps
 * `by` and `at`), never a ModelWrite; `findings.list` is a Read. Pea reaches both through the
 * catalog; undo is the Work journal's per-author step (`RouteWorkspace.step` with `own`).
 */

/** `reads` is the invocation's own Work reader (`CommandContext.work`), which carries its read context. */
async function findingsList(reads: Pick<CommandWorkReads, "view">, key: WorkKey, subject?: string): Promise<readonly Finding[]> {
  const view = await reads.view(key, FINDINGS_OWNER);
  const { findings } = findingsWorkSchema.parse(view?.doc ?? {});
  return Object.values(findings).filter((f) => subject === undefined || f.subject === subject);
}

async function findingsWrite(
  workspace: RouteWorkspace,
  handle: z.output<typeof workHandleSchema>,
  input: FindingInput,
  by: Finding["by"],
): Promise<{ readonly revision: number }> {
  // The contract refuses a verdict the kind does not declare, before any Work changes.
  const finding = findingSchema.parse({ ...input, by, at: new Date().toISOString() });
  // The handle is the findings Work's own (`bound` makes it): its revision is the compare-and-set.
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

/*
 * The findings Work is always the admitted document's: the key comes from the target, one exact open
 * document, never from the caller (purge-2: a handle keyed to another document wrote that document).
 * A caller's handle gives only a revision, and only a findings handle has one to give: it is the
 * compare-and-set. With a route's own handle (a person's row verb on /fans or /families) or none
 * (gate-ef940d36, Pea's first call) the write lands on the current revision: it patches only
 * `findings[id]`, an upsert that reads no other finding.
 */
async function bound<I extends { work?: z.output<typeof workHandleSchema> }>(
  reads: Pick<CommandWorkReads, "view">,
  bridge: RevitBridge["Service"],
  { target, input }: { target: ActionAdmission["target"]; input: I },
) {
  if (target.kind !== "document") throw refused("Findings are written on one open document");
  const session = await currentDocument(bridge, target.ref, "project");
  const doc = session.state!.openDocuments.find((d) => d.openId === target.ref.openId)!;
  const key = bindWork(FINDINGS_OWNER, doc.address ? address(doc.address) : null, undefined, target.ref);
  const revision = input.work?.key.route === FINDINGS_OWNER ? input.work.revision : ((await reads.view(key, FINDINGS_OWNER))?.revision ?? 0);
  return { ...input, work: workHandle(key, revision) };
}

// What `bound` prepares always carries the findings handle, so each prepared schema requires it.
export const findingsExecutors = (workspace: RouteWorkspace | undefined, bridge: RevitBridge["Service"]) => ({
  [FINDINGS_DOORS.list]: command(commands[FINDINGS_DOORS.list], commands[FINDINGS_DOORS.list].input.required({ work: true }), {
    async bind({ admission, work }) {
      if (!workspace) throw refused("Work storage is unavailable");
      const input = await bound(work, bridge, admission);
      return { effects: [], prepare: async () => input };
    },
    run: (ctx, execution) =>
      io(async () => ({ findings: await findingsList(ctx.work, execution.prepared.work.key, execution.prepared.subject) })),
  }),
  [FINDINGS_DOORS.write]: command(commands[FINDINGS_DOORS.write], commands[FINDINGS_DOORS.write].input.required({ work: true }), {
    async bind({ admission, work }) {
      if (!workspace) throw refused("Work storage is unavailable");
      const input = await bound(work, bridge, admission);
      return { effects: [{ kind: "directory", path: productRouteWorkPath() }], prepare: async () => input };
    },
    run: ({ caller }, execution) =>
      workspace
        ? execution.step("publication", FINDINGS_DOORS.write, execution.prepared, () =>
            io(() =>
              findingsWrite(workspace, execution.prepared.work, execution.prepared.finding, caller.kind === "pea" ? "pea" : "person"),
            ),
          )
        : Effect.fail(refused("Work storage is unavailable")),
  }),
});
