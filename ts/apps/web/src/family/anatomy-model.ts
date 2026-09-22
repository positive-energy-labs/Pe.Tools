import type { Draft, Focus, FamilyPageModel } from "#/family/model";
import { bindingOf, effective, inches } from "#/family/model";
import { boundParam } from "#/family/world";

export type Axis = "x" | "y" | "z";

/** One drawable constituent in world inches. Boxes and cylinders are z-up with their x/y centre
 * on the family origin unless offset; connectors are a point + an outward normal. */
export type Part =
  | {
      slug: string;
      kind: "box" | "cyl";
      isVoid?: boolean;
      /** x extent (a cylinder's diameter doubles as its y extent). */
      w: number;
      d: number;
      z0: number;
      h: number;
    }
  | {
      slug: string;
      kind: "conn";
      /** null when the constituent authors no diameter dim — drawn as a fixed glyph, honestly. */
      dia: number | null;
      pos: Record<Axis, number>;
      normal: { axis: Axis; sign: 1 | -1 };
      stub: number | null;
    };

/** A dim resolved THROUGH its binding: bound → the parameter at this type, unbound → the frozen
 * literal. This is what makes bind/unbind and ghost-row edits visible in the drawing. */
function dimOf(
  world: FamilyPageModel,
  draft: Draft,
  typeName: string,
  slug: string,
  property: string,
): number | null {
  const binding = bindingOf(world, draft, slug, property);
  const param = boundParam(binding);
  return param ? inches(effective(draft, param, typeName)) : inches(binding);
}

export function buildParts(world: FamilyPageModel, draft: Draft, typeName: string): Part[] {
  const dim = (slug: string, property: string) => dimOf(world, draft, typeName, slug, property);
  const bodyW = dim("body", "width");
  const bodyD = dim("body", "depth");
  const bodyH = dim("body", "height");
  const topD = dim("top-neck", "diameter");
  const topH = dim("top-neck", "height");
  const parts: Part[] = [];

  if (bodyW != null && bodyH != null)
    parts.push({ slug: "body", kind: "box", w: bodyW, d: bodyD ?? bodyW, z0: 0, h: bodyH });
  if (topD != null && topH != null && bodyH != null)
    // Hosted on the body's top face — its origin moves when Body Height moves.
    parts.push({ slug: "top-neck", kind: "cyl", w: topD, d: topD, z0: bodyH, h: topH });

  // Core Height is a formula, so the void is drawn from what FEEDS it rather than from a literal.
  const boreDia = dim("core-bore", "diameter");
  const coreLen =
    inches(effective(draft, "Core Height", typeName)) ??
    (bodyH != null && topH != null ? bodyH + topH : null);
  if (boreDia != null && coreLen != null)
    parts.push({
      slug: "core-bore",
      kind: "cyl",
      isVoid: true,
      w: boreDia,
      d: boreDia,
      z0: 0,
      h: coreLen,
    });

  const supplyDia = dim("supply-air", "diameter");
  if (supplyDia != null && bodyH != null)
    parts.push({
      slug: "supply-air",
      kind: "conn",
      dia: supplyDia,
      pos: { x: 0, y: 0, z: bodyH + (topH ?? 0) },
      normal: { axis: "z", sign: 1 },
      stub: dim("supply-air", "stub.depth"),
    });

  const returnZ = dim("return-air", "elevation");
  if (returnZ != null && bodyW != null)
    parts.push({
      slug: "return-air",
      kind: "conn",
      dia: dim("return-air", "diameter"),
      pos: { x: -bodyW / 2, y: 0, z: returnZ },
      normal: { axis: "x", sign: -1 },
      stub: dim("return-air", "stub.depth"),
    });

  const pipeZ = dim("condensate", "elevation");
  if (pipeZ != null && bodyW != null)
    parts.push({
      slug: "condensate",
      kind: "conn",
      dia: null, // the fixture authors no diameter dim on the drain — the glyph says so
      pos: { x: bodyW / 2, y: 0, z: pipeZ },
      normal: { axis: "x", sign: 1 },
      stub: dim("condensate", "stub.depth"),
    });

  return parts;
}

// ── the three views ─────────────────────────────────────────────────────────────────────────────

export interface ViewDef {
  key: string;
  label: string;
  u: Axis;
  v: Axis;
  depth: Axis;
}

export const VIEWS: ViewDef[] = [
  { key: "front", label: "front · looking −Y", u: "x", v: "z", depth: "y" },
  { key: "side", label: "side · looking +X", u: "y", v: "z", depth: "x" },
  { key: "plan", label: "plan · looking −Z", u: "x", v: "y", depth: "z" },
];

/** Fixed viewBox, fixed scale: the drawing must be comparable between types, so a taller type
 * draws TALLER rather than being refitted to the same box. */
export const SCALE = 3;
export const BOX = 200;
export const M = 12;

export const AXES: Axis[] = ["x", "y", "z"];

/** "+Z" / "-X" → axis + sign; the evaluator reports normals as signed axis names. */
export const NORMAL_RE = /^([+-])([XYZ])$/;

/** World extent of a box/cyl part along one axis. */
export function range(part: Extract<Part, { kind: "box" | "cyl" }>, axis: Axis): [number, number] {
  if (axis === "x") return [-part.w / 2, part.w / 2];
  if (axis === "y") return [-part.d / 2, part.d / 2];
  return [part.z0, part.z0 + part.h];
}

/** Hovering LIGHTS, clicking OPENS — the same two-step the table's rows use, so the drawing is
 * not a separate interaction vocabulary you have to learn beside it. */
export const hoverProps = (
  slug: string,
  onFocus: (focus: Focus) => void,
  onInspect: (slug: string) => void,
) => ({
  onMouseEnter: () => onFocus({ kind: "part" as const, id: slug }),
  onMouseLeave: () => onFocus(null),
  onClick: () => onInspect(slug),
  style: { cursor: "pointer" as const },
});
