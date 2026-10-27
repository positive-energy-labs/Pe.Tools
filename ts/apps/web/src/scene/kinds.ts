import * as THREE from "three";
import type { Kinds } from "./types";

/** The kind's hue; an unlisted kind takes `unknown`; undefined when the table has neither. */
export function kindHue(kinds: Kinds, kind: string | undefined): THREE.Color | undefined {
  const hex = (kind === undefined ? undefined : kinds[kind]) ?? kinds.unknown;
  return hex === undefined ? undefined : new THREE.Color(hex);
}
