import * as THREE from "three";
import { SCENE_PRESETS } from "@pe/agent-contracts";
import { bool, choice, colour, defineKnobs, num, set } from "#/knobs/knobs";
import { inkOf } from "./ink";
import type { IssueState, LayerFrame, Paint, PaintOf, SceneInstance } from "./types";

export const WHITE = Object.freeze(new THREE.Color(1, 1, 1));
export const BLACK = Object.freeze(new THREE.Color(0, 0, 0));
/** Keep the context ceiling representably translucent after upload to a float32 uniform. */
export const CONTEXT_OPACITY_LIMIT = 0.95;
/** Mask colours encode channels, not visible hues. */
export const OUTLINE_CHANNEL = {
  selected: new THREE.Color(1, 0, 0),
  lit: new THREE.Color(0, 1, 0),
  hover: new THREE.Color(0, 0, 1),
} as const;
export const GROUND_MATERIAL = {
  color: WHITE,
  transparent: true,
  depthTest: true,
  depthWrite: false,
  forceSinglePass: true,
};

/**
 * Categorical system inks, cycled by a stable hash of the paint key. The one table to replace with
 * Revit view-template colours (a `#rrggbb` per slot; a kit token role resolves per theme).
 */
const SYSTEM_PALETTE = ["viz-1", "viz-2", "viz-3", "viz-4", "viz-5", "viz-6"] as const;

/**
 * The scene's look, one typed spec: every default a judgment call is here, and each is a dev knob
 * (`#/knobs`). A colour of "theme" is derived below from kit tokens; a role name is that token.
 * Starting rationale lives in the design-system ledger; real-model tuning remains re-openable.
 */
