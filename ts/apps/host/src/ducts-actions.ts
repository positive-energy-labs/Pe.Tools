import { ductWriteEvidence } from "@pe/ducts-domain/write-evidence";
import { commands, tools, canonicalRouteInput, workKey, type DuctsApplyInput } from "@pe/agent-contracts";
import { healPlan, healRequestGroup } from "@pe/ducts-domain/heal";
import { fanOf } from "@pe/ducts-domain/action-targets";
import { applyRequest, price, TABLE_IDS } from "@pe/ducts-domain/pricing";
import { toGrids } from "@pe/ducts-domain/loss-grid";
import { ductsDesign, stagedDucts, workHandleSchema } from "@pe/agent-contracts";
import type { DuctSnapshot } from "@pe/ducts-domain/types";
import { z } from "zod";
import { invokeBridge, type RevitBridge } from "./bridge.ts";
import { command, refused, type CommandContext } from "./command-executor.ts";
import type { ActionExecution } from "./action-journal.ts";
import { lifetime } from "./family-actions.ts";
import type { SdkReceiptReader } from "./native-receipts.ts";
import { ductsReadings } from "./ducts-readings.ts";
import { runPods } from "./family-actions.ts";
import { buildSheet, resolveCriteria, resolveInputs } from "@pe/ducts-domain/sheet/index";
import { accessoryWrites } from "@pe/ducts-domain/sheet/accessory-writes";
import { suggestRoster } from "@pe/ducts-domain/roster";
import { workLayer } from "./ducts-inputs.ts";
import { followAcceptedJoins } from "./ducts-walk.ts";
import { scopeApplyRequest, appliedCellPaths } from "@pe/ducts-domain/staged";
import type { DuctsApply, DuctsHeal } from "@pe/host-contracts/generated";

const prepared = z.object({
  process: z.unknown(),
  input: z.record(z.string(), z.unknown()),
  dependencies: z.unknown(),
});
const targetOf = (ctx: CommandContext) => {
  if (ctx.admission.target.kind !== "document") throw refused("Exact document target required");
  return ctx.admission.target.ref;
};
type Kind = "losses" | "heal" | "assign-fan";
/** plan seals (Read), rehearse rolls back (TransactRead, never seal authority), apply commits. */
type Phase = "plan" | "rehearse" | "apply";

/** A loss plan that plans nothing and refuses something arms nothing: its native reasons, else null. */
export const lossPlanRefusal = (writes: DuctsApply.Res.Response["writes"]) =>
  !writes.some((w) => w.outcome === "planned") && writes.some((w) => w.outcome === "refused")
    ? [...new Set(writes.filter((w) => w.outcome === "refused").map((w) => w.reason))].join("; ")
    : null;

/** Resolve group seeds through metadata, then read only their systems' complete geometry. */
export async function healSnapshot(
  groups: readonly string[],
  read: (selector: Record<string, unknown>) => Promise<DuctSnapshot>,
): Promise<DuctSnapshot> {
  const ids = groups.map((group) => Number(/^g([1-9]\d*)$/.exec(group)?.[1]));
  if (!ids.length || ids.some((id) => !Number.isSafeInteger(id) || id <= 0))
    throw refused("Stage valid writeIntent.groups before healing");
  const seeds = await read({ kind: "ids", ids });
  const names = new Set(
    [...seeds.nodes, ...seeds.segments].map((item) => item.systemName).filter(Boolean),
  );
  const roster = await read({ kind: "roster" });
  const systemIds = roster.systems
    .filter((system) => names.has(system.name))
    .map((system) => system.id);
  if (!systemIds.length)
    throw refused(
      "These groups have no scoped Revit system; read and repair their disconnected geometry first",
    );
  return read({ kind: "systems", systemIds });
}

