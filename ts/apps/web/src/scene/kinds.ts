import * as THREE from "three";
import type { Kinds } from "./types";

const entry = (kinds: Kinds, kind: string | undefined) =>
  (kind === undefined ? undefined : kinds[kind]) ?? kinds.unknown;

/** The kind's hue; an unlisted kind takes `unknown`; undefined when the table has neither. */
export function kindHue(kinds: Kinds, kind: string | undefined): THREE.Color | undefined {
  const e = entry(kinds, kind);
  return e === undefined ? undefined : new THREE.Color(typeof e === "string" ? e : e.hue);
}

/** The kind's base OKLCH lightness when its entry carries one; else the rung rule applies. */
export function kindL(kinds: Kinds, kind: string | undefined): number | undefined {
  const e = entry(kinds, kind);
  return typeof e === "object" ? e.l : undefined;
}
