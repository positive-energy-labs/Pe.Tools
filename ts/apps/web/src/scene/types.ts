import type { ReachRung } from "@pe/kit/lang/reach";
/**
 * The one 3D renderer's vocabulary: what it draws (`SceneMeshes`), what an answer adds on top
 * (`Layer3D`), and what the pointer is over (`Pick`). Coordinates are host internal feet, z up.
 */
import type * as THREE from "three";

/** Axis-aligned bounds in host internal feet. */
export type Bounds = {
  minX: number;
  minY: number;
  minZ: number;
  maxX: number;
  maxY: number;
  maxZ: number;
};

/** One drawn element: its address in Revit and its range in `SceneMeshes.positions`. */
export type SceneInstance = {
  /** Stable across captures: `[documentKey, linkInstanceId, uniqueId]` as JSON. */
  key: string;
  /** The host-document element id the element menu can act on; null for a linked element. */
  revitId: number | null;
  documentKey: string;
  linkInstanceId: number | null;
  uniqueId: string;
  category: string;
  /** The element the capture was asked for, as opposed to context around it. */
  focus: boolean;
  /** Batch range, in vertices (three per triangle, unindexed). */
  firstVertex: number;
  vertexCount: number;
};

/** How the picture treats one instance. Default (no paintOf): focus → subject, else context. */
export type Tier = "subject" | "stub" | "context";
/** `key` groups instances that share a colour, e.g. a Revit system name. */
export type Paint = { readonly tier: Tier; readonly key?: string };
export type PaintOf = (instance: SceneInstance) => Paint | undefined;

/** A decoded scene: unindexed triangle positions plus one range per element. */
export class SceneMeshes {
  // FOOTGUN: React's development prop inspector enumerates public geometry on each update.
  #positions: Float32Array;
  #instances: readonly SceneInstance[];
  constructor(
    positions: Float32Array,
    readonly bounds: Bounds,
    instances: readonly SceneInstance[],
  ) {
    this.#positions = positions;
    this.#instances = instances;
  }
  get positions(): Float32Array {
    return this.#positions;
  }
  get instances(): readonly SceneInstance[] {
    return this.#instances;
  }
}

/** An answer drawn over the scene in its own group, keyed so it is cheap to add and remove.
 * `build` draws in world coordinates (host feet); the group is disposed when the key leaves or
 * the layer object is replaced. */
export type IssueTarget = { key: string; elementId: number };
/** Where an issue mark stands, weakest first: the pointer within reach (about 24 px), over it, or
 * the issue open (picked here or in the inbox). */
export type IssueState = ReachRung;
export type LayerFrame = {
  seconds: number;
  reducedMotion: boolean;
  state: IssueState;
  /** Seconds since this mark's issue became the focus; Infinity when it is not the focus. */
  landed: number;
  /** An element this mark stands on is selected: the mark yields its interior to the selection. */
  selected?: boolean;
  /** A mesh under this mark is hovered or lit by a row. */
  lit?: boolean;
};
export type Layer3D = {
  key: string;
  build(group: THREE.Group): void;
  targets?: readonly IssueTarget[];
  findings?: readonly string[];
  /** Update imperative materials (uniforms only, never React); true requests another frame. */
  frame?: (group: THREE.Group, at: LayerFrame) => boolean;
};

/** What the pointer is over: one element, and the world point the ray met it at. */
export type Pick = {
  instance: SceneInstance;
  point: [number, number, number];
};
