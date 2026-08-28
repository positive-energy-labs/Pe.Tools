import law from "./visual-law.json";

type Rgba = [number, number, number, number];

export const VISUAL_LAW = law;
export const PLAN_LAW = law.substrate.plan;
export const INK_M = law.substrate.ink.rgba as Rgba;
export const SEAL_DOOR = law.invented.sealDoor as Rgba;
export const SEAL_RUN = law.invented.sealRun as Rgba;
export const CLOSE_M = law.invented.close as Rgba;
export const ZONE_STROKE = `rgba(${law.zone.stroke.rgba.join(",")})`;
export const ZONE_WIDTH = law.zone.stroke.widthPx;
// The zone boundary is the RECEIVED input the solver's output is read against, so it wears the
// shared `reference` broken line. It is deliberately not read from `law.zone.stroke.dash`: the
// visual law owns this surface's colours and widths, never a second dash-pattern authority.
const residueTreatment = (residue: typeof law.void) => ({
  fill: residue.fill,
  outline: {
    color: `rgba(${residue.outline.rgba.join(",")})`,
    widthPx: residue.outline.widthPx,
  },
  hatch: {
    angleDeg: residue.hatch.angleDeg,
    color: `rgba(${residue.hatch.rgba.join(",")})`,
    spacingPx: residue.hatch.spacingPx,
    widthPx: residue.hatch.widthPx,
  },
});

export const RESIDUE_TREATMENT = {
  void: residueTreatment(law.void),
  excluded: residueTreatment(law.excluded),
};
export type ResidueKind = keyof typeof RESIDUE_TREATMENT;
export const LABEL = `rgba(${law.label.rgba.join(",")})`;
export const LABEL_SIZE = law.label.sizePx;
export const HELD_HATCH = law.candidate.status.held.hatch;

function hash(value: string): number {
  let result = 2166136261;
  for (let i = 0; i < value.length; i++) result = Math.imul(result ^ value.charCodeAt(i), 16777619);
  return result >>> 0;
}

/** Stable saturated candidate color. The golden-angle step keeps consecutive candidate ids apart. */
export function candidateTone(zone: string, candidateId: string): { fill: string; dark: string } {
  const ordinal = Number(candidateId.match(/\d+/)?.[0] ?? hash(candidateId));
  const hue = ((hash(zone) % 360) + ordinal * 137.508) % 360;
  return {
    fill: `hsl(${hue} 82% 48% / ${law.candidate.fill.alpha})`,
    dark: `hsl(${hue} 82% 28%)`,
  };
}
