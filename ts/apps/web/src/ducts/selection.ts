/**
 * Several systems open at once (kaitpw 2026-10-24: "do what you recommmend and then re ask me
 * after i can feel it"). The page's `system` key is the open list, oldest first; everything that
 * reads groups, terminals or units takes their union (`scopeOf`), and the verbs that need one
 * system (write, heal, fan, the header's fan static) take the active one, `activeSystem`.
 */
import type { Neighbour, Hop } from "@pe/ducts-domain/neighbours";
import type { DuctSnapshot } from "@pe/ducts-domain/types";
import type { PaintOf, Tier } from "#/scene/types";
import { airTypesOf } from "@pe/ducts-domain/air-types";
import { choice, defineKnobs, num } from "#/knobs/knobs";

/**
 * The multi-system defaults, each a judgment call kaitpw re-rules once he has felt it.
 * Each can change the captured element set. Equipment hops keep to the same classification by
 * default; plenums and shared ducts use their physical connections.
 */
export const DUCTS_MULTI = defineKnobs("ducts", "ts/apps/web/src/ducts/selection.ts", {
  selection: {
    systemCap: num("Open system cap", 4, [1, 12, 1], "refetch"),
    stubFt: num("Stub reach (ft)", 10, [0, 50, 1], "refetch"),
    hop: choice<Hop>(
      "Equipment hop",
      "same-classification",
      ["same-classification", "all"],
      "refetch",
    ),
  },
});

/** The active system: the most recently opened, the one write, heal and fan act on; "" with none. */
export const activeSystem = (page: { readonly system: readonly string[] }) =>
  page.system.at(-1) ?? "";

/**
 * The open list as the page keeps it: each name once, at most `systemCap`.
 * ponytail: a pick past the cap closes the OLDEST open system; the newest stays active.
 */
export const capped = (open: readonly string[]) =>
  [...new Set(open)].slice(-DUCTS_MULTI.read().selection.systemCap);

/** The open list with `name` opened (it becomes active) or, when it is open, closed. */
export const toggleSystem = (open: readonly string[], name: string) =>
  open.includes(name) ? open.filter((n) => n !== name) : capped([...open, name]);

/** The open list with `name` open: as it is when it already is, else with `name` active. */
export const withSystem = (open: readonly string[], name: string) =>
  open.includes(name) ? [...open] : capped([...open, name]);

/** The neighbours' stub elements that are not already open. */
export const stubIdsOf = (neighbours: readonly Neighbour[], open: ReadonlySet<number>) =>
  new Set(neighbours.flatMap((n) => n.stub).filter((id) => !open.has(id)));

/**
 * Each element's kind is its air type; the Scene3D `kinds` table (the person's palette) picks the
 * hue and the Colour dial decides whether it shows. A multi-stream equipment box is unknown.
 */
export function paintOfDucts(
  snapshot: DuctSnapshot,
  opened: ReadonlySet<number>,
  stubs: ReadonlySet<number>,
): PaintOf {
  const types = airTypesOf(snapshot);
  return (instance) => {
    const id = instance.revitId;
    const tier: Tier | null =
      id != null && opened.has(id) ? "subject" : id != null && stubs.has(id) ? "stub" : null;
    if (!tier) return undefined;
    const kind = id == null ? "unknown" : (types.get(id) ?? "unknown");
    return { tier, kind };
  };
}
