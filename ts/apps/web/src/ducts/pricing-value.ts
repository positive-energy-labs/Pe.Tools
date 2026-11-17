/**
 * What the `ducts.pricing` read computes, pure over what it acquired: every roster fan's calc on
 * this network (the only pricing, MAP invariant 6), the survey beside them (flows, roles, findings,
 * staged Work values; it prices nothing), and the network-health analysis. The host body encodes
 * it to the wire; a fixture that stands in for the read calls this same function.
 */
import {
  ductsPricingData,
  ductParameterSlots,
  serveSetting,
  stagedValues,
  type DuctsInputs,
  type DuctsDesign,
  type DuctsFirm,
  type SettingTierRead,
} from "@pe/agent-contracts";
import type { Catalogs } from "@pe/ducts-domain/catalog";
import { DEFAULT_DESIGN_FRICTION_RATE } from "@pe/ducts-domain/equivalent-length";
import { healPlan } from "@pe/ducts-domain/heal";
import type { Grids } from "@pe/ducts-domain/loss-grid";
import { inferJoints } from "@pe/ducts-domain/proximity";
import { suggestRoster } from "@pe/ducts-domain/roster";
import { withStoredRulings } from "@pe/ducts-domain/rulings";
import { buildSheet, encounterRulings, resolveInputs } from "@pe/ducts-domain/sheet/index";
import { survey } from "@pe/ducts-domain/survey";
import { systemList } from "@pe/ducts-domain/system-list";
import { systemNotes } from "@pe/ducts-domain/system-list-search";
import type { DuctSnapshot } from "@pe/ducts-domain/types";
import { workElementId } from "@pe/ducts-domain/work-subject";
import { FIRM_SEED, workLayer } from "@pe/host/ducts-inputs";
import { z } from "zod";

export const rosterInputs = (inputs: DuctsInputs) => ({
  kinds: Object.fromEntries(Object.entries(inputs.units).flatMap(([id, u]) => (u.kind.status === "valid" ? [[id, u.kind.value]] : []))),
  roles: Object.fromEntries(Object.entries(inputs.units).flatMap(([id, u]) => (u.role.status === "valid" ? [[id, u.role.value]] : []))),
});

export function pricingValue(
  snapshot: DuctSnapshot,
  grids: Grids,
  catalogs: Catalogs,
  design: DuctsDesign,
  settings: readonly SettingTierRead[] = [],
  firm: DuctsFirm = FIRM_SEED,
  revision = 0,
) {
  const stored = withStoredRulings(design, snapshot.store, snapshot) ?? design;
  const work = workLayer(design);
  const inputs = resolveInputs({
    snapshot,
    work,
    versions: { Work: revision },
    store: snapshot.store as Parameters<typeof resolveInputs>[0]["store"],
    firm,
    catalogs,
  });
  const suggested = suggestRoster(snapshot, [], rosterInputs(inputs));
  const ports = [...suggested.fans, ...suggested.suggestions];
  // One calc per roster port, each on this read's network and inputs, the way the fans read builds
  // one. ponytail: every port is priced on every read; price only the opened systems' ports if a
  // document-wide read measures slow.
  const calcs = ports.map((fan) =>
    buildSheet({
      snapshot,
      grids,
      inputs,
      roster: ports,
      fan: { unitId: fan.unitId, portIndex: fan.portIndex },
      encounterRulings: encounterRulings({ work }),
    }),
  );
  const surveyed = survey(snapshot, design);
  const heal = healPlan(snapshot, design);
  const edit = stagedValues(stored, stored);
  // A staged drop whose subject this acquisition did not read refuses the whole read, as it always
  // has (`workElementId` throws): Work outside the network never reads as a current, unpriced answer.
  for (const key of [...Object.keys(edit.terminalDrops), ...Object.keys(edit.componentDrops)])
    workElementId(snapshot, key);
  return {
    calcs,
    survey: {
      snapshot: surveyed.snapshot,
      flows: surveyed.flows,
      equipmentFlows: surveyed.equipmentFlows,
      roles: surveyed.roles,
      findings: surveyed.findings,
      edit: {
        ...edit,
        designFriction: serveSetting(
          settings,
          ["project", "firm"],
          ["designFriction"],
          z.number().positive(),
          DEFAULT_DESIGN_FRICTION_RATE,
        ).value!,
        parameters: ductParameterSlots(settings),
      },
    },
    analysis: {
      heal,
      notes: systemNotes(surveyed, design, heal),
      systems: systemList(surveyed.snapshot, calcs),
      inference: inferJoints(snapshot, 1, stored),
    },
  };
}

// Built once: z.json() constructs a lazy union per call, and wire visits every leaf of the pricing result.
const jsonLeaf = z.json();
/** The wire carries every Map entry and Set member, never JSON.stringify's empty object. */
function wire(value: unknown): z.infer<ReturnType<typeof z.json>> {
  if (value instanceof Map)
    return Object.fromEntries([...value].map(([key, item]) => [String(key), wire(item)]));
  if (value instanceof Set) return [...value].map(wire);
  if (Array.isArray(value)) return value.map(wire);
  if (value !== null && typeof value === "object")
    return Object.fromEntries(
      Object.entries(value)
        .filter(([, item]) => item !== undefined)
        .map(([key, item]) => [key, wire(item)]),
    );
  return jsonLeaf.parse(value);
}
/** The computed value as the wire carries it: decoded by the read's own contract, so a shape the contract refuses fails here. */
export const pricingWire = (value: ReturnType<typeof pricingValue>) =>
  ductsPricingData.pick({ calcs: true, survey: true, analysis: true }).parse(wire(value));
