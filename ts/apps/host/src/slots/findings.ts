import { Effect } from "effect";
import { z } from "zod";
import { address, bindWork, commands, refusalText, workHandle, workHandleSchema, type ActionAdmission, type Caller, type RouteStatePatch, type WorkKey } from "@pe/agent-contracts";
import {
  FINDING_KINDS,
  FINDINGS_DOORS,
  FINDINGS_OWNER,
  admitsVerdict,
  findingSchema,
  findingsWorkSchema,
  type Finding,
  type Stamp,
} from "@pe/agent-contracts/slots";
import type { RouteWorkspace } from "@pe/runtime";
import { command, io, refused, StepFailure, type CommandContext, type CommandWorkReads } from "../command-executor.ts";
import type { ActionExecution } from "../action-journal.ts";
import type { RevitBridge } from "../bridge.ts";
import { currentDocument } from "../document-lifetime.ts";
import { productRouteWorkPath } from "../product-paths.ts";

/*
 * The host side of findings (ADR 0035 rule 9, ADR 0042 rule 5): four catalog doors over one Work per
 * document under owner key `findings`. `say` mints the id and stamps `said`; `rule` reaches only
 * `verdict`; `retract` removes the record; `list` is a Read. None is a ModelWrite. Every write is one
 * `workspace.write` apply with a press of its own, so the findings Work is an ordinary Timeline member.
 */

type Leaves = Pick<CommandContext, "clock" | "ids">;

/** Only a person or Pea writes a finding. Exhaustive: a new caller kind must be ruled on here. */
function author(caller: Caller): Stamp["by"] {
  switch (caller.kind) {
    case "pea":
      return "pea";
    case "human":
      return "person";
    case "external-mcp":
    case "page":
    case "service":
    case "anonymous":
      throw refused(`Only a person or Pea writes a finding, not a ${caller.kind} caller`, "findings.caller");
    default:
      return caller satisfies never;
  }
}

/** `reads` is the invocation's own Work reader (`CommandContext.work`), which carries its read context. */
async function held(reads: Pick<CommandWorkReads, "view">, key: WorkKey): Promise<Readonly<Record<string, Finding>>> {
  return findingsWorkSchema.parse((await reads.view(key, FINDINGS_OWNER))?.doc ?? {}).findings;
}
/**
 * A refusal inside a door's write step. It is a settled `refused` step outcome: a bare throw there
 * leaves the action unknown, and an unknown action blocks the caller's next one.
 */
const stepRefused = (message: string) => new StepFailure(message, 409, "refused");
async function one(reads: Pick<CommandWorkReads, "view">, key: WorkKey, id: string): Promise<Finding> {
  const finding = (await held(reads, key))[id];
  if (!finding) throw stepRefused(`No finding ${id} on this document`);
  return finding;
}

/** The one write path: an apply on the findings Work, at the bound revision, by the journal's author. */
async function write(
  workspace: RouteWorkspace,
  handle: z.output<typeof workHandleSchema>,
  by: Stamp["by"],
  { ids }: Leaves,
  label: string,
  patch: RouteStatePatch,
): Promise<{ readonly revision: number }> {
  // A finding's `person` is the journal's `human`. The press is minted per write: a rule or a retract
  // of the same finding is its own step.
  const result = await workspace.write(handle.key, FINDINGS_OWNER, by === "pea" ? "pea" : "human", {
    kind: "apply",
    press: `finding:${ids.mint()}`,
    label,
    expectedRevision: handle.revision,
    patches: [patch],
  });
  if (!result.ok) throw new StepFailure(refusalText(result), 409, "refused", result);
  return { revision: result.revision };
}

