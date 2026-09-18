/**
 * The one draft an entity route's audit holds as Work: what Revit said (`reading`), what Pea or a
 * person proposes on top (`edits`, told apart by `by`), and what a person accepted (`accepted`,
 * off every agent mask). Save, plan and apply read the reading with the accepts laid on it.
 * `/family` holds its reading here; `/families` reads its matrix live and keeps only the proposals.
 */
import { z } from "zod";

import type { RouteStateSpec } from "./route-state.ts";

/** The proposal half every draft shares, over one route's proposal address and value. */
export const draftProposals = <P extends z.ZodType>(proposal: P) => ({
  /** Standing proposals, one per address (agent-writable). */
  edits: z.array(proposal).default([]),
  /**
   * What a person accepted, value and author as accepted (human-only). It carries the value, so a
   * proposal changed after its accept stands as a counter-proposal instead of riding the approval.
   */
  accepted: z.array(proposal).default([]),
});

/** A proposed edit to one field of a family spec, by JSON pointer: set a value, or delete it. */
export const familyProposalSchema = z.object({
  pointer: z.string(),
  value: z.unknown().optional(),
  delete: z.literal(true).optional(),
  by: z.enum(["pea", "human"]),
});
export type FamilyProposal = z.infer<typeof familyProposalSchema>;

/**
 * `/family`'s Work: the live family's spec as `family.capture` read it (or a saved member opened
 * into the draft), and the proposals on it. No pod is needed to hold one; a pod appears at save.
 */
export const familyDraftSchema = z.object({
  /** The spec JSON text the draft started from; null until the family is read. */
  reading: z.string().nullable().default(null),
  ...draftProposals(familyProposalSchema),
});
export type FamilyDraft = z.infer<typeof familyDraftSchema>;

export const familyDraftRouteState = {
  route: "family",
  title: "Family",
  description:
    "The live family's spec draft: the reading family.capture returned, proposals on its fields by JSON pointer, and a person's accepts. Save files it as a member; plan and apply take it.",
  schema: familyDraftSchema,
  // Pea proposes; the reading comes from Revit and the accepts from a person.
  agentWriteMask: [["edits"]],
  commands: {},
} satisfies RouteStateSpec<typeof familyDraftSchema>;