/** A fan preview acquires both sides, as its worksheet does; networks acquire their authored groups. */
export async function lossSnapshot(
  intent: { walk?: { unitId: number; portIndex: number }; groups?: readonly string[] } | undefined,
  read: (selector: Record<string, unknown>) => Promise<DuctSnapshot>,
): Promise<DuctSnapshot> {
  if (!intent?.walk && !intent?.groups?.length)
    throw refused("Preview needs writeIntent.walk from the fan roster or writeIntent.groups; stage a scope before previewing losses");
  const snapshot = await (intent?.walk
    ? read({ kind: "from", unitId: intent.walk.unitId })
    : healSnapshot(intent?.groups ?? [], read));
  if (snapshot.walk?.truncated)
    throw refused("The fan walk is truncated; no writes can be previewed from this scope");
  return snapshot;
}

/** The requested cells whose segment writes only through request rows but derived none (rules also write the store). */
export function unwrittenCells(
  request: Pick<DuctsApplyInput, "terminals" | "components" | "equipment" | "terminalFlows" | "equipmentFlows">,
  cells: readonly (readonly [string, string])[],
): (readonly [string, string])[] {
  const written: Record<string, readonly { id: number }[]> = {
    terminalDrops: request.terminals,
    componentDrops: request.components,
    esp: request.equipment,
    flows: request.terminalFlows,
    equipmentFlows: request.equipmentFlows,
  };
  return cells.filter(([segment, key]) => written[segment] && !written[segment]!.some((row) => String(row.id) === key));
}

/** Only a fully confirmed heal consumes its intent; partial/refused/preview results remain editable. */
export function healedCellPaths(
  input: Record<string, unknown>,
  value: DuctsHeal.Res.Response,
): string[][] {
  if (value.previewOnly) return [];
  const requested = input.groups as DuctsHeal.Req.DuctHealGroup[];
  return requested?.length &&
    requested.every((group) => {
      const result = value.groups.find((item) => item.group === group.group);
      return (
        result?.outcome === "healed" &&
        group.items.length > 0 &&
        group.items.every((item) =>
          result.items.some((outcome) => outcome.key === item.key && outcome.outcome === "healed"),
        )
      );
    })
    ? [["writeIntent"]]
    : [];
}

