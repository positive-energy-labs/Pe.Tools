// The one /runs palette — shared by the on-screen surface (browser.tsx) and the export
// compositor (feedback/composite.ts) so the PNG an agent reads matches the screen kaitpw ruled
// on. Light-mode literals: /runs pins light chrome (kaitpw ruling, promotion round 2).
//
// Underlay law, round-2 revision (kaitpw ruling, feedback round 2 2026-08-17): the checkerboard
// screening for invented closures DIED — "the dithering or whatever on the plan image is
// confusing. try another approach like simple opacity." The honesty semantics survive the new
// treatment: received ink is the only near-opaque neutral raster; invented closures paint
// continuous but TRANSLUCENT and warm-tinted. Solid dark = received/drawn; pale translucent
// tint = invented/synthetic. Volume changed, claim did not.

export const PAPER = "#fcfbf9";

// evidence (muted): received ink near-opaque neutral; invented closures translucent warm tints
export const INK_M: [number, number, number, number] = [122, 118, 114, 235];
export const SEAL_M: [number, number, number, number] = [187, 118, 108, 115];
export const CLOSE_M: [number, number, number, number] = [196, 172, 128, 110];

// decisions (rebalanced UP against the muted paper)
export const ACCEPT_STROKE = "rgb(23,98,135)";
export const ACCEPT_FILL = "rgba(35,118,158,0.12)";
export const HELD_STROKE = "#a97e16";
export const HELD_FILL = "rgba(196,150,44,0.10)";
export const VOID_STROKE = "rgba(146,142,138,0.7)";
export const VOID_FILL = "rgba(146,142,138,0.07)";
export const ZONE_STROKE = "rgb(108,52,140)";
export const MIST = "rgba(100,116,139,0.14)"; // focus-is-mist law, even on the drawing
export const LABEL = "rgba(120,113,108,0.85)";

/** The one alarm, resolved from the live tokens so exports match the screen; light-mode
 * literal when the DOM is not around. */
export function alarmColor(): string {
  if (typeof document === "undefined") return "#8e4120";
  const v = getComputedStyle(document.documentElement).getPropertyValue("--r-alarm").trim();
  return v || "#8e4120";
}

// disposition-unknown rooms: pre-column packages (SHIMS.md #3 close). Neutral warm gray —
// deliberately NOT the accepted blue; unknown must never dress as accepted, on screen OR in an
// exported PNG.
export const UNKNOWN_STROKE = "rgba(120,113,108,0.9)";
export const UNKNOWN_FILL = "rgba(120,113,108,0.08)";

/** Room tones follow the PERSISTED disposition column only. Lives here, not in browser.tsx, so
 * the export compositor cannot drift back to painting every room as accepted. */
export function roomTone(disposition: "accepted" | "held" | null): {
  stroke: string;
  fill: string;
} {
  if (disposition === "accepted") return { stroke: ACCEPT_STROKE, fill: ACCEPT_FILL };
  if (disposition === "held") return { stroke: HELD_STROKE, fill: HELD_FILL };
  return { stroke: UNKNOWN_STROKE, fill: UNKNOWN_FILL };
}
