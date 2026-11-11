import { Effect } from "effect";
import { z } from "zod";
import { commands, nativeProcessSchema, type WorkHandle } from "@pe/agent-contracts";
import { SHEET_COMMANDS, type SheetSlotData } from "@pe/agent-contracts/slots";
import { subjectOf, type SubjectRefCode } from "../../../../packages/agent-contracts/src/subject-ref.ts";
import type { RevitApplyParameterValues, RevitDetailParameterValues } from "@pe/host-contracts/generated";
import type { RevitBridge } from "../bridge.ts";
import { command, nativeStep, refused, type CommandContext, type CommandExecutor } from "../command-executor.ts";
import { projectReader, type FamilyActionDependencies } from "../family-actions.ts";

/*
 * The host side of the sheet slot (ADR 0030 rule 4; ADR 0035 rule 3). One pair, `sheet.plan` and
 * `sheet.apply`, serves every route: the Work handle names the route, and the route's admitted sheet
 * names its bindings. A `parameter` binding plans through the Read `revit.detail.parameter-values`
 * (the value Revit holds now, no transaction) and applies through the generic ModelWrite
 * `revit.apply.parameter-values` with that evidence as `expected`. The Work write boundary
 * (`work-write-boundary.ts`) seals the plan and rechecks it at apply. Owner: slice 7.
 */

const PLAN_LEAF = "revit.detail.parameter-values";
const APPLY_LEAF = "revit.apply.parameter-values";
// ponytail: the ducts losses store keeps its own native leaf (`ducts.apply`) until its owner moves onto store bindings.
const LOSSES_ROUTES = new Set(["ducts", "fans"]);

type Edit = RevitDetailParameterValues.Req.ParameterValueEdit;
type PlanData = RevitDetailParameterValues.Res.Response;
export interface SheetWrite {
  readonly binding: string;
  readonly subject: SubjectRefCode;
  readonly uniqueId: string;
  readonly parameter: string;
  readonly value: unknown;
  readonly unit?: string;
}

/** A row key is a SubjectRef code; a Pod still keyed by a bare UniqueId (slice 5's codec gap) reads as that UniqueId. */
const uniqueIdOf = (subject: string) => {
  try {
    const ref = subjectOf(subject as SubjectRefCode);
    if (ref.keyKind !== "UniqueId" || ref.placement || ref.sub) throw refused(`${subject} is not an element's UniqueId`);
    return String(ref.key);
  } catch (error) {
    if (error instanceof Error && error.message.includes("is not an element")) throw error;
    return subject;
  }
};

/** Pure: the staged parameter writes a route's Work holds for its sheet, binding by binding then row by row. */
export function sheetWrites(sheet: SheetSlotData, doc: unknown): readonly SheetWrite[] {
  const work = (doc ?? {}) as Readonly<Record<string, unknown>>;
  return Object.entries(sheet.bindings).flatMap(([binding, declared]) => {
    if (declared.kind !== "parameter") return [];
    const staged = (work[binding] ?? {}) as Readonly<Record<string, unknown>>;
    return Object.entries(staged).flatMap(([subject, held]) => {
      const value = sheet.draft ? (held as { edit?: { value?: unknown } | null } | undefined)?.edit?.value : held;
      return value === undefined || value === null
        ? []
        : [{ binding, subject: subject as SubjectRefCode, uniqueId: uniqueIdOf(subject), parameter: declared.parameter,
            value, ...(declared.unit ? { unit: declared.unit } : {}) }];
    });
  });
}

const planEdit = (write: SheetWrite): Edit => ({
  elementId: 0,
  uniqueId: write.uniqueId,
  parameterName: write.parameter,
  value: String(write.value),
  ...(write.unit ? { unit: write.unit } : {}),
});

const prepared = z.object({
  process: nativeProcessSchema,
  target: z.object({ session: z.string(), openId: z.string() }),
  writes: z.array(z.unknown()),
  request: z.unknown(),
  before: z.unknown(),
});

