import type { DuctGraph } from "@pe/ducts-domain/drawn-graph";
import { paintOf as resolvePaint } from "#/scene/grounds";
import type { PaintOf, SceneMeshes } from "#/scene/types";
import type { SurfacePort } from "#/scene/ports";

/** Autodesk BuiltInCategory.OST_MechanicalEquipment; PSC1 keeps this stable numeric identity. */
const EQUIPMENT_CATEGORY_ID = -2001140;
/** Domain identity and capture category own shell treatment; neither infers connections. */
export function equipmentPaint(graph: DuctGraph, base?: PaintOf): PaintOf {
  const systems = new Map([...graph.nodes, ...graph.segments].map((e) => [e.id, e.systemName]));
  const ids = new Set(
    graph.nodes.filter((node) => node.kind === "equipment").map((node) => node.id),
  );
  return (instance) => {
    const paint = {
      ...resolvePaint(instance, base),
      system: instance.revitId === null ? undefined : (systems.get(instance.revitId) ?? undefined),
    };
    // Saved PSC1 predates numeric categories. Its exact English category is a visual fallback
    // only; port identity still requires the supplied domain graph. Other labels stay unknown.
    const savedEquipment =
      instance.categoryId === null && instance.category === "Mechanical Equipment";
    return (instance.revitId !== null && ids.has(instance.revitId)) ||
      instance.categoryId === EQUIPMENT_CATEGORY_ID ||
      savedEquipment
      ? { ...paint, surface: "shell" }
      : paint;
  };
}

const point3 = (p: readonly number[] | null | undefined): p is readonly number[] =>
  p?.length === 3 && p.every(Number.isFinite);

/** Union explicit references in either direction. Spatial coincidence never admits a port. */
export function equipmentPorts(
  graph: DuctGraph,
  meshes: SceneMeshes,
  paint: PaintOf,
): SurfacePort[] {
  const byId = new Map(
    meshes.instances
      .filter((i) => i.revitId !== null && i.linkInstanceId === null)
      .map((i) => [i.revitId!, i]),
  );
  const equipment = new Map(
    graph.nodes.filter((node) => node.kind === "equipment").map((node) => [node.id, node]),
  );
  type Ref = { elementId: number; connector: number };
  const incoming = new Map<string, Ref[]>();
  const elements = new Map([...graph.nodes, ...graph.segments].map((e) => [e.id, e]));
  for (const e of elements.values()) {
    if (equipment.has(e.id)) continue;
    for (const c of e.connectors) {
      if (!c.connectedTo || !equipment.has(c.connectedTo.elementId)) continue;
      const key = `${c.connectedTo.elementId}:${c.connectedTo.connector}`;
      const refs = incoming.get(key) ?? [];
      refs.push({ elementId: e.id, connector: c.index });
      incoming.set(key, refs);
    }
  }
  return [...equipment.values()].flatMap((node) => {
    const owner = byId.get(node.id);
    if (!owner || resolvePaint(owner, paint).tier === "context") return [];
    return node.connectors.flatMap((c): SurfacePort[] => {
      const refs = new Map(
        [
          ...(c.connectedTo ? [c.connectedTo] : []),
          ...(incoming.get(`${node.id}:${c.index}`) ?? []),
        ].map((ref) => [`${ref.elementId}:${ref.connector}`, ref]),
      );
      return [...refs.values()].flatMap((ref): SurfacePort[] => {
        const route = byId.get(ref.elementId);
        if (
          !route ||
          equipment.has(ref.elementId) ||
          !point3(c.point) ||
          !point3(c.facing) ||
          Math.hypot(...c.facing) < 1e-8
        )
          return [];
        const routePaint = resolvePaint(route, paint);
        if (routePaint.tier === "context" || routePaint.surface === "shell") return [];
        const width = c.shape === "round" ? c.diameterIn : c.widthIn;
        const height = c.shape === "round" ? c.diameterIn : c.heightIn;
        return [
          {
            key: `${node.id}:${c.index}>${ref.elementId}:${ref.connector}`,
            owner: owner.key,
            route: route.key,
            at: c.point,
            facing: c.facing,
            widthAxis: point3(c.widthAxis) ? c.widthAxis : null,
            shape: c.shape,
            widthFt: width != null && Number.isFinite(width) ? Math.max(0, width / 12) : 0,
            heightFt: height != null && Number.isFinite(height) ? Math.max(0, height / 12) : 0,
            paint: routePaint,
          },
        ];
      });
    });
  });
}
