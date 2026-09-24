/**
 * `/families`' stages, declared once: which verbs each stage's row draws, the chords they bind,
 * and which panes it shows. The entity view draws from this, never beside it.
 */
import type { EntityAction, EntityReading, EntityPage } from "#/route/manifest";
import type { PaneDecl, StageDecl } from "#/route/stage";
import type { FamiliesReadingKey } from "./manifest";

type R = FamiliesReadingKey | EntityReading;
type A = "read" | "save-draft" | EntityAction;
type Pane = "matrix" | "spec";

// The matrix is a one-shot read (no Reading of its own); it draws the inventory and receipts.
const matrix: PaneDecl<R, A> = {
  draws: ["inventory", "receipts"],
  verbs: ["stage", "unstage", "accept", "deny"],
};
const spec: PaneDecl<R, A> = { draws: ["pods"], verbs: ["save"] };

const keys = { read: "R" } as const;

export const FAMILIES_STAGES: Readonly<Record<EntityPage["stage"], StageDecl<R, A, Pane>>> = {
  audit: { verbs: ["read", "capture"], keys, panes: { matrix } },
  apply: { verbs: ["apply", "save-draft"], keys, panes: { matrix, spec } },
  archived: {
    verbs: [],
    keys,
    meter: false,
    panes: { matrix: { draws: ["inventory", "receipts"], verbs: [] } },
  },
};
