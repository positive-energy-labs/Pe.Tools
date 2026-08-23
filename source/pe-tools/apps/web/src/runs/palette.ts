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
export const ZONE_DASH = law.zone.stroke.dash.join(" ");
export const VOID_OUTLINE = `rgba(${law.void.outline.rgba.join(",")})`;
export const VOID_HATCH = law.void.hatch;
export const EXCLUDED_OUTLINE = `rgba(${law.excluded.outline.rgba.join(",")})`;
export const EXCLUDED_HATCH = law.excluded.hatch;

// COMPILE BRIDGE - delete with the v1.3 outline+hatch round.
// Law v1.3 sets `fill: null` for void and excluded: they are outline + hatch now, because a
// solid wash cannot be both legible on a 1 ft sliver and transparent on a 2,579 sf blob
// (Lower Level#03 rendered opaque and hid 85% of its own zone). The viewer still paints a
// solid, so until it draws the real treatment these derive a MUCH weaker fill from the hatch
// colour - excluded drops alpha 110 -> 68 - so the plan stays visible in the meantime.
// Consumers to migrate: browser.tsx (ZonePanel, plan dock, legend), feedback/composite.ts.
const bridgeFill = (hatch: { rgba: number[] }) =>
  `rgba(${hatch.rgba[0]},${hatch.rgba[1]},${hatch.rgba[2]},${Math.round(hatch.rgba[3] * 0.4)})`;
export const VOID_FILL = bridgeFill(law.void.hatch);
export const EXCLUDED_FILL = bridgeFill(law.excluded.hatch);
export const LABEL = `rgba(${law.label.rgba.join(",")})`;
export const LABEL_SIZE = law.label.sizePx;
export const HELD_HATCH = law.candidate.status.held.hatch;

export const PAPER = "#fff";
export const MIST = "rgba(100,116,139,0.14)";

export function alarmColor(): string {
  if (typeof document === "undefined") return "#8e4120";
  return (
    getComputedStyle(document.documentElement).getPropertyValue("--r-alarm").trim() || "#8e4120"
  );
}

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
