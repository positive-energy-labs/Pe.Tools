/**
 * `/families`' stages, declared once: which verbs each stage's row draws, the chords they bind,
 * and which panes it shows. The entity view draws from this, never beside it.
 */
import type { EntityAction, EntityReading, EntityStage } from "#/route/manifest";
import type { PaneDecl, StageDecl } from "#/route/stage";
import type { FamiliesReadingKey } from "./manifest";

type R = FamiliesReadingKey | EntityReading;
type A = "scope" | "save-draft" | EntityAction;
type Pane = "matrix" | "spec";

// The matrix is a one-shot read (no Reading of its own); it draws the inventory and receipts.
const matrix: PaneDecl<R, A> = {
  draws: ["inventory", "receipts"],
  verbs: ["stage", "unstage", "accept", "deny"],
};
const spec: PaneDecl<R, A> = { draws: ["pods"], verbs: ["save"] };

// Apply is the plan sheet's one button, never the row's.
const across: readonly A[] = ["capture", "plan"];
const keys = {} as const;

export const FAMILIES_STAGES: Readonly<Record<EntityStage, StageDecl<R, A, Pane>>> = {
  audit: { verbs: ["scope", "save-draft", ...across], keys, panes: { matrix } },
  capture: { verbs: across, keys, panes: { matrix, spec } },
  apply: { verbs: across, keys, panes: { matrix, spec } },
};
