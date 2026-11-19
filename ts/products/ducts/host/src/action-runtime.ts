import { ductSystemsTool } from "@pe/duct-systems-contract/semantic-actions";
import { sheetCommands } from "@pe/ducts-contract/semantic-actions";
import { fansTool } from "@pe/fans-contract/semantic-actions";




import { canonicalRouteInput, workKey } from "@pe/agent-contracts";




import { ductsDesign } from "@pe/duct-systems-contract/ducts";
import { ductsFirmSchema } from "@pe/ducts-contract/duct-inputs";
import { subjectOf, workHandleSchema } from "@pe/agent-contracts";
import { nativeResponseSchema } from "@pe/host-contracts/decoders";
import type { HostNativeRead } from "@pe/host-internal/native-read";
import { Effect } from "effect";
import { admittedCommandReadIdentity } from "@pe/host-internal/command-read-identity";
import { RequestIdentity } from "@pe/host-internal/request-identity";
import type { DuctSnapshot } from "@pe/ducts-domain/types";
import { z } from "zod";
import type { RevitBridge } from "@pe/host-internal/bridge";
import { command, nativeStep, refused, type CommandContext } from "@pe/host-internal/command-executor";
import type { ActionExecution } from "@pe/host-internal/action-execution";
import { ductsReadings } from "./ducts-readings.ts";
import { runPods, type PodRunner } from "@pe/host-internal/pod-runner";
import type { DocumentRef, NativeProcess } from "@pe/agent-contracts";
import type { DuctFiles } from "./ducts-files.ts";
import { resolveCriteria } from "@pe/ducts-domain/calc/inputs";



import { firmLayer, workLayer, terminalFlowSlot, acquireSnapshotInputs } from "./ducts-inputs.ts";
import { readSettingTiers } from "@pe/host-internal/settings-files";
import { resolveFirm } from "@pe/host-internal/reads/evaluator";

import type { DuctsApply } from "@pe/host-contracts/generated";
import { rulingsRequest } from "@pe/ducts-domain/rulings";
import { ductWriteEvidence } from "@pe/ducts-domain/write-evidence";


export type DuctActionDependencies = PodRunner & {
  files?: DuctFiles["Service"];
  nativeRead?: HostNativeRead["Service"];
  projectLifetime?: (target: DocumentRef) => Promise<NativeProcess>;
};
type ReadSnapshot = (selector: Record<string, unknown>) => Promise<DuctSnapshot>;
type Intent = { groups?: string[]; walk?: { unitId: number; portIndex: number }; fan?: { unitId: number; systemId: number } };
type ReadNative = <K extends "ducts.snapshot.roster" | "ducts.snapshot.walk" | "ducts.tables">(key: K, input: unknown) => Promise<z.output<ReturnType<typeof nativeResponseSchema<K>>>>;
export interface DuctActionPreparation {
  flow?: Awaited<ReturnType<typeof terminalFlowSlot>>;
  intent: Intent; read: ReadSnapshot; readNative: ReadNative; snapshot: DuctSnapshot;
  design: import("@pe/duct-systems-contract/ducts").DuctsDesign;
  doc: import("@pe/ducts-contract/system-work").DuctsRouteDocument;
  fans: import("@pe/fans-contract/fans").FansRouteDocument;
  firm: import("@pe/ducts-contract/duct-inputs").DuctsFirm; pointer: string | null | undefined;
  deps: DuctActionDependencies; bridge: RevitBridge["Service"]; appliedAt: string | undefined;
}
const ductCommands = { ...ductSystemsTool.commands, ...sheetCommands };

export interface DuctAction {
  snapshot: (intent: Intent, read: ReadSnapshot) => Promise<DuctSnapshot>;
  derive: (input: DuctActionPreparation) => Promise<{ input: object; dependencies: unknown; cells?: readonly (readonly [string,string])[]; subjects?: Record<string,string>; nothingToWrite?: boolean; labels?: Record<string,string>; claim?: { basis: string; requiredEspInWg: number } }>;
  entry: { key: string; native: string; refusePlan: ((value: unknown) => string | null) | null;
    retires: (input: Record<string, unknown>, value: unknown, subjects: Record<string,string>, cells: [string,string][]) => readonly import("@pe/agent-contracts").WorkPath[] };
  bindings: readonly (readonly [keyof typeof ductCommands, Kind, Phase])[];
}