/** The parameter half: one executor for every route whose sheet has `parameter` bindings. */
function parameterExecutor(
  bridge: RevitBridge["Service"],
  deps: FamilyActionDependencies,
  key: (typeof SHEET_COMMANDS)[keyof typeof SHEET_COMMANDS],
): CommandExecutor {
  return command(commands[key], prepared, {
    seal: (p) => ({ request: p.request, evidence: { before: p.before } }),
    bind: async (ctx) => {
      if (ctx.admission.target.kind !== "document") throw refused("Exact document required");
      const target = ctx.admission.target.ref;
      const { work, doc } = ctx.admission.input as unknown as { work: WorkHandle; doc: unknown };
      const sheet = deps.workspace?.sheet(work.key.route);
      if (!sheet) throw refused(`Route ${work.key.route} declares no sheet slot`, "sheet.undeclared");
      return {
        effects: [{ kind: "document", ref: target }],
        prepare: async () => {
          const writes = sheetWrites(sheet, doc);
          if (!writes.length) throw refused("Nothing to write: stage a parameter cell first", "sheet.empty");
          const reader = await projectReader(bridge, target, deps);
          const read = (await reader.read(PLAN_LEAF, { edits: writes.map(planEdit) })) as PlanData;
          const refusals = read.results.filter((r) => !r.ok);
          if (refusals.length)
            throw refused(refusals.map((r) => `${writes[r.index]!.parameter} on ${writes[r.index]!.uniqueId}: ${r.error}`).join("; "), "sheet.plan-refused");
          const request: RevitApplyParameterValues.Req.Request = {
            edits: read.results.map((r, i) => ({
              ...planEdit(writes[i]!),
              elementId: r.current!.elementId,
              parameterId: r.current!.parameterId,
              expected: r.current!,
            })),
          };
          return { target, process: reader.process, writes: [...writes], request, before: read.results.map((r) => r.current) };
        },
      };
    },
    run: (_ctx, execution) => {
      const { target, request, writes, before } = execution.prepared;
      // The plan read happened in prepare; the review draws each write beside the value Revit holds now.
      if (key === SHEET_COMMANDS.plan) return Effect.succeed({ writes, before });
      return execution.step("native", APPLY_LEAF, request, (id) => nativeStep(bridge, target, APPLY_LEAF, request, id),
        { process: execution.prepared.process });
    },
  });
}

const via = z.object({ via: z.enum(["losses", "parameters"]), value: z.unknown() });
const routeOf = (ctx: CommandContext) => (ctx.admission.input as { work: WorkHandle }).work.key.route;

/** One entry per key: the Work handle's route picks the leaf (the ducts losses store, or parameter values). */
function dispatch(key: string, byVia: Record<z.output<typeof via>["via"], CommandExecutor>): CommandExecutor {
  const inner = (value: unknown) => {
    const p = via.parse(value);
    return { executor: byVia[p.via], value: byVia[p.via].prepared.parse(p.value) };
  };
  return {
    definition: commands[key as keyof typeof commands],
    prepared: via,
    sealInput: via,
    seal: (value) => {
      const { executor, value: p } = inner(value);
      return executor.seal!(p);
    },
    bind: async (ctx) => {
      const name = LOSSES_ROUTES.has(routeOf(ctx)) ? "losses" : "parameters";
      const bound = await byVia[name].bind(ctx);
      return { ...bound, prepare: async () => ({ via: name, value: await bound.prepare?.() }) };
    },
    run: (ctx, execution) => {
      const { executor, value } = inner(execution.prepared);
      return executor.run(ctx, { ...execution, prepared: value });
    },
  };
}

/** `sheet.plan` and `sheet.apply` for every route; `losses` are the ducts executors of the same two keys. */
export function sheetExecutors(
  bridge: RevitBridge["Service"],
  deps: FamilyActionDependencies,
  losses: Record<string, CommandExecutor>,
): Record<string, CommandExecutor> {
  return Object.fromEntries(
    Object.values(SHEET_COMMANDS).map((key) => [
      key,
      dispatch(key, { losses: losses[key]!, parameters: parameterExecutor(bridge, deps, key) }),
    ]),
  );
}
