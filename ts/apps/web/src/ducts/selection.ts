/**
 * Several systems open at once (kaitpw 2026-10-24: "do what you recommmend and then re ask me
 * after i can feel it"). The page's `system` key is the open list, oldest first; everything that
 * reads groups, terminals or units takes their union (`scopeOf`), and the verbs that need one
 * system (write, heal, fan, the header's fan static) take the active one, `activeSystem`.
 */
import type { Neighbour, Hop } from "@pe/ducts-domain/neighbours";
import type { DuctSnapshot } from "@pe/ducts-domain/types";
import type { Paint, PaintOf, Tier } from "#/scene/types";
import { choice, defineKnobs, num } from "#/knobs/knobs";

/**
 * The multi-system defaults, each a judgment call kaitpw re-rules once he has felt it.
 * All four are refetch knobs because each changes the captured element set.
 * `neighbourCap` bounds networks per unit. Four preserves every observed hop (Chadds max 3);
 * the default classification filter already reduces that max to 2.
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
    neighbourCap: num("Neighbours per unit", 4, [0, 12, 1], "refetch"),
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
 * The picture's paint: opened elements are `subject`, neighbours are `stub`, both keyed by the
 * element's OWN Revit system name, so a shared
 * network shows where systems change (kaitpw 2026-10-24: "i cant tell when systems change. like in
 * revit we have a view template that colors them"). The URL layer owns whether keys exist;
 * LOOK.subject.bySystem remains a dev-only master palette override. Anything else is context.
 */
export function paintOfDucts(
  snapshot: DuctSnapshot,
  opened: ReadonlySet<number>,
  stubs: ReadonlySet<number>,
  systemColours = true,
): PaintOf {
  const systemOf = new Map<number, string>();
  for (const e of [...snapshot.nodes, ...snapshot.segments])
    if (e.systemName) systemOf.set(e.id, e.systemName);
  return (instance) => {
    const id = instance.revitId;
    const tier: Tier | null =
      id != null && opened.has(id) ? "subject" : id != null && stubs.has(id) ? "stub" : null;
    if (!tier) return undefined;
    const key = !systemColours || id == null ? undefined : systemOf.get(id);
    const paint: Paint = key ? { tier, key } : { tier };
    return paint;
  };
}
