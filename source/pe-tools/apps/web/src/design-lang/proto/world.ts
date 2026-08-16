/**
 * PROTOTYPE — the shared fixture for the design-language round, base 2. Throwaway.
 *
 * READ-ONLY for variant builders: every variant renders THIS data. A variant that seeds its
 * own mock data compares data instead of language — we did that once and the round was weaker
 * for it. Where this fixture is silent on something a variant needs, that is a FINDING about
 * the state model: comment it in the variant file, do not edit this one.
 *
 * The data is drawn from real call sites: the /family matrix states, the trichotomy reviewer
 * payload shape (workbench/trichotomy-reviewer.tsx), families' plan-hash drift refusal, and
 * the verb census in docs/design/DESIGN-LANG-HANDOFF.md. Values are deliberately realistic —
 * long strings and real units — because placeholder rectangles produced verdicts that did not
 * survive contact with real density.
 */

/* ── 1 · the table slice ────────────────────────────────────────────────────── */

export interface CellFixture {
  param: string;
  value: string;
  /** Set when the shown value differs from what Revit currently holds (agree = "drift"). */
  modelValue?: string;
  origin: "model" | "user" | "agent" | "formula" | "document" | "fixture";
  fresh: "fresh" | "stale" | "unverified";
  /** Minutes since last read; only meaningful when fresh is not "unverified". */
  ageMin?: number;
  agree: "agree" | "drift";
  stage: "clean" | "proposed" | "staged";
  cap: "editable" | "readonly" | "excluded" | "nohome";
  /** Why the cell refuses edits; present exactly when cap is not "editable". */
  capReason?: string;
  /** Grounding citation — a fact about where the number came from, independent of proposal. */
  grounding?: { doc: string; page: number };
  confidence?: "high" | "low";
  note?: string;
}

export const TABLE_ROWS: readonly CellFixture[] = [
  {
    param: "Body Width",
    value: "24 in",
    origin: "model",
    fresh: "fresh",
    ageMin: 2,
    agree: "agree",
    stage: "clean",
    cap: "editable",
  },
  {
    param: "Fire Rating",
    value: "2 hr",
    origin: "agent",
    fresh: "fresh",
    ageMin: 2,
    agree: "agree",
    stage: "proposed",
    cap: "editable",
    confidence: "high",
    note: "matches the UL listing on the submittal",
    grounding: { doc: "Overhead Door 421 submittal.pdf", page: 4 },
  },
  {
    param: "Sill Height",
    value: "36 in",
    origin: "user",
    fresh: "fresh",
    ageMin: 0,
    agree: "agree",
    stage: "staged",
    cap: "editable",
  },
  {
    param: "Head Height",
    value: "84 in",
    origin: "formula",
    fresh: "fresh",
    ageMin: 2,
    agree: "agree",
    stage: "clean",
    cap: "readonly",
    capReason: "driven by formula: Sill Height + Rough Opening",
  },
  {
    param: "Frame Depth",
    value: "5.5 in",
    origin: "model",
    fresh: "stale",
    ageMin: 41,
    agree: "agree",
    stage: "clean",
    cap: "editable",
  },
  {
    param: "Rough Width",
    value: "26 in",
    origin: "model",
    fresh: "unverified",
    agree: "agree",
    stage: "clean",
    cap: "editable",
  },
  {
    param: "Panel Thickness",
    value: "1.75 in",
    modelValue: "1.375 in",
    origin: "model",
    fresh: "fresh",
    ageMin: 1,
    agree: "drift",
    stage: "clean",
    cap: "editable",
  },
  {
    param: "Assembly Code",
    value: "B2010.10",
    origin: "model",
    fresh: "fresh",
    ageMin: 2,
    agree: "agree",
    stage: "clean",
    cap: "readonly",
    capReason: "Revit forbids writing this parameter",
  },
  {
    param: "Type Comments",
    value:
      "Coordinate rough opening with structural embed plate; verify clearances at head track before release.",
    origin: "document",
    fresh: "fresh",
    ageMin: 12,
    agree: "agree",
    stage: "clean",
    cap: "editable",
    grounding: { doc: "RFI-217 response.pdf", page: 2 },
  },
  {
    param: "Mark",
    value: "—",
    origin: "model",
    fresh: "fresh",
    ageMin: 2,
    agree: "agree",
    stage: "clean",
    cap: "excluded",
    capReason: "parameter dropped by Revit: not bound to this category",
  },
  {
    param: "Zone Area",
    value: "412 sf",
    origin: "fixture",
    fresh: "fresh",
    agree: "agree",
    stage: "clean",
    cap: "nohome",
    capReason: "demo data — no real element behind it",
  },
  {
    param: "Connected Load",
    value: "150 VA",
    modelValue: "100 VA",
    origin: "agent",
    fresh: "fresh",
    ageMin: 2,
    agree: "drift",
    stage: "proposed",
    cap: "editable",
    confidence: "low",
    note: "inferred from motor schedule; Revit disagrees — two marks at once",
  },
];

/* ── 2 · the chat proposal card ─────────────────────────────────────────────── */
/* Shape mirrors what CellTrichotomyReviewer actually receives: a batch of per-cell
   proposals with confidence/notes, a summary line, approve/deny/undo per row, and one
   human-only commit. The card INLINES IN A CHAT THREAD — it must read as pea's voice
   inside a conversation, not as a table that wandered into a sidebar. */

export interface ChatMessage {
  who: "user" | "pea";
  text: string;
}

export interface ProposalCardCell {
  key: string;
  label: string;
  current: string | null;
  proposed: string;
  confidence: "high" | "low";
  note?: string;
  /** Review state a variant must be able to render: fresh proposal, already staged, denied. */
  state: "open" | "staged" | "denied";
}

