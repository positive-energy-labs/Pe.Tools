import * as THREE from "three";
import { inkOf } from "./ink";
import type { Bounds, IssueState, LayerFrame } from "./types";

export const WHITE = new THREE.Color(1, 1, 1);
export const BLACK = new THREE.Color(0, 0, 0);
export const LIGHT = { sky: 0xfff8ee, floor: 0x403a30, sun: 0xfffaf2 };
/** Mask colours encode channels, not visible hues. */
export const OUTLINE_CHANNEL = {
  selected: new THREE.Color(1, 0, 0),
  lit: new THREE.Color(0, 1, 0),
  hover: new THREE.Color(0, 0, 1),
} as const;
export const FILL = { hover: 0.22, lit: 0.4, selected: 0.6 };
export const MARK_ALPHA: Record<IssueState, readonly [casing: number, volume: number]> = {
  rest: [0.35, 0.28],
  reach: [0.5, 0.4],
  hover: [0.7, 0.55],
  focus: [0.75, 0.6],
};
export const DAMAGE_ALPHA = 0.85;
export const GROUND_MATERIAL = {
  color: WHITE,
  transparent: true,
  depthTest: true,
  depthWrite: true,
  forceSinglePass: true,
};
export const groundOf = (focus: boolean, lit = false) => (focus || lit ? "subject" : "context");
export const isLit = (at: LayerFrame) =>
  !!at.selected || !!at.lit || at.state === "hover" || at.state === "focus";

/** Read the stage token once per theme, shared by its clear colour and fog. */
export function sceneGrounds(mount: Element) {
  const ground = inkOf("artifact", mount),
    ink = inkOf("ink", mount);
  const subject = inkOf("ink-mute", mount).lerp(inkOf("ink-2", mount), 0.55);
  if (ground.getHSL({ h: 0, s: 0, l: 0 }).l > 0.5) subject.lerp(ground, 0.35);
  return {
    ground,
    ink,
    subject: { color: subject, opacity: 1 },
    context: {
      color: inkOf("ink-mute", mount).lerp(ground, 0.65).offsetHSL(0, -1, 0),
      opacity: 0.18,
    },
  };
}

/** Exponential squared falloff is invariant under a uniform change of model units/size. */
export const fogDensity = (b: Bounds) =>
  0.45 / Math.max(Math.hypot(b.maxX - b.minX, b.maxY - b.minY, b.maxZ - b.minZ), 1e-6);
