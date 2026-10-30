/**
 * Consent tiers (ducts MAP, protoui round 1): every gap on a fan sheet sits at one tier.
 * `taken`: the engine closed it silently (an auto-join within the candidate box, a firm default
 * with provenance). `accept`: a ruling the person confirms (a default to take, a join ruling, a
 * slot choice). `preview`: a Revit geometry write, previewed as ghost geometry, then consented.
 * One-click calc is "every gap at taken or accepted": a count going to zero, not a stage sequence.
 */
import type { DuctsSheetOverview, DuctsSheetResponse, SheetNote } from "@pe/agent-contracts";
import { verdictInk } from "@pe/kit/table/cells";

export type Tier = "taken" | "accept" | "preview";
export const TIERS: readonly Tier[] = ["taken", "accept", "preview"];

type Compact = DuctsSheetOverview["blockers"][number];
type Detailed = Extract<DuctsSheetResponse, { kind: "inputs" }>["blockers"][number];
/** A blocker as the page holds it: the overview's compact row, filled in once inputs detail lands. */
export type SheetBlocker = Detailed;

type Closer =
  | Pick<Compact, "closer" | "kind" | "proposal">
  | Pick<Detailed, "closer" | "kind" | "proposal">;
export const closerKind = (blocker: Pick<Closer, "closer">) =>
  typeof blocker.closer === "string" ? blocker.closer : blocker.closer.kind;

/** The join or heal pair a closer would rule on: the engine's proposal, else the detail's candidate. */
export const healPair = (blocker: Closer): [string, string] | null =>
  blocker.proposal?.pair ??
  (typeof blocker.closer === "string" ? null : (blocker.closer.candidate?.pair ?? null));

/**
 * The tier of one blocker. A `heal` closer is a Revit geometry write, so `preview`. An open end
 * is `preview` only while it has a heal candidate (a proposal or the detail's candidate); with
 * nothing to heal it is `accept`: the person rules it capped on the page (R-CAP, 2026-10-28),
 * never "take default" (protoui round 2 ruling, 2026-10-28). A `default`
 * closer is a default the person has not taken yet, so it is `accept`: the contract never lists
 * a blocker the engine already closed (a firm default with provenance is applied, not blocked;
 * see `takenClosures`).
 */
export function tierOf(blocker: Closer): Tier {
  if (blocker.kind === "open-end") return healPair(blocker) ? "preview" : "accept";
  switch (closerKind(blocker)) {
    case "heal":
      return "preview";
    case "ruling":
    case "default":
      return "accept";
  }
}

/**
 * R-B (kaitpw 2026-10-28): a blocker that exists only because of an assumed heal cites that
 * heal's open-end blocker as `causedBy`; it is a consequence, nested under its cause, with no
 * verb and no tier of its own. An orphan (its cause is not on the page) stands as its own row.
 */
export function isConsequence(
  blocker: Pick<Compact, "causedBy">,
  present: ReadonlySet<string>,
): boolean {
  return blocker.causedBy != null && present.has(blocker.causedBy);
}
export const presentIds = (blockers: readonly Pick<Compact, "id">[]) =>
  new Set(blockers.map((b) => b.id));

/** Blocker count by tier; every tier is present so a zero reads as zero. Consequences do not count. */
export function tierCounts(blockers: readonly (Compact | Detailed)[]): Record<Tier, number> {
  const counts: Record<Tier, number> = { taken: 0, accept: 0, preview: 0 };
  const present = presentIds(blockers);
  for (const blocker of blockers)
    if (!isConsequence(blocker, present)) counts[tierOf(blocker)] += 1;
  return counts;
}

/** The closures the engine took silently, as the inputs detail's notes record them: each is one `taken`. */
export function takenClosures(notes: readonly SheetNote[]): string[] {
  return notes.filter((n) => n.kind === "auto-join").map((n) => n.text);
}

/** A tier's ink through the three-state verdict tones the claim pins already wear. */
const TIER_TONE: Record<Tier, Parameters<typeof verdictInk>[0]> = {
  taken: "done",
  accept: "caution",
  preview: "alarm",
};
export const tierInk = (tier: Tier) => verdictInk(TIER_TONE[tier]);
export const tierTone = (tier: Tier) => TIER_TONE[tier];

/** The detailed row for an overview blocker before inputs detail lands. */
export function detailOf(blocker: Compact): Detailed {
  return {
    ...blocker,
    detail: "Read blocker details to see the explanation",
    closer: { kind: blocker.closer, note: "" },
  };
}
