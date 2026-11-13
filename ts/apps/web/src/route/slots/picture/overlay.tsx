import { createElement, lazy, type ComponentType, type ReactNode, type RefObject } from "react";
import { DrawingBoundary } from "../../draw";
import type { PictureScope } from "@pe/agent-contracts/slots";
import type { SubjectKey } from "@pe/kit/lang/attention";
import type { LayerOption, PictureContent } from "#/scene/picture/picture";

/*
 * The picture slot's one declared overlay hook (ADR 0035 rules 1 and 2; owner ruling 2026-11-11). The
 * closed marks cover a ring, an outline, a bar, a volume and a label on a subject. What a route
 * draws beyond them (ordered strands, domain skins, a rich readout, a legend, a flat picture) it
 * hands the kernel pane here as parts of the kernel `Picture`'s content. The kernel still owns the
 * pane, the pose, the selection, the capture and its focus, the marks and the findings.
 */

/** The kernel `Picture`'s content, minus what the kernel owns: the scope's focus and the layer for findings. */
export type PictureParts = Omit<PictureContent, "focus" | "layerOptions"> & {
  /** ElementIds the capture takes beyond the scope (context stubs, a drawn neighbour): payload, never identity. */
  focus?: { readonly walked?: readonly number[]; readonly near?: readonly number[] };
  /** The layer strip; absent, the kernel's own (meshes and findings). */
  layerOptions?: readonly LayerOption[];
  /** The read the geometry follows when it is not the pane's own read: its model revision, and whether it is current. */
  source?: { readonly version: string; readonly current: boolean };
  /** What a retained read is labelled with; absent, the route's name. */
  label?: string;
  /** Filled by the picture: a row elsewhere selects and flies to a subject. */
  jump?: RefObject<((key: SubjectKey) => void) | null>;
};

export interface PictureOverlayProps<C> {
  readonly ctx: C;
  /** The scope the kernel resolved from the slot. */
  readonly scope: PictureScope;
  /** Draws the kernel picture with these parts. An overlay that has nothing to draw returns its own sentence instead. */
  picture(parts: PictureParts): ReactNode;
}

type Context<P> = P extends (props: PictureOverlayProps<infer C>) => ReactNode ? C : never;

/** Loads the overlay with the picture, as `draw` loads a pane body: the route module stays DOM-free for host admission. */
export function overlay<M, K extends keyof M>(load: () => Promise<M>, name: K & (Context<M[K]> extends never ? never : K)) {
  const Component = lazy(() =>
    load().then((module) => ({ default: module[name] as ComponentType<PictureOverlayProps<Context<M[K]>>> })),
  );
  return (props: PictureOverlayProps<Context<M[K]>>): ReactNode =>
    createElement(DrawingBoundary, null, createElement(Component, props));
}
