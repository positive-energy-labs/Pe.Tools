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
export async function findingsList(reads: Pick<CommandWorkReads, "view">, key: WorkKey, subject?: string): Promise<readonly Finding[]> {
  const view = await reads.view(key, FINDINGS_OWNER);
  const { findings } = findingsWorkSchema.parse(view?.doc ?? {});
  return Object.values(findings).filter((f) => subject === undefined || f.subject === subject);
}

/** The findings Work at the handle's binding: a route's own handle names the same document. */
const findingsKey = (key: WorkKey): WorkKey => ({ ...key, route: FINDINGS_OWNER });

export async function findingsWrite(
  workspace: RouteWorkspace,
  reads: Pick<CommandWorkReads, "view">,
  handle: z.output<typeof workHandleSchema>,
  input: FindingInput,
  by: Finding["by"],
): Promise<{ readonly revision: number }> {
  // The contract refuses a verdict the kind does not declare, before any Work changes.
  const finding = findingSchema.parse({ ...input, by, at: new Date().toISOString() });
  const key = findingsKey(handle.key);
  // A findings handle is a compare-and-set. A route's own handle (a person's row verb on /fans or
  // /families, whose mount binds its own Work) carries no findings revision, so the write lands on
  // the current one: it patches only `findings[id]`, an upsert that reads no other finding.
  const expectedRevision =
    handle.key.route === FINDINGS_OWNER ? handle.revision : ((await reads.view(key, FINDINGS_OWNER))?.revision ?? 0);
  const result = await workspace.write(key, FINDINGS_OWNER, by === "pea" ? "pea" : "human", {
    kind: "apply",
    press: `finding:${finding.id}`,
    label: `${finding.kind} on ${finding.subject}`,
    expectedRevision,
    patches: [{ path: ["findings", finding.id], value: finding }],
  });
  if (!result.ok) throw new StepFailure(refusalText(result), 409, "refused", result);
  return { revision: result.revision };
}

const handleOf = (input: { work?: z.output<typeof workHandleSchema> }) => {
  if (!input.work) throw refused("The document's findings Work handle is required");
  return input.work;
};

/*
 * gate-ef940d36: Pea's first call carried no handle and was refused. A call without one binds the
 * findings Work of the admitted document itself, as a route's mount binds its own: the target is
 * one exact open document, so there is nothing ambiguous to resolve. A handle still wins.
 */
async function bound<I extends { work?: z.output<typeof workHandleSchema> }>(
  reads: Pick<CommandWorkReads, "view">,
  bridge: RevitBridge["Service"],
  { target, input }: { target: ActionAdmission["target"]; input: I },
): Promise<I> {
  if (input.work) return input;
  if (target.kind !== "document") throw refused("The document's findings Work handle is required");
  const session = await currentDocument(bridge, target.ref, "project");
  const doc = session.state!.openDocuments.find((d) => d.openId === target.ref.openId)!;
  const key = bindWork(FINDINGS_OWNER, doc.address ? address(doc.address) : null, undefined, target.ref);
  return { ...input, work: workHandle(key, (await reads.view(key, FINDINGS_OWNER))?.revision ?? 0) };
}

export const findingsExecutors = (workspace: RouteWorkspace | undefined, bridge: RevitBridge["Service"]) => ({
  [FINDINGS_DOORS.list]: command(commands[FINDINGS_DOORS.list], commands[FINDINGS_DOORS.list].input, {
    async bind({ admission, work }) {
      if (!workspace) throw refused("Work storage is unavailable");
      const input = await bound(work, bridge, admission);
      return { effects: [], prepare: async () => input };
    },
    run: (ctx, execution) =>
      io(async () => ({ findings: await findingsList(ctx.work, findingsKey(handleOf(execution.prepared).key), execution.prepared.subject) })),
  }),
  [FINDINGS_DOORS.write]: command(commands[FINDINGS_DOORS.write], commands[FINDINGS_DOORS.write].input, {
    async bind({ admission, work }) {
      if (!workspace) throw refused("Work storage is unavailable");
      const input = await bound(work, bridge, admission);
      return { effects: [{ kind: "directory", path: productRouteWorkPath() }], prepare: async () => input };
    },
    run: ({ caller, work }, execution) =>
      workspace
        ? execution.step("publication", FINDINGS_DOORS.write, execution.prepared, () =>
            io(() =>
              findingsWrite(workspace, work, handleOf(execution.prepared), execution.prepared.finding, caller.kind === "pea" ? "pea" : "person"),
            ),
          )
        : Effect.fail(refused("Work storage is unavailable")),
  }),
});
