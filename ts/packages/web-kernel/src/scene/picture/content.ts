import type { ReactNode } from "react";
import type { Members, SubjectKey } from "@pe/kit/lang/attention";
import type { Chord } from "@pe/kit/keys";
import type { PicturePage } from "@pe/agent-contracts";
import type { ColourMode, IssueTarget, Kinds, Layer3D, PaintOf, SceneMeshes } from "../types";
import type { Project, Size } from "../projection";

/** A drawn subject's centreline in world feet, where it sits before (or without) its meshes. One
 * point is a point subject (a fitting); two or more are a line the globe draws. */
export type PictureLine = { key: SubjectKey; points: readonly (readonly number[])[] };
/** One ordered path through the picture's elements: a terminal run, a home run, a circuit. Strands
 * that share an element ride side by side through it, and `path` order is the flow direction. */
export type PictureStrand = {
  /** The strand's own subject (`run:<id>`): a pick on its line selects it, a row lights it. */
  key: SubjectKey;
  /** Element keys in flow order; each needs a centreline in `lines`. */
  path: readonly SubjectKey[];
  /** The governing strand (the critical run): drawn heavy and always flowing. */
  heavy?: boolean;
};
/** What a surface's overlay draws against: the released frame, never a mid-gesture one. */
export type PictureOverlayFrame = {
  /** World feet to overlay px, with the shown section applied. */
  project: Project;
  /** The same camera without the section: what occludes on screen. */
  camera: Project;
  size: Size;
  meshes: SceneMeshes | null;
  paintOf: PaintOf | undefined;
  /** The picture's selection (widened), as element ids. */
  selected: ReadonlySet<number>;
  /** The picture's pick and frame (double-click) verbs. */
  pick: (id: number, at: { x: number; y: number }) => void;
  frame: (id: number) => void;
};
/** A surface's 3D marks. `toggle` names the page layer that gates it; absent = always drawn. */
export type PictureLayer = {
  key: string;
  toggle?: string;
  draw: (ctx: { meshes: SceneMeshes | null; paintOf: PaintOf | undefined }) => readonly Layer3D[];
};

/** Everything a surface says about its picture. Numeric ids stop at the renderer adapter. */
export interface PictureContent<L extends string = string, F extends string = string> {
  /** What is captured, as ElementIds: the capture request is addressed by them and they are payload, never identity. `walked` draws as ink, `near` joins the capture as stubs. Never implies reach. */
  focus: { walked: readonly number[]; near: readonly number[] };
  /** Group subjects (issue:, run:, leg:, system:) to their element keys; the core registers them. */
  members?: Members;
  /** Reverse hover: a hovered element also lights the smallest declared group this admits.
   * Absent = the single element. */
  hoverGroups?: (group: SubjectKey) => boolean;
  /** A picked element's selection, widened (E: its leg). Absent = the single element. */
  widen?: (key: SubjectKey) => readonly SubjectKey[];
  /** Capture limits and clipping; `meshes` substitutes a dev fixture for the capture. */
  capture?: { maxTriangles?: number; cuts?: SceneMeshes["cuts"]; meshes?: SceneMeshes | null };
  /** Centrelines: bounds before meshes arrive, the jump fallback, and the globe's lines. */
  lines: readonly PictureLine[];
  /** Ordered paths drawn over the centrelines, side by side where they share an element. The
   * heavy strand and any lit or selected strand animate their flow; the rest hold still. */
  strands?: readonly PictureStrand[];
  /** Subjects over a limit: the only alarm ink (look rule 2026-10-26). Absent = nothing alarms. */
  over?: ReadonlySet<SubjectKey>;
  /** A subject's name as the surface's rows read it. */
  name: (key: SubjectKey) => string;
  paint?: (meshes: SceneMeshes | null) => PaintOf | undefined;
  kinds: Kinds;
  colour: ColourMode;
  layers?: readonly PictureLayer[];
  /** The layer strip, in order; `off` layers are not in the picture's default set. Context is the pose's `context`, never a layer. */
  layerOptions: readonly LayerOption<L>[];
  /** DOM drawn over the picture at the released frame. */
  overlay?: (frame: PictureOverlayFrame) => ReactNode;
  readout: {
    /** What the picture is of (a system name). */
    subject?: string;
    /** The idle line and body, while nothing is picked. */
    summary: ReactNode;
    idle?: ReactNode;
    /** The picked element's facts. */
    facts?: (key: SubjectKey) => ReactNode;
  };
  /** A second, flat picture (a schematic, a plan): its key is the page's `picture` value; `S`
   * swaps it with the model and the other sits in the corner. Absent = model only. */
  flat?: {
    key: F;
    label: string;
    says?: string;
    render: (size: "main" | "inset", readout?: ReactNode) => ReactNode;
  };
  /** The go-to popup; `jump` selects and flies to a subject with a landing. */
  goTo?: (jump: (key: SubjectKey) => void) => ReactNode;
  furniture?: { title?: ReactNode; actions?: ReactNode; legend?: ReactNode };
  /** Replaces the default issue pick (select its element and the issue). */
  onIssuePick?: (target: IssueTarget) => void;
  /** Told of every pick and clear, before the page moves. */
  onPick?: (key: SubjectKey | null) => void;
}

export type LayerOption<L extends string = string> = {
  key: L;
  label: string;
  chord?: Chord;
  says?: string;
  off?: true;
};

/** The layer keys on: the page's list, or the options' default set. */
export const layersOn = <L extends string>(
  layers: PicturePage["layers"],
  options: readonly LayerOption<L>[],
): L[] =>
  options.filter((o) => (layers === "default" ? !o.off : layers.includes(o.key))).map((o) => o.key);
