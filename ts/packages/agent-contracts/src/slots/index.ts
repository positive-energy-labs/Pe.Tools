/*
 * ADR 0035 rule 1: a route declaration has five slots, `subject`, `sheet`, `picture`, `goal` and
 * `layout`, plus `query` for route-owned fields no slot holds and `title(ctx)` for the pane head.
 * Findings, pointers, the Timeline and consent are implicit kernel modules with nothing to declare.
 * Only the kernel adds a slot, a binding kind, a key kind or a mark kind. The web's typed `route()`
 * (`apps/web/src/route/typed-route.ts`) carries these on its Specification; this is the shared
 * contract a Pod decodes at the boundary (rule 4).
 */
export * from "./sheet.ts";
export * from "./goal.ts";
export * from "./picture.ts";
export * from "./findings.ts";

export const SLOTS = ["subject", "sheet", "picture", "goal", "layout"] as const;
export type Slot = (typeof SLOTS)[number];
