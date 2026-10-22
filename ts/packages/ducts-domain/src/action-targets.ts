/**
 * What a heal or fan verb acts on, decided from plain data: the snapshot, the Work document, the
 * chosen system and the selected element. Each throws the sentence that says why there is no
 * target; the route's `ready` shows it and the verb refuses with it.
 */
import type { DuctsRouteDocument } from "@pe/agent-contracts";

import { EMPTY_CATALOGS, type Catalogs } from "./catalog.ts";
import { fanCandidates, fansOwedBase } from "./fan-assignment.ts";
import { healPlan } from "./heal.ts";
import type { Grids } from "./loss-grid.ts";
import { price } from "./pricing.ts";
import { survey } from "./survey.ts";
import { systemScope } from "./system-scope.ts";
import type { DuctSnapshot } from "./types.ts";
import { networkWord } from "./words.ts";

/** The element the page selected, by id; null when none (or an issue id). */
const selectedId = (selected: string) => {
  const id = Number(selected);
  return selected && Number.isInteger(id) ? id : null;
};

/** The group's heal plan over the raw snapshot the route read; throws why there is none. */
export const healOf = (
  snapshot: DuctSnapshot,
  doc: DuctsRouteDocument | null,
  group: string | undefined,
) => {
  if (!group) throw Error("Name the duct network to heal");
  const found = healPlan(snapshot, doc).groups.find((g) => g.group === group);
  if (!found) throw Error(`Nothing in ${networkWord(snapshot, group)} heals in Revit`);
  return found;
};

/** Pe's ESP of a group now (the largest path total with the staged cells), with what finds it again. */
export const espBefore = (
  snapshot: DuctSnapshot,
  doc: DuctsRouteDocument | null,
  grids: Grids | null,
  catalogs: Catalogs | null,
  group: string,
) => {
  const surveyed = grids
    ? price(snapshot, grids, doc, catalogs ?? EMPTY_CATALOGS)
    : survey(snapshot, doc);
  const g = surveyed.snapshot.groups.find((x) => x.id === group);
  const ids = [...surveyed.snapshot.nodes, ...surveyed.snapshot.segments]
    .filter((e) => e.groupId === group && e.id > 0)
    .map((e) => e.id);
  const esp = grids
    ? ((surveyed as ReturnType<typeof price>).next.byGroup[group]?.fan ?? null)
    : null;
  return { esp, roots: g?.rootIds ?? [], ids };
};

/**
 * The group a heal verb run bare acts on: the chosen system's Heal row, as the inbox lists them
 * (`triage`). With several, the selected element's network, else the one `previewed`; otherwise
 * refused, with where to choose.
 */
export const healTarget = (
  snapshot: DuctSnapshot,
  doc: DuctsRouteDocument | null,
  system: string,
  selected: string,
  previewed: string | null,
): string => {
  const scope = system ? systemScope(snapshot, system) : null;
  const where = system || "this document";
  const groups = healPlan(snapshot, doc)
    .groups.filter(
      (g) =>
        !scope ||
        scope.groups.includes(g.group) ||
        g.items.some((i) => i.ids.some((id) => scope.members.has(id))),
    )
    .map((g) => g.group);
  if (!groups.length) throw Error(`Nothing in ${where} heals in Revit`);
  if (groups.length === 1) return groups[0]!;
  const id = selectedId(selected);
  const holder = [...snapshot.nodes, ...snapshot.segments].find((e) => e.id === id)?.groupId;
  const pick = groups.find((g) => g === holder) ?? groups.find((g) => g === previewed);
  if (pick) return pick;
  throw Error(
    `${groups.length} networks in ${where} heal in Revit; select an element in one, or use its Heal row in the inbox`,
  );
};

/**
 * The fan the chosen system is offered, as the page offers it (`fansOwedBase` with the lead fan):
 * with several, the selected unit, else the `previewed` pair; otherwise refused, with why. `name`
 * is the person's word for a unit id.
 */
export const offeredFan = (
  snapshot: DuctSnapshot,
  doc: DuctsRouteDocument | null,
  grids: Grids | null,
  catalogs: Catalogs | null,
  system: string,
  selected: string,
  previewed: { unitId: number; systemId: number } | null,
  name: (id: number) => string | null,
) => {
  if (!system) throw Error("Choose a system to make its fan");
  const priced = grids ? price(snapshot, grids, doc, catalogs ?? EMPTY_CATALOGS) : null;
  const owed = fansOwedBase(
    snapshot,
    (priced ?? survey(snapshot, doc)).roles,
    (g) => priced?.next.byGroup[g]?.fans[0]?.unit ?? null,
  );
  const split = owed.split?.get(system);
  if (split)
    throw Error(
      `${system} spans separate networks with their own fans (${split.map((u) => name(u) ?? u).join(", ")}); Revit gives a system one fan, so split ${system} in Revit first`,
    );
  const offers = [...owed.values()].flat().filter((a) => a.system === system);
  if (!offers.length)
    throw Error(
      `No unit is offered as the fan of ${system}: it has its base equipment, or none of its units is a fan`,
    );
  if (offers.length === 1) return { ...offers[0]!, unit: name(offers[0]!.unitId) };
  const id = selectedId(selected);
  const pick =
    offers.find((a) => a.unitId === id) ??
    offers.find((a) => a.unitId === previewed?.unitId && a.systemId === previewed.systemId);
  if (pick) return { ...pick, unit: name(pick.unitId) };
  throw Error(`${offers.length} units could be the fan of ${system}; select one`);
};

/** The pair as a candidate over the snapshot the route read; throws why it is not offered. */
export const fanOf = (snapshot: DuctSnapshot, pair: { unitId: number; systemId: number }) => {
  const found = fanCandidates(snapshot, pair.unitId).find((c) => c.systemId === pair.systemId);
  if (!found)
    throw Error(
      `System ${pair.systemId} has base equipment, or ${pair.unitId} roots none of its groups`,
    );
  return found;
};
