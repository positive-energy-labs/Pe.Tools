import { CONTEXT_CREASE_DEG, paintOf, type Look } from "./grounds";
import type { Paint, PaintOf, SceneMeshes } from "./types";

/** Only these values can change prepared geometry or its render-pass partition. */
type SceneStructure = Pick<Paint, "tier">;
export type ScenePlan = {
  meshes: SceneMeshes;
  roles: readonly SceneStructure[];
  angles: (number | null)[];
  semantics: string;
  shellAngle: number;
  routeAngle: number;
};
export function scenePlan(meshes: SceneMeshes, of: PaintOf | undefined, look: Look): ScenePlan {
  const roles = meshes.instances.map((i) => {
    return { tier: paintOf(i, of).tier };
  });
  const angles = roles.map((p) =>
    p.tier === "context"
      ? CONTEXT_CREASE_DEG
      : p.tier === "envelope"
        ? look.shell.edgeAngle
        : p.tier === "subject"
          ? look.routes.edgeAngle
          : null,
  );
  return {
    meshes,
    roles,
    angles,
    semantics: JSON.stringify([roles, angles, look.shell.edgeAngle, look.routes.edgeAngle]),
    shellAngle: look.shell.edgeAngle,
    routeAngle: look.routes.edgeAngle,
  };
}
export function samePlan(a: ScenePlan | undefined, b: ScenePlan): boolean {
  return a?.meshes === b.meshes && a.semantics === b.semantics;
}
/** The accepted structural plan wins over a presentation callback from a newer request. */
export function planPaint(plan: ScenePlan, appearance: PaintOf | undefined): PaintOf {
  const index = new Map(plan.meshes.instances.map((instance, i) => [instance.key, i]));
  return (instance) => {
    const i = index.get(instance.key);
    if (i === undefined) return undefined;
    return { ...appearance?.(instance), ...plan.roles[i]! };
  };
}