export const LOOK = defineKnobs("scene", "ts/apps/web/src/scene/grounds.ts", {
  subject: {
    colour: colour("Subject ink", "theme"),
    // X-ray is this value lowered: it also caps the stub opacity (was depth.everythingTranslucent).
    opacity: num("Subject opacity", 0.98, [0.05, 1, 0.01]),
    bySystem: bool("Colour by system", true),
    stubOpacity: num("Stub opacity", 0.16, [0.05, 1, 0.01]),
    stubGroundMix: num("Stub mix toward ground", 0.45, [0, 1, 0.01]),
    stubEndAlpha: num("Stub fade floor × opacity", 0.06, [0, 1, 0.01]),
    darkLift: num("Dark-stage colour lift", 0.16, [0, 0.3, 0.01]),
  },
  depth: {
    rim: num("Duct rim contrast", 0.18, [0, 0.8, 0.01]),
    // One rule for selected, lit, hover and damage: behind real subject geometry, a highlight
    // keeps its hue at this alpha and width, constant however many layers are in front.
    occludedAlpha: num("Occluded highlight alpha", 0.35, [0, 1, 0.01]),
    occludedWidth: num("Occluded highlight width ×", 0.6, [0.2, 1, 0.05]),
  },
  shell: {
    colour: colour("Envelope ink", "ink-2"),
    opacity: num("Envelope fill", 0.4, [0.001, 0.4, 0.001]),
    edgeOpacity: num("Envelope outline alpha", 0.08, [0, 1, 0.01]),
    edgeWidth: num("Envelope outline width", 1.1, [0, 4, 0.1], "live", "px"),
    edgeAngle: num("Envelope crease angle", 35, [1, 90, 1], "live", "deg"),
  },
  ports: {
    width: num("Port stroke", 2, [0.5, 6, 0.25], "live", "px"),
    opacity: num("Port alpha", 0.95, [0, 1, 0.01]),
    stubOpacity: num("Stub port alpha", 0.65, [0, 1, 0.01]),
    tickFt: num("Port facing tick", 0.3, [0, 2, 0.05], "live", "ft"),
    minRadiusFt: num("Minimum port radius", 0.12, [0.01, 1, 0.01], "live", "ft"),
    roundSegments: num("Round port segments", 16, [8, 32, 1]),
  },
  routes: {
    lightnessStep: num("Same-type lightness separation", 0.55, [0, 0.9, 0.01]),
    edgeWidth: num("Route edge width", 1, [0, 4, 0.25], "live", "px"),
    edgeOpacity: num("Route edge alpha", 0.4, [0, 1, 0.05]),
    hiddenWidth: num("Occluded route width", 1.5, [0, 4, 0.25], "live", "px"),
    hiddenOpacity: num("Occluded route alpha", 0.85, [0, 1, 0.05]),
    edgeAngle: num("Route crease angle", 35, [1, 90, 1], "live", "deg"),
    dashFt: num("Occluded route dash", 0.3, [0.05, 2, 0.05], "live", "ft"),
    gapFt: num("Occluded route gap", 0.2, [0.05, 2, 0.05], "live", "ft"),
  },
  camera: {
    yaw: num("Starting bearing", 225, [0, 360, 5], "live", "deg"),
    elev: num("Starting elevation", 32, [5, 85, 1], "live", "deg"),
    frameFill: num("Subject frame fill", 0.82, [0.3, 0.95, 0.01]),
    zoomOutFactor: num("Zoom-out × subject diagonal", 2, [1, 5, 0.1]),
    panMargin: num("Pan margin × subject diagonal", 0.25, [0, 1, 0.05]),
    returnMs: num("Camera return", 380, [100, 1000, 10], "live", "ms"),
    wiggleDeg: num("Wiggle cone radius", 6, [1, 15, 0.5], "live", "deg"),
    wiggleMs: num("Wiggle loop", 1200, [500, 3000, 50], "live", "ms"),
    wiggleLoops: num("Wiggle loops", 2, [1, 4, 1]),
  },
  palette: Object.fromEntries(
    SYSTEM_PALETTE.map((role, i) => [`s${i + 1}`, colour(`System ink ${i + 1}`, role)]),
  ),
  fill: {
    hover: num("Hover ink mix", 0.22, [0, 1, 0.01]),
    lit: num("Lit ink mix", 0.4, [0, 1, 0.01]),
    selected: num("Selected ink mix", 0.6, [0, 1, 0.01]),
  },
  veil: {
    colour: colour("Context ink", "theme"),
    themeGroundMix: num("Context mix toward ground", 0, [0, 1, 0.01]),
    nearFt: num("Full within", 0, [0, 20, 0.25], "live", "ft"),
    curve: num("Curve exponent", 4, [0.25, 8, 0.05]),
    maxOpacity: num("Opacity at subject", 0.23, [0.01, CONTEXT_OPACITY_LIMIT, 0.01]),
    interior: num("Context face fill", 0.67, [0, 1, 0.01]),
    silhouettePower: num("Context silhouette exponent", 3, [0.5, 12, 0.5]),
    // The reach (veil far = stub fade) is the page's Nearby radius, else VEIL_DEFAULT_REACH_FT.
    minOpacity: num("Opacity at reach edge", 0.004, [0, CONTEXT_OPACITY_LIMIT, 0.001]),
    desaturate: num("Desaturate far", 0, [0, 1, 0.01]),
    fog: num("Fog to ground far", 0, [0, 1, 0.01]),
    brightness: num("Brightness near ducts", 0, [0, 1, 0.01]),
    // A/B for kaitpw (2026-10-26): only the nearest context surface per pixel, no stacking.
    singleLayer: bool("Single-layer context", false),
  },
  lights: {
    sky: colour("Hemisphere sky", "#fff8ee"),
    floor: colour("Hemisphere floor", "#403a30"),
    sun: colour("Sun", "#fffaf2"),
    hemisphere: num("Hemisphere intensity", 1.15, [0, 4, 0.05]),
    sunIntensity: num("Sun intensity", 1.55, [0, 4, 0.05]),
  },
  outline: {
    selected: num("Selected width", 2.5, [0, 8, 0.25], "live", "px"),
    lit: num("Lit width", 2, [0, 8, 0.25], "live", "px"),
    hover: num("Hover width", 1.5, [0, 8, 0.25], "live", "px"),
    casing: num("Casing", 1.25, [0, 6, 0.25], "live", "px"),
  },
  glow: {
    strength: num("Damage halo strength", 2.6, [0, 8, 0.1]),
    spread: num("Damage halo spread", 1, [0.25, 4, 0.05]),
  },
  marks: {
    restCasing: num("Rest casing alpha", 0.35, [0, 1, 0.01]),
    restVolume: num("Rest volume alpha", 0.28, [0, 1, 0.01]),
    reachCasing: num("Reach casing alpha", 0.5, [0, 1, 0.01]),
    reachVolume: num("Reach volume alpha", 0.4, [0, 1, 0.01]),
    hoverCasing: num("Hover casing alpha", 0.7, [0, 1, 0.01]),
    hoverVolume: num("Hover volume alpha", 0.55, [0, 1, 0.01]),
    focusCasing: num("Focus casing alpha", 0.75, [0, 1, 0.01]),
    focusVolume: num("Focus volume alpha", 0.6, [0, 1, 0.01]),
  },
  damage: {
    colour: colour("Damage ink", "alarm"),
    alpha: num("Damage skin alpha", 0.85, [0, 1, 0.01]),
  },
  layers: {
    preset: choice("Picture preset preview", "page", ["page", ...SCENE_PRESETS]),
    context: choice("Context preset", "all", ["all", "walls", "structural", "none"]),
    lighting: bool("Lighting fixtures", true),
    // TODO: Filter capture by stable category IDs; these controls only filter drawn context.
    hiddenCategories: set("Hidden context categories"),
  },
  section: {
    paddingFt: num("Section padding", 3, [0, 30, 0.25], "live", "ft"),
    cap: choice("Cut faces", "solid", ["solid", "open"]),
  },
  captions: {
    charPx: num("Caption glyph advance", 7, [5, 12, 0.25], "live", "px"),
    rowPx: num("Caption line height", 16, [12, 28, 1], "live", "px"),
    gapPx: num("Caption clearance", 6, [0, 24, 1], "live", "px"),
    leaderPx: num("Continuation leader reach", 52, [12, 160, 2], "live", "px"),
    leaderMaxPx: num("Continuation leader search", 208, [52, 416, 4], "live", "px"),
    markPx: num("Continuation end mark", 7, [3, 16, 1], "live", "px"),
  },
});
export type Look = ReturnType<typeof LOOK.read>;