const prepared = z.object({
  process: z.unknown(),
  input: z.record(z.string(), z.unknown()),
  dependencies: z.unknown(),
  nothingToWrite: z.boolean().optional(),
  subjects: z.record(z.string(), z.string()).default({}),
  cells: z.array(z.tuple([z.string(), z.string()])).default([]),
  labels: z.record(z.string(), z.string()).optional(),
  claim: z.object({ basis: z.string(), requiredEspInWg: z.number() }).optional(),
});
const targetOf = (ctx: CommandContext) => {
  if (ctx.admission.target.kind !== "document") throw refused("Exact document target required");
  return ctx.admission.target.ref;
};
type Kind = "losses" | "heal" | "assign-fan";
/** plan seals (Read), rehearse rolls back (TransactRead, never seal authority), apply commits. */
type Phase = "plan" | "rehearse" | "apply";
const ductsRoute = ductSystemsTool.work.route, fansRoute = fansTool.work.route;

/**
 * The /duct-systems door (D9, P19): the sheet pair asked from /duct-systems stores that route's staged rule
 * tables and verdicts, removes the verdicts Work takes back, and writes no element. It lives in the shared
 * runtime because the sheet dispatch holds one product executor for the pair, whichever route asks.
 */
const rulingsDoor: Pick<DuctAction, "snapshot" | "derive" | "entry"> = {
  snapshot: (_intent, read) => read({ kind: "roster" }),
  derive: async ({ design, snapshot, appliedAt }) => ({ ...rulingsRequest(design, snapshot, appliedAt ?? ""), dependencies: ductWriteEvidence(snapshot) }),
  entry: { key: "ducts.apply", native: "ducts.apply.plan",
    refusePlan: (value) => nativeResponseSchema("ducts.apply.plan").parse(value).writes.some((w) => w.outcome === "refused") ? "refused" : null,
    // The rulings land with the store write, so its outcome retires every cell sent.
    retires: (_input, value, _subjects, cells) => {
      const { previewOnly, writes } = nativeResponseSchema("ducts.apply").parse(value);
      return !previewOnly && writes.some((w) => w.kind === "store" && (w.outcome === "written" || w.outcome === "unchanged")) ? cells : [];
    } },
};
const actionsByRoute = new Map<string, Partial<Record<Kind, typeof rulingsDoor>>>([
  [ductsRoute, { losses: rulingsDoor }],
  [fansRoute, {}],
]);
/** Each kind's sealed plan entry: the losses plan is the sheet pair's (slice 7). */
const PLAN_OF = { losses: "sheet.plan", heal: "ducts.plan-heal", "assign-fan": "ducts.plan-assign-fan" } as const;
/** Work is the only authored input. Plan, rehearsal and apply share the same derivation and journal. */
export function ductActionExecutors(
  action: DuctAction,
  bridge: RevitBridge["Service"],
  deps: DuctActionDependencies = {},
) {
  const actionOf = (kind: Kind, route: string) => {
    const overrides = actionsByRoute.get(route);
    if (!overrides) throw refused(`Duct actions are unavailable on route "${route}"`, "ducts.unknown-route");
    return overrides[kind] ?? action;
  };
  const bind = async (ctx: CommandContext, kind: Kind, phase: Phase) => {
    const target = targetOf(ctx);
    // The sheet pair takes the asking route's own handle (/ducts or /fans); the sibling comes from readWorks or the same document.
    const primary = ctx.admission.input.work as import("@pe/agent-contracts").WorkHandle;
    const selected = actionOf(kind, primary.key.route);
    const siblings = z.strictObject({ [ductsRoute]: workHandleSchema.optional(), [fansRoute]: workHandleSchema.optional() }).optional().parse(ctx.admission.input.readWorks);
    const ductsView = primary.key.route === ductsRoute || siblings?.[ductsRoute] ? null : await ctx.work.view({ ...primary.key, route: ductsRoute }, ductsRoute);
    const raw = primary.key.route === ductsRoute ? primary : siblings?.[ductsRoute] ?? ductsView?.handle;
    if (!raw) throw refused("Ducts Work is unavailable", "work.unavailable");
    if (!deps.projectLifetime) throw refused("Ducts preparation requires a project lifetime", "document.unavailable");
    const process = await deps.projectLifetime(target);
    const doc = await ctx.selectWork(ductSystemsTool.work, raw, (_doc, cells) => ({
      edits: ductSystemsTool.work.editable,
      facts: [["workingPhase"]],
      cells: cells.filter(({ cell }) => cell.edit).map(({ path }) => path),
    }));
    // The persisted identity (workKey) decides "another document"; address case and Save As `from` are transport.
    const fanView = await ctx.work.view({ ...raw.key, route: "fans" }, "fans");
    if (!fanView) throw refused("Fans Work is unavailable", "work.unavailable");
    if (siblings?.[fansRoute] && workKey(siblings[fansRoute].key) !== workKey(fanView.handle.key))
      throw refused("Fans Work belongs to another document", "work.target");
    const fans = await ctx.selectWork(fansTool.work, siblings?.[fansRoute] ?? (primary.key.route === fansRoute ? primary : fanView.handle), (_doc, cells) => ({
      edits: fansTool.work.editable,
      cells: cells.filter(({ cell }) => cell.edit).map(({ path }) => path),
    }),
    );
    const design = ductsDesign(doc, fans);
    // The store's appliedAt is stamped at the plan and reused by apply, so an unchanged plan seals the same request.
    const plan = ctx.read
      .receipts()
      .filter(
        (r) =>
          r.key === PLAN_OF[kind] &&
          r.state === "succeeded" &&
          canonicalRouteInput(r.target) === canonicalRouteInput(ctx.admission.target),
      )
      .at(-1);
    const appliedAt =
      phase === "plan"
        ? new Date().toISOString()
        : plan?.state === "succeeded"
          ? (plan.result as { derivedRequest?: { store?: { appliedAt?: string } } }).derivedRequest
              ?.store?.appliedAt
          : undefined;
    return {
      consumes: [
        {
          kind: "incarnation" as const,
          probe: { target: ctx.admission.target, process },
          expected: true as const,
        },
      ],
      effects: phase === "apply" ? [{ kind: "document" as const, ref: target }] : [],
      prepare: async () => {
        const ductsScope = doc.writeIntent.edit?.value;
        const fanScope = fans.writeIntent.edit?.value;
        // The Work schema decoded each group SubjectRef; the engine speaks the group's own key.
        const intent = {
          ...ductsScope,
          groups: ductsScope?.groups?.map((code) => String(subjectOf(code).key)),
          walk: fanScope?.walk,
        };
        // 2b's refusal-aware layer over the owner-keyed firm file (the Pod firm door reads the same file).
        // The plan prices under the same tiers the sheet labels: the target model's project home, then the firm file.
        const pointer = (await runPods(deps, bridge.list))
          .flatMap((session) => session.state?.openDocuments ?? [])
          .find((open) => open.openId === target.openId)?.projectHome;
        const settings = readSettingTiers("ducts", pointer);
        const firm = firmLayer(resolveFirm(await runPods(deps, deps.files!.firm("ducts")), ductsFirmSchema, {}), settings);
        const criteria = resolveCriteria(workLayer(design), firm);
        const nativeRead = deps.nativeRead;
        if (!nativeRead) throw refused("Ducts preparation requires the root native Read capability", "read.unavailable",
          );
        const readNative = <K extends "ducts.snapshot.roster" | "ducts.snapshot.walk" | "ducts.tables",
        >(key: K, input: unknown,
        ) =>
          runPods(deps, admittedCommandReadIdentity(ctx).pipe(
            Effect.flatMap((identity) => nativeRead.read({ key, input, scope: identity.scope }).pipe(
              Effect.provideService(RequestIdentity, identity)),
            ),
            Effect.map((answer) => nativeResponseSchema(key).parse(answer.value)),
          ),
          );
        const { flow } = await acquireSnapshotInputs(settings, slots => readNative("ducts.snapshot.roster", { ...(Object.keys(slots).length ? { slots } : {}), selector: { kind: "roster" } }));
        const read = (selector: Record<string, unknown>): Promise<DuctSnapshot> =>
          readNative(selector.kind === "roster" ? "ducts.snapshot.roster" : "ducts.snapshot.walk",
            {
              selector: selector.kind === "from" ? {
                ...selector,
                autoJoinGapIn: criteria.autoJoinGapIn.value,
                candidateBoxIn: criteria.healBoxIn.value,
              } : selector,
              slots: flow.slots,
            });
        const snapshot = await selected.snapshot(intent, read);
        const derived = await selected.derive({ flow, intent, read, readNative, snapshot, design, doc, fans,
          firm, pointer, deps, bridge, appliedAt });
        return { process, ...derived };
      },
    };
  };
  const run = (ctx: CommandContext, execution: ActionExecution, kind: Kind, phase: Phase) => Effect.gen(function* () {
    const p = prepared.parse(execution.prepared),
      target = targetOf(ctx);
    const { key: asked } = ctx.admission.input.work as { key: import("@pe/agent-contracts").WorkKey };
    const entry = actionOf(kind, asked.route).entry;
    // Default slot initialization is bookkeeping, never an authored model change.
    if (p.nothingToWrite) {
      if (phase === "apply") throw refused("Nothing to write: no staged changes in the selected scope");
      return { value: { previewOnly: true, writes: [], counts: { planned: 0, written: 0, refused: 0, unchanged: 0 } ,
        }, derivedRequest: p.input ,
      };
    }
    // The losses plan reads through the native Read sibling; a rehearsal calls its rolled-back TransactRead;
    // only apply reaches the ModelWrite leaf. Heal and fan plans never get here: the write boundary seals them.
    const key = phase === "apply" ? entry.key : entry.native;
    const value = yield* execution.step(
      "native",
      key,
      p.input,
      (id) => nativeStep(bridge, target, key, p.input, id),
      { process: p.process as import("@pe/agent-contracts").NativeProcess },
    );
    // Retain the review and its read evidence. A refusal blocks the whole intent at the write boundary;
    // bookkeeping and computed losses cannot authorize Apply while an authored edit is refused.
    if (phase !== "apply") {
      const refusal = entry.refusePlan?.(value);
      if (refusal) return {
          value,
          derivedRequest: p.input,
          planRefusalCode: "ducts.plan-refused",
          planRefusal: (value as DuctsApply.Res.Response).writes
            .filter((w) => w.outcome === "refused")
            .map(
              (w) =>
                `${p.labels?.[String(w.id)] ?? "Requested write"}: ${w.reason}. ${/neither|missing|no .*parameter/i.test(w.reason ?? "") ? "Add the missing parameter to the family or map the value to an existing writable parameter." : "Resolve this refusal and Plan again."}`,
            ).join("; "),
        };
    }
    // D9: an apply retires only the cells its own route owns, under the route that executed it.
    const owned = (asked.route === fansRoute ? fansTool : ductSystemsTool).work.editable;
    const paths = (phase === "apply" ? entry.retires(p.input, value, p.subjects, p.cells) : []).filter((path) => owned.some((pattern) => pattern[0] === path[0]));
    const retired = paths.length ? yield* execution.retireWork(asked, asked.route, paths) : undefined;
    return {
      value,
      derivedRequest: p.input,
      ...(p.claim ? { claim: p.claim } : {}),
      target: { session: target.session, document: null },
      ...(retired ? { retired } : {}),
    };
  });
  return {
    // The registry wraps these at boot: `commands[key].writeBoundary` (or `workIntent` for a rehearsal) carries
    // the binding. ducts.plan-heal and ducts.plan-assign-fan have no executor: the registry binds the apply's in
    // its plan phase, which seals the derived request without a native call.
    ...Object.fromEntries(
      (action.bindings      ).map(([key, kind, phase]) => {
        return [
          key,
          command(ductCommands[key], prepared, {
            seal: (p) => ({ request: p.input, evidence: p.dependencies }),
            bind: (ctx) => bind(ctx, kind, phase),
            run: (ctx, execution) => run(ctx, execution, kind, phase),
          }),
        ];
      }),
    ),
  };
}

export function ductsRefreshExecutors(bridge: RevitBridge["Service"]) { return {
    "ducts.refresh": command(ductSystemsTool.commands["ducts.refresh"], z.null(), {
      bind: async (ctx) => {
        targetOf(ctx);
        return { effects: [] };
      },
      run: (ctx) => Effect.sync(() => {
        const target = targetOf(ctx);
        ductsReadings(bridge).refresh(target);
        return { target, refreshed: true };
      }),
    }),
}; }
