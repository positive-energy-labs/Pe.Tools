import * as THREE from "three";
import { bool, colour, defineKnobs, num, set } from "#/knobs/knobs";
import { inkOf } from "./ink";
import type { Bounds, IssueState, LayerFrame, Paint, PaintOf, SceneInstance } from "./types";

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
 * M1: these guess until kaitpw tunes them on real use.
 */
export const LOOK = defineKnobs("scene", "ts/apps/web/src/scene/grounds.ts", {
  subject: {
    colour: colour("Subject ink", "theme"),
    opacity: num("Subject opacity", 0.85, [0.05, 0.99, 0.01]),
    bySystem: bool("Colour by system", true),
    stubOpacity: num("Stub opacity", 0.45, [0.05, 1, 0.01]),
  },
  depth: {
    everythingTranslucent: bool("Everything translucent", false),
    translucentOpacity: num("Translucent duct opacity", 0.45, [0.05, 0.99, 0.01]),
    rim: num("Duct rim contrast", 0.18, [0, 0.8, 0.01]),
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
    themeGroundMix: num("Context mix toward ground", 0.25, [0, 1, 0.01]),
    nearFt: num("Full within (ft)", 1, [0, 20, 0.25]),
    farFt: num("Far (ft)", 14, [1, 64, 0.5]),
    curve: num("Curve exponent", 2, [0.25, 6, 0.05]),
    maxOpacity: num("Opacity at subject", 0.4, [0.01, CONTEXT_OPACITY_LIMIT, 0.01]),
    minOpacity: num("Opacity far", 0.12, [0.01, CONTEXT_OPACITY_LIMIT, 0.01]),
    desaturate: num("Desaturate far", 1, [0, 1, 0.01]),
    fog: num("Fog to ground far", 0, [0, 1, 0.01]),
    brightness: num("Brightness near ducts", 0, [0, 1, 0.01]),
  },
  fog: {
    depth: bool("Camera-depth fog", false),
    density: num("Depth fog × diagonal", 0.45, [0, 3, 0.05]),
  },
  lights: {
    sky: colour("Hemisphere sky", "#fff8ee"),
    floor: colour("Hemisphere floor", "#403a30"),
    sun: colour("Sun", "#fffaf2"),
    hemisphere: num("Hemisphere intensity", 1.15, [0, 4, 0.05]),
    sunIntensity: num("Sun intensity", 1.55, [0, 4, 0.05]),
  },
  outline: {
    selected: num("Selected width (px)", 2.5, [0, 8, 0.25]),
    lit: num("Lit width (px)", 2, [0, 8, 0.25]),
    hover: num("Hover width (px)", 1.25, [0, 8, 0.25]),
    casing: num("Casing (px)", 1.5, [0, 6, 0.25]),
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
    colour: colour("Damage ink", "#d32f2f"),
    alpha: num("Damage skin alpha", 0.85, [0, 1, 0.01]),
  },
  layers: {
    // ponytail: hides drawn instances only; the capture still fetches them. Owed: a fetch-side
    // category filter on `revit.detail.space-scene`.
    hiddenCategories: set("Hidden categories"),
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

/** Exponential squared falloff is invariant under a uniform change of model units/size. */
export const fogDensity = (b: Bounds, k = LOOK.defaults.fog.density) =>
  k / Math.max(Math.hypot(b.maxX - b.minX, b.maxY - b.minY, b.maxZ - b.minZ), 1e-6);
