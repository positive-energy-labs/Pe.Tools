/**
 * Layout is data (ADR 0035 rule 5). A pane declares the kind of body it draws, and `draw` returns
 * the matching branded `Body`: the brand is the only way to make one, so a drawing cannot hand the
 * kernel a bare element, and the kernel never guesses whether a pane scrolls.
 *
 * - `scroll`: the pane owns one scroll track; the body lays out at its natural height.
 * - `fill`: the body fills the pane and owns its own scrolling (a picture, a virtual list, a
 *   transcript); the pane clips.
 *
 * So a surface's scroll tracks are a count over its declaration, measured before any render:
 * /pea is two (threads, chat) and the dock is one (the tools pane). The `frame` knobs this replaces
 * (`header: false`, `refresh: false`, `scroll: "clip"`) are deleted in the fill, not kept beside it.
 *
 * Scaffold (slice 6, seam a): the kernel does not read the brand yet; `typed-shell.tsx` and
 * `route-panes.tsx` still draw `Pane` furniture by hand.
 */
import type { ReactNode } from "react";

export type BodyKind = "scroll" | "fill";

declare const bodyBrand: unique symbol;
export type Body<K extends BodyKind = BodyKind> = {
  readonly [bodyBrand]: K;
  readonly kind: K;
  readonly node: ReactNode;
};
export type ScrollBody = Body<"scroll">;
export type FillBody = Body<"fill">;

const body = <K extends BodyKind>(kind: K, node: ReactNode): Body<K> =>
  ({ kind, node }) as Body<K>;
/** The pane scrolls this body. */
export const scrollBody = (node: ReactNode): ScrollBody => body("scroll", node);
/** This body fills the pane and scrolls itself. */
export const fillBody = (node: ReactNode): FillBody => body("fill", node);

export const isBody = (value: unknown): value is Body =>
  typeof value === "object" &&
  value !== null &&
  "kind" in value &&
  "node" in value &&
  ((value as Body).kind === "scroll" || (value as Body).kind === "fill");

/** A pane's declared body kind; a pane with none declared is the gap this slice closes. */
export type PaneBodyDecl = { readonly body?: BodyKind };

/** The instrument: how many scroll tracks a surface's declaration says it has. */
export const scrollTracks = (panes: Readonly<Record<string, PaneBodyDecl>>) =>
  Object.values(panes).filter((pane) => pane.body === "scroll").length;
