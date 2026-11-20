import { Effect } from "effect";
import { z } from "zod";
import { nativeProcessSchema } from "@pe/agent-contracts";
import { commands } from "@pe/mcps/product-actions";
import { SHEET_COMMANDS, schemaOfData, type SheetSlotData } from "@pe/agent-contracts/slots";
import {
  subjectOf,
  type SubjectRefCode,
} from "../../../../packages/agent-contracts/src/subject-ref.ts";
import type {
  RevitApplyParameterValues,
  RevitDetailParameterValues,
} from "@pe/host-contracts/generated";
import type { RevitBridge } from "@pe/host-internal/bridge";
import {
  command,
  nativeStep,
  refused,
  type CommandExecutor,
} from "@pe/host-internal/command-executor";
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
    if (ref.keyKind !== "UniqueId" || ref.placement || ref.sub)
      throw refused(`${subject} is not an element's UniqueId`);
    return String(ref.key);
  } catch (error) {
    if (error instanceof Error && error.message.includes("is not an element")) throw error;
    return subject;
  }
};

/** Pure: the staged parameter writes a route's Work holds for its sheet, binding by binding then row by row. */
export function sheetWrites(sheet: SheetSlotData, doc: unknown): readonly SheetWrite[] {
  validateSheetValues(sheet, doc);
  return Object.entries(sheet.bindings).flatMap(([binding, declared]) => {
    const home = declared.home;
    if (home.at !== "parameter") return [];
    const heldAt = binding.split(".").reduce(get, doc);
    const staged = heldAt && typeof heldAt === "object" ? heldAt : {};
    return Object.entries(staged).flatMap(([subject, held]) => {
      const value = sheet.draft ? get(get(held, "edit"), "value") : held;
      return value === undefined || value === null
        ? []
        : [
            {
              binding,
              subject: subject as SubjectRefCode,
              uniqueId: uniqueIdOf(subject),
              parameter: home.parameter,
              value,
              ...(declared.domain.kind === "number" && declared.domain.unit
                ? { unit: declared.domain.unit }
                : {}),
            },
          ];
    });
  });
}

const get = (value: unknown, key: string): unknown =>
  value !== null && typeof value === "object" ? Reflect.get(value, key) : undefined;
const sheetInput = z.looseObject({
  work: z.looseObject({ key: z.looseObject({ route: z.string() }) }),
  doc: z.unknown(),
});

/** Every staged value is decoded before the generic or route-specific native executor binds. */
export function validateSheetValues(sheet: SheetSlotData, doc: unknown): void {
  for (const [name, b] of Object.entries(sheet.bindings)) {
    if (b.home.at === "setting") continue;
    const held = name.split(".").reduce(get, doc);
    const rows =
      b.per === "subject" ? Object.values(held && typeof held === "object" ? held : {}) : [held];
    for (const row of rows) {
      const value = sheet.draft ? get(get(row, "edit"), "value") : row;
      if (value == null) continue;
      const parsed = schemaOfData(b.domain).safeParse(value);
      if (!parsed.success)
        throw refused(`${name}: ${parsed.error.issues[0]?.message}`, "sheet.invalid");
    }
  }
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
      const { work, doc } = sheetInput.parse(ctx.admission.input);
      const sheet = deps.workspace?.sheet(work.key.route);
      if (!sheet)
        throw refused(`Route ${work.key.route} declares no sheet slot`, "sheet.undeclared");
      return {
        effects: [{ kind: "document", ref: target }],
        prepare: async () => {
          const writes = sheetWrites(sheet, doc);
          if (!writes.length)
            throw refused("Nothing to write: stage a parameter cell first", "sheet.empty");
          const reader = await projectReader(bridge, target, deps);
          const read = (await reader.read(PLAN_LEAF, { edits: writes.map(planEdit) })) as PlanData;
          const refusals = read.results.filter((r) => !r.ok);
          if (refusals.length)
            throw refused(
              refusals
                .map(
                  (r) =>
                    `${writes[r.index]!.parameter} on ${writes[r.index]!.uniqueId}: ${r.error}`,
                )
                .join("; "),
              "sheet.plan-refused",
            );
          const request: RevitApplyParameterValues.Req.Request = {
            edits: read.results.map((r, i) => ({
              ...planEdit(writes[i]!),
              elementId: r.current!.elementId,
              parameterId: r.current!.parameterId,
              expected: r.current!,
            })),
          };
          return {
            target,
            process: reader.process,
            writes: [...writes],
            request,
            before: read.results.map((r) => r.current),
          };
        },
      };
    },
    run: (_ctx, execution) => {
      const { target, request, writes, before } = execution.prepared;
      // The plan read happened in prepare; the review draws each write beside the value Revit holds now.
      if (key === SHEET_COMMANDS.plan) return Effect.succeed({ writes, before });
      return execution.step(
        "native",
        APPLY_LEAF,
        request,
        (id) => nativeStep(bridge, target, APPLY_LEAF, request, id),
        { process: execution.prepared.process },
      );
    },
  });
}

const via = z.object({ via: z.enum(["losses", "parameters"]), value: z.unknown() });

/** One entry per key: product composition selects the executor for the Work handle's route. */
function dispatch(
  key: (typeof SHEET_COMMANDS)[keyof typeof SHEET_COMMANDS],
  deps: FamilyActionDependencies,
  byVia: Record<string, CommandExecutor>,
  routes: Readonly<Record<string, string>>,
): CommandExecutor {
  const executorFor = (name: string) => {
    const executor = Object.hasOwn(byVia, name) ? byVia[name] : undefined;
    if (!via.shape.via.safeParse(name).success || !executor)
      throw refused(`Unknown sheet executor via: ${name}`, "sheet.executor-unknown");
    return executor;
  };
  const inner = (value: unknown) => {
    const p = via.parse(value);
    const executor = executorFor(p.via);
    return { executor, value: executor.prepared.parse(p.value) };
  };
  return {
    definition: commands[key],
    prepared: via,
    sealInput: via,
    seal: (value) => {
      const { executor, value: p } = inner(value);
      return executor.seal!(p);
    },
    bind: async (ctx) => {
      const { work, doc } = sheetInput.parse(ctx.admission.input);
      const sheet = deps.workspace?.sheet(work.key.route);
      if (!sheet)
        throw refused(`Route ${work.key.route} declares no sheet slot`, "sheet.undeclared");
      validateSheetValues(sheet, doc);
      const name = Object.hasOwn(routes, work.key.route) ? routes[work.key.route] : "parameters";
      if (name === undefined) throw refused("Missing sheet executor via", "sheet.executor-unknown");
      const bound = await executorFor(name).bind(ctx);
      return { ...bound, prepare: async () => ({ via: name, value: await bound.prepare?.() }) };
    },
    run: (ctx, execution) => {
      const { executor, value } = inner(execution.prepared);
      return executor.run(ctx, { ...execution, prepared: value });
    },
  };
}

/** Product registration selects specialized sheet writes; unregistered routes use parameter values. */
export function sheetExecutors(
  bridge: RevitBridge["Service"],
  deps: FamilyActionDependencies,
  losses: Record<string, CommandExecutor>,
  routes: Readonly<Record<string, string>> = {},
): Record<string, CommandExecutor> {
  return Object.fromEntries(
    Object.values(SHEET_COMMANDS).map((key) => [
      key,
      dispatch(
        key,
        deps,
        { losses: losses[key]!, parameters: parameterExecutor(bridge, deps, key) },
        routes,
      ),
    ]),
  );
}
