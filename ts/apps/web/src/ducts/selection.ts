/**
 * Several systems open at once (kaitpw 2026-10-24: "do what you recommmend and then re ask me
 * after i can feel it"). The page's `system` key is the open list, oldest first; everything that
 * reads groups, terminals or units takes their union (`scopeOf`), and the verbs that need one
 * system (write, heal, fan, the header's fan static) take the active one, `activeSystem`.
 */
import type { Neighbour, Hop } from "@pe/ducts-domain/neighbours";
import type { DuctSnapshot } from "@pe/ducts-domain/types";
import type { PaintOf } from "#/scene/types";

/**
 * The multi-system defaults, each a judgment call kaitpw re-rules once he has felt it.
 * ponytail: they register as knobs (systemCap, stubFt and hop marked `refetch`: each changes the
 * scene request) once `ts/apps/web/src/knobs/` lands (builder S1); until then this is the one place.
 * No `neighbourCap`: with `hop` on the airstream, no unit joins more than 2 neighbour networks on
 * the Chadds read (S2 report, 2026-10-24); the flood is many units, not one.
 */
export const DUCTS_MULTI: { systemCap: number; stubFt: number; hop: Hop } = {
  /** Most systems open at once; opening one past it closes the oldest. */
  systemCap: 4,
  /** A neighbour's stub: whole elements whose far end is this close to the shared unit, developed ft. */
  stubFt: 10,
  /** Which of a shared unit's ports a hop leaves by (`neighbours.ts`). */
  hop: "same-classification",
};

/** The active system: the most recently opened, the one write, heal and fan act on; "" with none. */
export const activeSystem = (page: { readonly system: readonly string[] }) =>
  page.system.at(-1) ?? "";

/**
 * The open list as the page keeps it: each name once, at most `systemCap`.
 * ponytail: a pick past the cap closes the OLDEST open system; the newest stays active.
 */
export const capped = (open: readonly string[]) =>
  [...new Set(open)].slice(-DUCTS_MULTI.systemCap);

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
 * The picture's paint: a stub element is `stub`, any other element the capture was asked for (the
 * open systems' networks) `subject`, both keyed by the element's OWN Revit system name, so a shared
 * network shows where systems change (kaitpw 2026-10-24: "i cant tell when systems change. like in
 * revit we have a view template that colors them"). Anything else is undefined: context.
 */
export function paintOfDucts(snapshot: DuctSnapshot, stubs: ReadonlySet<number>): PaintOf {
  const systemOf = new Map<number, string>();
  for (const e of [...snapshot.nodes, ...snapshot.segments])
    if (e.systemName) systemOf.set(e.id, e.systemName);
  return (instance) => {
    const id = instance.revitId;
    const tier =
      id != null && stubs.has(id) ? "stub" : instance.focus ? "subject" : null;
    if (!tier) return undefined;
    const key = id == null ? undefined : systemOf.get(id);
    return key ? { tier, key } : { tier };
  };
}
