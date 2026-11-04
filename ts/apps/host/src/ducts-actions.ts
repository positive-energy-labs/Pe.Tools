import { ductWriteEvidence } from "@pe/ducts-domain/write-evidence";
import { commands, tools, canonicalRouteInput, type DuctsApplyInput } from "@pe/agent-contracts";
import { healPlan, healRequestGroup } from "@pe/ducts-domain/heal";
import { fanOf } from "@pe/ducts-domain/action-targets";
import { applyRequest, price, TABLE_IDS } from "@pe/ducts-domain/pricing";
import { toGrids } from "@pe/ducts-domain/loss-grid";
import { ductsDesign, neutralFansWork, stagedDucts, workHandleSchema } from "@pe/agent-contracts";
import type { DuctSnapshot } from "@pe/ducts-domain/types";
import { z } from "zod";
import { invokeBridge, type RevitBridge } from "./bridge.ts";
import { command, refused, type CommandContext } from "./command-executor.ts";
import type { ActionExecution } from "./action-journal.ts";
import { lifetime } from "./family-actions.ts";
import type { SdkReceiptReader } from "./native-receipts.ts";
import { ductsReadings } from "./ducts-readings.ts";
import { readDuctCatalogs } from "./duct-catalogs.ts";
import { buildSheet, resolveCriteria, resolveInputs } from "@pe/ducts-domain/sheet/index";
import { accessoryWrites } from "@pe/ducts-domain/sheet/accessory-writes";
import { suggestRoster } from "@pe/ducts-domain/roster";
import { readFirm, workLayer } from "./ducts-inputs.ts";
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

/** Work is the only authored input. Preview and apply share the same derivation and journal. */
export function ductsExecutors(
  bridge: RevitBridge["Service"],
  deps: { sdk?: SdkReceiptReader } = {},
) {
  const bind = async (ctx: CommandContext, kind: Kind, previewOnly: boolean) => {
    const target = targetOf(ctx);
    const raw = ctx.admission.input.work as import("@pe/agent-contracts").WorkHandle;
    const { process } = await lifetime(bridge, target, "project", deps);
    const doc = await ctx.selectWork(tools.ducts.work, raw, (_doc, cells) => ({
      edits: tools.ducts.work.editable,
      facts: [["workingPhase"]],
      cells: cells.filter(({ cell }) => cell.edit).map(({ path }) => path),
    }));
    const fansKey = { ...raw.key, route: "fans" };
    const fanView = await ctx.work.view(fansKey, "fans");
    if (!fanView) throw refused("Fans Work is unavailable", "work.unavailable");
    const readWorks = z.record(z.string(), workHandleSchema).optional().parse(ctx.admission.input.readWorks);
    if (readWorks?.fans && canonicalRouteInput(readWorks.fans.key) !== canonicalRouteInput(fansKey))
      throw refused("Fans Work belongs to another document", "work.target");
    const fans = await ctx.selectWork(tools.fans.work, readWorks?.fans ?? { key: fansKey, revision: fanView.revision }, (_doc, cells) => ({
      edits: tools.fans.work.editable,
      cells: cells.filter(({ cell }) => cell.edit).map(({ path }) => path),
    }));
    const design = ductsDesign(doc, fans);
    const preview = ctx.read
      .receipts()
      .filter(
        (r) =>
          r.key === `ducts.preview-${kind}` &&
          r.state === "succeeded" &&
          canonicalRouteInput(r.target) === canonicalRouteInput(ctx.admission.target),
      )
      .at(-1);
    const appliedAt = previewOnly
      ? new Date().toISOString()
      : preview?.state === "succeeded"
        ? (preview.result as { derivedRequest?: { store?: { appliedAt?: string } } }).derivedRequest
            ?.store?.appliedAt
        : undefined;
    return {
      consumes: [
        {
          kind: "incarnation" as const,
          probe: { target: ctx.admission.target, process },
          expected: true as const,
        },
        {
          kind: "document-mark" as const,
          probe: { ref: target, takenAt: new Date().toISOString() },
          expected: true as const,
        },
      ],
      effects: previewOnly ? [] : [{ kind: "document" as const, ref: target }],
      prepare: async () => {
        const ductsScope = doc.writeIntent.edit?.value;
        const fanScope = fans.writeIntent.edit?.value;
        const cells =
          ductsScope?.cells || fanScope?.cells
            ? [...(ductsScope?.cells ?? []), ...(fanScope?.cells ?? [])]
            : undefined;
        const intent = { ...ductsScope, walk: fanScope?.walk, cells };
        const { firm } = await readFirm();
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
              slots: stagedDucts(design, (design) ?? neutralFansWork).parameters,
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
            const catalogs = await readDuctCatalogs();
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
              price(snapshot, grids, design, (design) ?? neutralFansWork, catalogs.tables),
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
            return {
              input: scopeApplyRequest(request, snapshot.store, intent?.cells) as unknown as Record<string, unknown>,
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
  const run = async (ctx: CommandContext, execution: ActionExecution, kind: Kind, preview: boolean) => {
    const p = prepared.parse(execution.prepared),
      target = targetOf(ctx);
    const entry = {
      losses: {
        key: "ducts.apply",
        retires: (input: Record<string, unknown>, value: unknown) =>
          appliedCellPaths(input as unknown as DuctsApplyInput, value as DuctsApply.Res.Response),
      },
      heal: {
        key: "ducts.heal",
        retires: (input: Record<string, unknown>, value: unknown) =>
          healedCellPaths(input, value as DuctsHeal.Res.Response),
      },
      "assign-fan": { key: "ducts.assign-fan", retires: () => [] as string[][] },
    }[kind];
    // A preview calls the native TransactRead sibling; only the apply entry reaches the ModelWrite leaf.
    const key = preview ? `${entry.key}.preview` : entry.key;
    const value = await execution.step(
      "native",
      key,
      p.input,
      (id) => invokeBridge(bridge, target, key, p.input, id),
      { process: p.process as import("@pe/agent-contracts").NativeProcess },
    );
    const handle = ctx.admission.input.work as { key: import("@pe/agent-contracts").WorkKey };
    const paths = entry.retires(p.input, value);
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
    ...Object.fromEntries(
      (["losses", "heal", "assign-fan"] as const).flatMap((kind) =>
        [true, false].map((preview) => {
          const key = `ducts.${preview ? "preview" : "apply"}-${kind}` as const;
          return [
            key,
            // The registry wraps this at boot: `commands[key].writeBoundary` carries the binding.
            command(commands[key], prepared, {
              seal: (p) => ({ request: p.input, evidence: p.dependencies }),
              bind: (ctx) => bind(ctx, kind, preview),
              run: (ctx, execution) => run(ctx, execution, kind, preview),
            }),
          ];
        }),
      ),
    ),
  };
}
