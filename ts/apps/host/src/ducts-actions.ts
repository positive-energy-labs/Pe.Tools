import { workWriteBoundary } from "./work-write-boundary.ts";
import { commands, tools, canonicalRouteInput, type DuctsApplyInput } from "@pe/agent-contracts";
import { healPlan, healRequestGroup } from "@pe/ducts-domain/heal";
import { fanOf } from "@pe/ducts-domain/action-targets";
import { applyRequest, price, TABLE_IDS } from "@pe/ducts-domain/pricing";
import { toGrids } from "@pe/ducts-domain/loss-grid";
import { stagedDucts } from "@pe/agent-contracts";
import type { DuctSnapshot } from "@pe/ducts-domain/types";
import { z } from "zod";
import { invokeBridge, type RevitBridge } from "./bridge.ts";
import { command, refused, type CommandContext } from "./command-executor.ts";
import type { ActionExecution } from "./action-journal.ts";
import { lifetime } from "./family-actions.ts";
import type { SdkReceiptReader } from "./native-receipts.ts";
import { ductsReadings } from "./ducts-readings.ts";
import { readDuctCatalogs } from "./duct-catalogs.ts";
import { appliedCellPaths } from "@pe/ducts-domain/staged";
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

/** Only a fully confirmed heal consumes its intent; partial/refused/preview results remain editable. */
export function healedCellPaths(
  input: Record<string, unknown>,
  value: DuctsHeal.Res.Response,
): string[][] {
  if (input.previewOnly || value.previewOnly) return [];
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
        const intent = doc.writeIntent.edit?.value;
        const read = (selector: Record<string, unknown>) =>
          invokeBridge<DuctSnapshot>(
            bridge,
            target,
            selector.kind === "roster" ? "ducts.snapshot.roster" : "ducts.snapshot.walk",
            {
              selector,
              slots: stagedDucts(doc).parameters,
            },
          );
        const snapshot =
          kind === "assign-fan"
            ? intent?.fan
              ? await read({ kind: "systems", systemIds: [intent.fan.systemId] })
              : (() => {
                  throw refused("Stage writeIntent.fan before assigning a fan");
                })()
            : await healSnapshot(intent?.groups ?? [], read);
        const evidence = {
          ...snapshot,
          document: { ...snapshot.document, readAt: "", elapsedMs: 0 },
        };
        let input: Record<string, unknown>,
          dependencies: unknown = evidence;
        if (kind === "losses") {
          const tables = await invokeBridge(bridge, target, "ducts.tables", { ids: TABLE_IDS });
          const grids = toGrids(tables as Parameters<typeof toGrids>[0]);
          const catalogs = await readDuctCatalogs();
          // Timestamp is authored-revision stable; wall time would invalidate an identical preview.
          const request = applyRequest(
            snapshot,
            price(snapshot, grids, doc, catalogs.tables),
            appliedAt ?? "",
            intent?.groups ?? [],
          );
          for (const tableId of new Set([
            ...request.fittings.map((f) => f.table ?? ""),
            ...Object.values(stagedDucts(doc).rules).map((r) => r.table),
          ])) {
            const table = grids[tableId.toUpperCase()];
            if (!table || Object.values(table).some((grid) => grid.z != null))
              throw refused(
                `Loss server cannot price table ${tableId}; choose a served one- or two-axis table`,
              );
          }
          input = request as unknown as Record<string, unknown>;
          dependencies = { snapshot: evidence, tables, catalogs };
        } else if (kind === "heal") {
          if (!intent?.groups?.length)
            throw refused("Stage writeIntent.groups in Work before healing");
          const plan = healPlan(snapshot, doc);
          input = {
            groups: intent.groups.map((group) => {
              const found = plan.groups.find((item) => item.group === group);
              if (!found) throw refused(`Group ${group} has nothing to heal`);
              return healRequestGroup(found);
            }),
          };
        } else {
          if (!intent?.fan) throw refused("Stage writeIntent.fan in Work before assigning a fan");
          fanOf(snapshot, intent.fan);
          input = intent.fan;
        }
        return { process, input: { ...input, previewOnly }, dependencies };
      },
    };
  };
  const run = async (ctx: CommandContext, execution: ActionExecution, kind: Kind) => {
    const p = prepared.parse(execution.prepared),
      target = targetOf(ctx);
    const key = kind === "losses" ? "ducts.apply" : `ducts.${kind}`;
    const value = await execution.step(
      "native",
      key,
      p.input,
      (id) => invokeBridge(bridge, target, key, p.input, id),
      { process: p.process as import("@pe/agent-contracts").NativeProcess },
    );
    const handle = ctx.admission.input.work as { key: import("@pe/agent-contracts").WorkKey };
    const paths =
      kind === "losses"
        ? appliedCellPaths(p.input as unknown as DuctsApplyInput, value as DuctsApply.Res.Response)
        : kind === "heal"
          ? healedCellPaths(p.input, value as DuctsHeal.Res.Response)
          : [];
    const retired = paths.length
      ? await execution.retireWork(handle.key, "ducts", paths)
      : undefined;
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
            workWriteBoundary(
              command(commands[key], prepared, {
                bind: (ctx) => bind(ctx, kind, preview),
                run: (ctx, execution) => run(ctx, execution, kind),
              }),
              bridge,
              deps,
              {
                route: "ducts",
                key: `ducts.preview-${kind}`,
                previewOnly: preview,
                nativePreview: true,
                handle: (input) => {
                  const handle = input.work as {
                    key: import("@pe/agent-contracts").WorkKey;
                    expectedRevision: number;
                  };
                  return { key: handle.key, revision: handle.expectedRevision };
                },
                ...commands[key].derivation,
              },
            ),
          ];
        }),
      ),
    ),
  };
}