export const CHAT_THREAD: readonly ChatMessage[] = [
  {
    who: "user",
    text: "fill in the fire ratings and electrical on the coiling door family from the submittal I attached",
  },
  {
    who: "pea",
    text: "Read the submittal (14 pages). I can ground 3 of the 4 values in it; the connected load is inferred from the motor schedule, so check that one.",
  },
];

export interface ProposalCard {
  family: string;
  cells: readonly ProposalCardCell[];
  /** Counts the summary line renders — derived, never stored, per SURFACE-PHILOSOPHY §1. */
  summary: { open: number; staged: number; attention: number };
  commitLabel: string;
}

export const PROPOSAL_CARD: ProposalCard = {
  family: "Overhead Coiling Door 421",
  cells: [
    {
      key: "fireRating",
      label: "Fire Rating",
      current: null,
      proposed: "2 hr",
      confidence: "high",
      note: "UL listing, submittal p.4",
      state: "open",
    },
    {
      key: "operatorType",
      label: "Operator Type",
      current: "Manual",
      proposed: "Motor — FDCL-611",
      confidence: "high",
      note: "spec section 08 33 23",
      state: "staged",
    },
    {
      key: "connectedLoad",
      label: "Connected Load",
      current: "100 VA",
      proposed: "150 VA",
      confidence: "low",
      note: "inferred from motor schedule, not stated directly",
      state: "open",
    },
    {
      key: "voltage",
      label: "Voltage",
      current: null,
      proposed: "115 V",
      confidence: "high",
      state: "denied",
    },
  ],
  summary: { open: 2, staged: 1, attention: 1 },
  commitLabel: "Save 1 to profile",
};

/* ── 3 · verbs, the arming strip, outcomes ──────────────────────────────────── */

export type VerbEffect =
  | "nav:back"
  | "nav:forward"
  | "nav:out"
  | "page"
  | "read"
  | "stage"
  | "write:doc"
  | "write:model"
  | "write:external"
  | "agent";

export interface VerbFixture {
  label: string;
  effect: VerbEffect;
  /** The real call site this stands in for. */
  from: string;
  /** Present when the verb is refused; per-option refusal with its own reason. */
  disabledReason?: string;
}

export const VERBS: readonly VerbFixture[] = [
  { label: "all types", effect: "nav:back", from: "family.tsx" },
  { label: "open family", effect: "nav:forward", from: "families.tsx" },
  { label: "open in RHVAC", effect: "nav:out", from: "atlas.tsx:636" },
  { label: "collapse", effect: "page", from: "atlas.tsx" },
  { label: "refresh", effect: "read", from: "atlas.tsx:644" },
  { label: "accept", effect: "stage", from: "matrix.tsx" },
  { label: "save profile", effect: "write:doc", from: "family.tsx:1049" },
  {
    label: "apply to Revit",
    effect: "write:model",
    from: "family.tsx:1049 — same control today",
  },
  {
    label: "sync to .r10",
    effect: "write:external",
    from: "takeoffs.tsx:790",
    disabledReason: "no .r10 target bound — bind one in the sentence first",
  },
  { label: "ask pea", effect: "agent", from: "composer.tsx" },
];

/** The arming strip for a write:model commit — the ceremony clause NO surface has built yet
 *  (SURFACE-PHILOSOPHY §3: reason supplied before it arms, explicit identity, plan hash,
 *  drift refusal, per-item receipt). Variants render the strip in its ARMED state. */
export const ARMING = {
  verb: "apply to Revit",
  target: "Overhead Coiling Door 421 · 3 types",
  count: 42,
  planHash: "a91f#c04",
  reasonPlaceholder: "why this write is happening — required before the verb arms",
  reasonExample: "backfill fire ratings from approved submittal, per RFI-217",
  driftRefusal:
    "refused — the model moved since this plan was made (plan a91f#c04, model now b02e#118). Re-plan to continue.",
} as const;

export interface OutcomeFixture {
  label: string;
  kind: "busy" | "receipt" | "refused" | "dropped" | "advisory" | "partial" | "error";
  says: string;
}

export const OUTCOMES: readonly OutcomeFixture[] = [
  { label: "applying… 3s", kind: "busy", says: "in flight" },
  { label: "42 parameters written", kind: "receipt", says: "it landed" },
  {
    label: "refused · plan hash drift",
    kind: "refused",
    says: "declined before touching anything",
  },
  {
    label: "discarded — write already in flight",
    kind: "dropped",
    says: "invisible in production today",
  },
  { label: "2 types would be skipped", kind: "advisory", says: "a dry run, nothing blocked" },
  {
    label: "38 of 42 written · 4 staged",
    kind: "partial",
    says: "the failures stay staged for retry",
  },
  { label: "bridge busy", kind: "error", says: "one of 7 host issue kinds" },
];

/* ── 4 · the addressing sentence ────────────────────────────────────────────── */

export const SENTENCE = {
  /** Nouns only — scope/filter state never rides in the sentence. */
  nouns: [
    { label: "Hoffman Estates 214", kind: "document" },
    { label: "Overhead Coiling Door 421", kind: "entity" },
    { label: "live model", kind: "world" },
  ],
  /** Chips narrow but never hide; each is individually removable. */
  chips: [
    { label: "needs a person", count: 3 },
    { label: "type: FDCL-611", count: 1 },
  ],
  /** A commit's receipt may replace the sentence briefly, then relax back to the nouns. */
  receipt: "42 parameters written · 2:41 pm",
} as const;
