/**
 * `/family`'s stages, declared once: which verbs each stage's row draws, the chords they bind,
 * and which panes it shows. The entity view draws from this, never beside it.
 */
import type { EntityAction, EntityReading, EntityStage } from "#/route/manifest";
import type { PaneDecl, StageDecl } from "#/route/stage";
import type { FamilyAction, FamilyReadingKey } from "./manifest";

type R = FamilyReadingKey | EntityReading;
type A = FamilyAction | EntityAction;
type Pane = "family" | "spec";

// The family's read writes the draft's reading into Work, so it is the hidden `read` verb.
const family: PaneDecl<R, A> = {
  draws: ["family", "profile", "receipts"],
  verbs: ["stage", "unstage", "accept", "deny"],
  reads: "read",
};
const spec: PaneDecl<R, A> = { draws: ["pods"], verbs: ["save"] };

// No chords: the read has no button (ruling 37), and build and apply are two presses each.
export const FAMILY_STAGES: Readonly<Record<EntityStage, StageDecl<R, A, Pane>>> = {
  audit: { verbs: ["capture"], keys: {}, panes: { family } },
  apply: { verbs: ["apply", "build"], keys: {}, panes: { family, spec } },
  archived: { verbs: [], keys: {}, meter: false, panes: { family } },
};