export const markAlpha = (
  state: IssueState,
  look = LOOK.read(),
): readonly [casing: number, volume: number] => {
  const m = look.marks;
  return [m[`${state}Casing`], m[`${state}Volume`]];
};
export const damageAlpha = (look = LOOK.read()) => look.damage.alpha;

/** Without a `paintOf`: the captured focus is the subject, everything else context. */
export const paintOf = (instance: SceneInstance, of?: PaintOf): Paint =>
  of?.(instance) ?? { tier: instance.focus ? "subject" : "context" };
export const isLit = (at: LayerFrame) =>
  !!at.selected || !!at.lit || at.state === "hover" || at.state === "focus";

/** FNV-1a: the same key draws the same ink in every capture and session. */
export const keySlot = (key: string, slots: number) => {
  let h = 0x811c9dc5;
  for (let i = 0; i < key.length; i++) h = Math.imul(h ^ key.charCodeAt(i), 0x01000193);
  return (h >>> 0) % slots;
};

/** `#rrggbb` as is; any other word but "theme" is a kit token role. */
const inkOr = (value: string, mount: Element, theme: () => THREE.Color) =>
  /^#[\da-f]{6}$/i.test(value)
    ? new THREE.Color(value)
    : value === "theme"
      ? theme()
      : inkOf(value, mount);

/** Read the stage tokens once per theme or look, shared by its clear colour, veil and fog. */
export function sceneGrounds(mount: Element, look: Look) {
  const ground = inkOf("artifact", mount),
    ink = inkOf("ink", mount);
  const subject = inkOr(look.subject.colour, mount, () => {
    const mix = inkOf("ink-mute", mount).lerp(inkOf("ink-2", mount), 0.55);
    return ground.getHSL({ h: 0, s: 0, l: 0 }).l > 0.5 ? mix.lerp(ground, 0.35) : mix;
  });
  return {
    ground,
    ink,
    subject,
    shell: inkOr(look.shell.colour, mount, () => inkOf("ink-2", mount)),
    context: inkOr(look.veil.colour, mount, () =>
      inkOf("ink-mute", mount).lerp(ground, look.veil.themeGroundMix).offsetHSL(0, -1, 0),
    ),
    palette: Object.values(look.palette).map((value) => inkOr(value, mount, () => subject.clone())),
    damage: inkOr(look.damage.colour, mount, () => inkOf("alarm", mount)),
    lights: {
      sky: inkOr(look.lights.sky, mount, () => WHITE.clone()),
      floor: inkOr(look.lights.floor, mount, () => WHITE.clone()),
      sun: inkOr(look.lights.sun, mount, () => WHITE.clone()),
    },
  };
}
