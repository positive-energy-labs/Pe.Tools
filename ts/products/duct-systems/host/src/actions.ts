


import { ductWriteEvidence } from "@pe/ducts-domain/write-evidence";

import { healPlan, healRequestGroup } from "@pe/ducts-domain/heal";
import { fanOf } from "@pe/duct-systems-domain/action-targets";








import type { DuctSnapshot } from "@pe/ducts-domain/types";

import type { RevitBridge } from "../../../../apps/host/src/bridge.ts";
import { refused } from "../../../../apps/host/src/command-executor.ts";












import type { DuctsHeal } from "@pe/host-contracts/generated";

import { ductActionExecutors, type DuctActionPreparation, type DuctActionDependencies } from "@pe/ducts-host/action-runtime";
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

async function prepareHeal(p: DuctActionPreparation) {
  let { intent, snapshot, design } = p;

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

}
async function prepareFanAssignment(p: DuctActionPreparation) {
  let { intent, snapshot } = p;

            if (!intent?.fan) throw refused("Stage writeIntent.fan in Work before assigning a fan");
            fanOf(snapshot, intent.fan);
            return { input: intent.fan, dependencies: ductWriteEvidence(snapshot) };

}

export function ductSystemsExecutors(bridge: RevitBridge["Service"], deps: DuctActionDependencies = {}) {
  return {
    ...ductActionExecutors({
      snapshot: (intent, read) => healSnapshot(intent.groups ?? [], read), derive: prepareHeal,
      entry: { key: "ducts.heal", native: "ducts.heal.preview", refusePlan: null,
        retires: (input, value) => healedCellPaths(input, value as DuctsHeal.Res.Response) },
      bindings: [["ducts.apply-heal", "heal", "apply"], ["ducts.rehearse-heal", "heal", "rehearse"]],
    }, bridge, deps),
    ...ductActionExecutors({
      snapshot: (intent, read) => { if (!intent.fan) throw refused("Stage writeIntent.fan before assigning a fan"); return read({kind: "systems", systemIds: [intent.fan.systemId]}); },
      derive: prepareFanAssignment,
      entry: { key: "ducts.assign-fan", native: "ducts.assign-fan.preview", refusePlan: null, retires: () => [] },
      bindings: [["ducts.apply-assign-fan", "assign-fan", "apply"], ["ducts.rehearse-assign-fan", "assign-fan", "rehearse"]],
    }, bridge, deps),
  };
}