/** Work is the only authored input. Plan, rehearsal and apply share the same derivation and journal. */
export function ductsExecutors(
  bridge: RevitBridge["Service"],
  deps: import("./family-actions.ts").FamilyActionDependencies = {},
) {
  const bind = async (ctx: CommandContext, kind: Kind, phase: Phase) => {
    const target = targetOf(ctx);
    const raw = ctx.admission.input.work as import("@pe/agent-contracts").WorkHandle;
    const { process } = await lifetime(bridge, target, "project", deps);
    const doc = await ctx.selectWork(tools.ducts.work, raw, (_doc, cells) => ({
      edits: tools.ducts.work.editable,
      facts: [["workingPhase"]],
      cells: cells.filter(({ cell }) => cell.edit).map(({ path }) => path),
    }));
    // The persisted identity (workKey) decides "another document"; address case and Save As `from` are transport.
    const fanView = await ctx.work.view({ ...raw.key, route: "fans" }, "fans");
    if (!fanView) throw refused("Fans Work is unavailable", "work.unavailable");
    const readWorks = z.record(z.string(), workHandleSchema).optional().parse(ctx.admission.input.readWorks);
    if (readWorks?.fans && workKey(readWorks.fans.key) !== workKey(fanView.handle.key))
      throw refused("Fans Work belongs to another document", "work.target");
    const fans = await ctx.selectWork(tools.fans.work, readWorks?.fans ?? fanView.handle, (_doc, cells) => ({
      edits: tools.fans.work.editable,
      cells: cells.filter(({ cell }) => cell.edit).map(({ path }) => path),
    }));
    const design = ductsDesign(doc, fans);
    // The store's appliedAt is stamped at the plan and reused by apply, so an unchanged plan seals the same request.
    const plan = ctx.read
      .receipts()
      .filter(
        (r) =>
          r.key === `ducts.plan-${kind}` &&
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
        const cells =
          ductsScope?.cells || fanScope?.cells
            ? [...(ductsScope?.cells ?? []), ...(fanScope?.cells ?? [])]
            : undefined;
        const intent = { ...ductsScope, walk: fanScope?.walk, cells };
        const { firm } = await runPods(deps, deps.files!.firm);
        const criteria = resolveCriteria(workLayer(design), null, firm);
        const read = (selector: Record<string, unknown>) =>
          invokeBridge<DuctSnapshot>(
            bridge,
            target,
            selector.kind === "roster" ? "ducts.snapshot.roster" : "ducts.snapshot.walk",
            {
              selector: selector.kind === "from" ? {
                ...selector,
                autoJoinGapIn: criteria.autoJoinGapIn.value,
                candidateBoxIn: criteria.healBoxIn.value,
              } : selector,
              slots: stagedDucts(doc, fans).parameters,
            },
          );
        let snapshot = await {
          "assign-fan": () => {
            if (!intent?.fan) throw refused("Stage writeIntent.fan before assigning a fan");
            return read({ kind: "systems", systemIds: [intent.fan.systemId] });
          },
          losses: () => lossSnapshot(intent, read),
          heal: () => healSnapshot(intent?.groups ?? [], read),
        }[kind]();
        const { input, dependencies } = await {
          losses: async () => {
            const tables = await invokeBridge(bridge, target, "ducts.tables", { ids: TABLE_IDS });
            const grids = toGrids(tables as Parameters<typeof toGrids>[0]);
            const catalogs = await runPods(deps, deps.files!.ductCatalogs);
            const layers = () => ({
              snapshot,
              firm,
              store: snapshot.store ?? undefined,
              work: workLayer(design),
              catalogs: catalogs.tables,
            });
            if (intent?.walk)
              snapshot = await followAcceptedJoins(
                snapshot,
                resolveInputs(layers()).rulings.joins,
                (unitId) => read({ kind: "from", unitId }),
              );
            if (snapshot.walk?.truncated)
              throw refused("The fan walk or an accepted continuation is truncated; no writes can be previewed");
            // Timestamp is authored-revision stable; wall time would invalidate an identical preview.
            const request = applyRequest(
              snapshot,
              price(snapshot, grids, doc, fans, catalogs.tables),
              appliedAt ?? "",
              intent?.groups ?? [],
            );
            if (intent?.walk) {
              const inputs = resolveInputs(layers());
              const roster = suggestRoster(snapshot, [], {
                kinds: Object.fromEntries(Object.entries(inputs.units).map(([id, u]) => [id, u.kind.value])),
                roles: Object.fromEntries(Object.entries(inputs.units).map(([id, u]) => [id, u.role.value])),
              });
              const sheet = buildSheet({
                snapshot,
                fan: intent.walk,
                roster: [...roster.fans, ...roster.suggestions],
                grids,
                inputs,
              });
              request.components = [
                ...new Map(
                  [...accessoryWrites(snapshot, sheet), ...(request.components ?? [])].map((w) => [
                    w.id,
                    w,
                  ]),
                ).values(),
              ];
            }
            const scoped = scopeApplyRequest(request, snapshot.store, intent?.cells);
            const unwritten = unwrittenCells(scoped, intent?.cells ?? []);
            if (unwritten.length)
              throw refused(
                `These requested cells derive no write in this scope: ${unwritten.map((cell) => cell.join("/")).join(", ")}`,
              );
            return {
              input: scoped as unknown as Record<string, unknown>,
              dependencies: {
                snapshot: ductWriteEvidence(snapshot),
                grids,
                catalogs: catalogs.tables,
                firm,
              },
            };
          },
          heal: async () => {
            if (!intent?.groups?.length)
              throw refused("Stage writeIntent.groups in Work before healing");
            const plan = healPlan(snapshot, design);
            const input = {
              groups: intent.groups.map((group) => {
                const found = plan.groups.find((item) => item.group === group);
                if (!found) throw refused(`Group ${group} has nothing to heal`);
                return healRequestGroup(found);
              }),
            };
            return { input, dependencies: ductWriteEvidence(snapshot) };
          },
          "assign-fan": async () => {
            if (!intent?.fan) throw refused("Stage writeIntent.fan in Work before assigning a fan");
            fanOf(snapshot, intent.fan);
            return { input: intent.fan, dependencies: ductWriteEvidence(snapshot) };
          },
        }[kind]();
        return { process, input, dependencies };
      },
    };
  };
  const run = async (ctx: CommandContext, execution: ActionExecution, kind: Kind, phase: Phase) => {
    const p = prepared.parse(execution.prepared),
      target = targetOf(ctx);
    const entry = {
      losses: {
        key: "ducts.apply",
        native: "ducts.apply.plan",
        retires: (input: Record<string, unknown>, value: unknown) =>
          appliedCellPaths(input as unknown as DuctsApplyInput, value as DuctsApply.Res.Response),
      },
      heal: {
        key: "ducts.heal",
        native: "ducts.heal.preview",
        retires: (input: Record<string, unknown>, value: unknown) =>
          healedCellPaths(input, value as DuctsHeal.Res.Response),
      },
      "assign-fan": { key: "ducts.assign-fan", native: "ducts.assign-fan.preview", retires: () => [] as string[][] },
    }[kind];
    // The losses plan reads through the native Read sibling; a rehearsal calls its rolled-back TransactRead;
    // only apply reaches the ModelWrite leaf. Heal and fan plans never get here: the write boundary seals them.
    const key = phase === "apply" ? entry.key : entry.native;
    const value = await execution.step(
      "native",
      key,
      p.input,
      (id) => invokeBridge(bridge, target, key, p.input, id),
      { process: p.process as import("@pe/agent-contracts").NativeProcess },
    );
    // A plan the native owner refuses outright (a shared type write it cannot scope, a refused store) seals
    // nothing, so it can never arm an apply; its reasons are the plan's refusal and every staged cell stays.
    if (kind === "losses" && phase !== "apply") {
      const refusal = lossPlanRefusal((value as DuctsApply.Res.Response).writes);
      if (refusal) throw refused(refusal, "ducts.plan-refused");
    }
    const handle = ctx.admission.input.work as { key: import("@pe/agent-contracts").WorkKey };
    const paths = phase === "apply" ? entry.retires(p.input, value) : [];
    const fanPaths = paths.filter((path) => tools.fans.work.editable.some((pattern) => pattern[0] === path[0]));
    const ductPaths = paths.filter((path) => !fanPaths.includes(path));
    const retired = ductPaths.length ? await execution.retireWork(handle.key, "ducts", ductPaths) : undefined;
    if (fanPaths.length) await execution.retireWork({ ...handle.key, route: "fans" }, "fans", fanPaths);
    return {
      value,
      derivedRequest: p.input,
      target: { session: target.session, document: null },
      ...(retired ? { retired } : {}),
    };
  };
  return {
    "ducts.refresh": command(commands["ducts.refresh"], z.null(), {
      bind: async (ctx) => {
        targetOf(ctx);
        return { effects: [] };
      },
      run: async (ctx) => {
        const target = targetOf(ctx);
        ductsReadings(bridge).refresh(target);
        return { target, refreshed: true };
      },
    }),
    // The registry wraps these at boot: `commands[key].writeBoundary` (or `workIntent` for a rehearsal) carries
    // the binding. ducts.plan-heal and ducts.plan-assign-fan have no executor: the registry binds the apply's in
    // its plan phase, which seals the derived request without a native call.
    ...Object.fromEntries(
      (
        [
          ["ducts.plan-losses", "losses", "plan"],
          ["ducts.apply-losses", "losses", "apply"],
          ["ducts.apply-heal", "heal", "apply"],
          ["ducts.apply-assign-fan", "assign-fan", "apply"],
          ["ducts.rehearse-heal", "heal", "rehearse"],
          ["ducts.rehearse-assign-fan", "assign-fan", "rehearse"],
        ] as const
      ).map(([key, kind, phase]) => {
        return [
          key,
          command(commands[key], prepared, {
            seal: (p) => ({ request: p.input, evidence: p.dependencies }),
            bind: (ctx) => bind(ctx, kind, phase),
            run: (ctx, execution) => run(ctx, execution, kind, phase),
          }),
        ];
      }),
    ),
  };
}
