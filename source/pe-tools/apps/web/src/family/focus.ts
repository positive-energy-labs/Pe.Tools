/**
 * FOCUS — /family's one provenance subject, shared by all four surfaces.
 *
 * THE LAW: at any moment there is at most ONE focus, and hovering any surface lights the same
 * set on every other. A focus is either a constituent (a solid, connector, plane offset, or
 * array) or a parameter (optionally narrowed to one type's cell). From it, every surface
 * derives its own highlight by asking this module — never by comparing ids itself:
 *
 *   drawing        → `focusConstituentIds`  (stroke the hits, dim the rest)
 *   register cards → `focusConstituentIds` for the card, `focusHitsParam` for each DimChip
 *   type matrix    → `focusHitsParam` for the row, `focusHitsCell` for the one cell
 *   geometry table → `focusHitsConstituent`
 *   doc pane       → the route resolves the hit params' citations through the cite channel
 *
 * PRECEDENCE: `focus = pinned ?? hovered` (the same rule the grounded-doc engine uses for
 * citations). A pin is a commitment made by clicking; hover is a question asked by the
 * pointer, and a question never opens, closes, or resizes anything — that is the cursor's
 * job, per the takeoffs cursor-vs-hover law.
 *
 * A constituent focus hits every parameter its dimensions READ; a parameter focus hits every
 * constituent that reads IT. The relation is the authored reference graph, nothing else —
 * no host round trip, no heuristics, and no transitive closure through formulas.
 */
import { paramRef, type FamilyModel } from "#/family/model";

export type Focus =
  | { kind: "constituent"; id: string }
  /** `typeName` present ⇒ the focus is one CELL of that parameter's row, not the whole row. */
  | { kind: "param"; name: string; typeName?: string }
  | null;

/** focus = pinned ?? hovered. One law, stated once, used by every surface. */
export const mergeFocus = (pinned: Focus, hovered: Focus): Focus => pinned ?? hovered;

/** Every param name a constituent's dimensions read. */
export function constituentParamNames(model: FamilyModel, id: string): string[] {
  const cut = id.indexOf(":");
  if (cut < 0) return [];
  const kind = id.slice(0, cut);
  const slug = id.slice(cut + 1);
  const refs: (string | undefined)[] = [];
  if (kind === "s") {
    const solid = model.solids?.[slug];
    refs.push(solid?.width, solid?.depth, solid?.height, solid?.diameter);
  } else if (kind === "pl") {
    refs.push(model.planes?.[slug]?.by);
  } else if (kind === "c") {
    const connector = model.connectors?.[slug];
    refs.push(connector?.diameter, connector?.width, connector?.height, connector?.stub?.depth);
  } else if (kind === "a") {
    refs.push(model.arrays?.[slug]?.halfCount);
  }
  return refs.map(paramRef).filter((name): name is string => name != null);
}

/** Reverse of the above: every constituent whose dimensions read this parameter. */
export function paramConstituentIds(model: FamilyModel, name: string): string[] {
  const reads = (...refs: (string | undefined)[]) => refs.some((ref) => paramRef(ref) === name);
  const ids: string[] = [];
  for (const [slug, solid] of Object.entries(model.solids ?? {}))
    if (reads(solid.width, solid.depth, solid.height, solid.diameter)) ids.push(`s:${slug}`);
  for (const [slug, plane] of Object.entries(model.planes ?? {}))
    if (reads(plane.by)) ids.push(`pl:${slug}`);
  for (const [slug, connector] of Object.entries(model.connectors ?? {}))
    if (reads(connector.diameter, connector.width, connector.height, connector.stub?.depth))
      ids.push(`c:${slug}`);
  for (const [slug, spec] of Object.entries(model.arrays ?? {}))
    if (reads(spec.halfCount)) ids.push(`a:${slug}`);
  return ids;
}

/** A constituent focus hits itself; a param focus hits every constituent that reads it. */
export function focusHitsConstituent(focus: Focus, model: FamilyModel, id: string): boolean {
  if (!focus) return false;
  if (focus.kind === "constituent") return focus.id === id;
  return paramConstituentIds(model, focus.name).includes(id);
}

/** A param focus hits its own row (whatever type it names); a constituent focus hits every
 *  param its dimensions read. The `typeName` narrowing is a CELL question — see below. */
export function focusHitsParam(focus: Focus, model: FamilyModel, name: string): boolean {
  if (!focus) return false;
  if (focus.kind === "param") return focus.name === name;
  return constituentParamNames(model, focus.id).includes(name);
}

/** One matrix cell: the row must be hit AND the focus must name this exact type. A focus with
 *  no `typeName` lights the whole row and no single cell — that is the honest answer, because
 *  "this parameter" is not a claim about which type you meant. */
export function focusHitsCell(
  focus: Focus,
  model: FamilyModel,
  name: string,
  typeName: string,
): boolean {
  return (
    focus?.kind === "param" && focus.typeName === typeName && focusHitsParam(focus, model, name)
  );
}

/** The constituent id SET a focus lights up — what the drawing and the cards need.
 *  null (not an empty set) means "no focus": nothing is lit and nothing is dimmed. */
export function focusConstituentIds(focus: Focus, model: FamilyModel): Set<string> | null {
  if (!focus) return null;
  return new Set(
    focus.kind === "constituent" ? [focus.id] : paramConstituentIds(model, focus.name),
  );
}

/** The parameter names a focus lights up — what the citation channel resolves sources for. */
export function focusParamNames(focus: Focus, model: FamilyModel): string[] {
  if (!focus) return [];
  return focus.kind === "param" ? [focus.name] : constituentParamNames(model, focus.id);
}
