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
export const VOID_FILL = `rgba(${law.voidWash.rgba.join(",")})`;
export const EXCLUDED_FILL = `rgba(${law.excludedWash.rgba.join(",")})`;
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