/*
 * The findings Work is always the admitted document's: the key comes from the target, one exact open
 * document, never from the caller (purge-2: a handle keyed to another document wrote that document).
 * A caller's handle gives only a revision, and only a findings handle has one to give: it is the
 * compare-and-set. With a route's own handle (a person's row verb on /fans or /families) or none
 * (gate-ef940d36, Pea's first call) the write lands on the current revision.
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
export const findingsExecutors = (workspace: RouteWorkspace | undefined, bridge: RevitBridge["Service"]) => {
  /** A write door's binding: a caller that is neither author is refused before admission. */
  const binding = async <I extends { work?: z.output<typeof workHandleSchema> }>(
    ctx: Pick<CommandContext, "work" | "caller">,
    admission: { target: ActionAdmission["target"]; input: I },
  ) => {
    if (!workspace) throw refused("Work storage is unavailable");
    author(ctx.caller);
    const input = await bound(ctx.work, bridge, admission);
    return { effects: [{ kind: "directory" as const, path: productRouteWorkPath() }], prepare: async () => input };
  };
  /** A write door's one publication step. */
  const step = (key: string, ctx: Pick<CommandContext, "caller">, execution: ActionExecution, run: (workspace: RouteWorkspace, by: Stamp["by"]) => Promise<unknown>) =>
    workspace
      ? execution.step("publication", key, execution.prepared, () => io(() => run(workspace, author(ctx.caller))))
      : Effect.fail(refused("Work storage is unavailable"));
  const { list, say, rule, retract } = FINDINGS_DOORS;
  return {
    [list]: command(commands[list], commands[list].input.required({ work: true }), {
      async bind({ admission, work }) {
        if (!workspace) throw refused("Work storage is unavailable");
        const input = await bound(work, bridge, admission);
        return { effects: [], prepare: async () => input };
      },
      run: (ctx, execution) =>
        io(async () => ({
          findings: Object.values(await held(ctx.work, execution.prepared.work.key))
            .filter((f) => execution.prepared.subject === undefined || f.subject === execution.prepared.subject)
            .sort((a, b) => a.said.at.localeCompare(b.said.at)),
        })),
    }),
    [say]: command(commands[say], commands[say].input.required({ work: true }), {
      bind: (ctx) => binding(ctx, ctx.admission),
      run: (ctx, execution) =>
        step(say, ctx, execution, async (workspace, by) => {
          const { work, verdict, ...said } = execution.prepared;
          const stamp = { by, at: ctx.clock.now() };
          // The door's input already refused a verdict its kind does not admit; the record has no shape for one.
          const parsed = findingSchema.safeParse({
            ...said,
            id: ctx.ids.mint(),
            said: stamp,
            ...(verdict === undefined ? {} : { verdict: { ...stamp, value: verdict } }),
          });
          if (!parsed.success) throw stepRefused(z.prettifyError(parsed.error));
          const finding = parsed.data;
          const { revision } = await write(workspace, work, by, ctx, `${finding.kind} on ${finding.subject}`, { path: ["findings", finding.id], value: finding });
          return { id: finding.id, revision };
        }),
    }),
    [rule]: command(commands[rule], commands[rule].input.required({ work: true }), {
      bind: (ctx) => binding(ctx, ctx.admission),
      run: (ctx, execution) =>
        step(rule, ctx, execution, async (workspace, by) => {
          const { work, id, value } = execution.prepared;
          const finding = await one(ctx.work, work.key, id);
          if (value !== null && !admitsVerdict(finding.kind, value))
            throw stepRefused(finding.kind === "note" ? "A note takes no ruling" : `A ${finding.kind} is ruled ${FINDING_KINDS[finding.kind].join(", ")}, not ${value}`);
          // The patch names `verdict` alone: `said` is out of a ruling's reach.
          return write(workspace, work, by, ctx, `${value ?? "no ruling"} on ${finding.kind} ${id}`, {
            path: ["findings", id, "verdict"],
            ...(value === null ? {} : { value: { by, at: ctx.clock.now(), value } }),
          });
        }),
    }),
    [retract]: command(commands[retract], commands[retract].input.required({ work: true }), {
      bind: (ctx) => binding(ctx, ctx.admission),
      run: (ctx, execution) =>
        step(retract, ctx, execution, async (workspace, by) => {
          const { work, id } = execution.prepared;
          const finding = await one(ctx.work, work.key, id);
          return write(workspace, work, by, ctx, `retract ${finding.kind} ${id}`, { path: ["findings", id] });
        }),
    }),
  };
};
