/**
 * DESIGN-SYSTEM FIXTURES — the mocked worlds the index and its satellites render.
 *
 * WHY THIS FILE EXISTS AND WHAT IT IS NOT: `/design-system` catalogues real components. It has
 * no host, no session, no document — so the DATA is mocked and every surface that renders it
 * says so with a dashed-seam `FactChip` (the dashed border style is reserved for exactly this
 * meaning). This requirement closes only if a satellite is ever promoted to a real route.
 *
 * PROVENANCE: the rows are the design-lang round's shared fixture (`design-lang/proto/world.ts`),
 * copied rather than imported ON PURPOSE — the proto folds to its snapshot branch at the close of
 * the round, and the exhibit must not be its last consumer. Values are deliberately realistic
 * (long strings, real units, one 108-character comment) because the round measured that
 * placeholder rectangles produce verdicts that do not survive contact with real density.
 *
 * The rows carry the crucibles the round asked for and nothing else:
 *   · proposed + drift on one cell (`connectedLoad`) — two marks at once, the composition the
 *     precedence order asserts and no fixture had ever forced.
 *   · staged by YOU and staged by PEA on two cells — the square's colour is the only difference,
 *     which is the one thing the state model still cannot supply: staging has no author. Here it
 *     is a fixture field; in production it is inferred from the wrong fact.
 *   · every capability refusal that renders differently: readonly · excluded · nohome.
 *   · a value long enough to prove the footline clamp and the no-icons-in-cells ruling.
 */
import type { StateCellProps } from "#/components/lang/cell";

/* ── 1 · the parameter table ────────────────────────────────────────────────────────────── */

export interface ParamRow {
  key: string;
  param: string;
  /** Type-level or instance-level. A real facet — the table filters on it. */
  scope: "type" | "instance";
  value: string;
  /** What Revit currently holds, when it disagrees. */
  modelValue?: string;
  /** Minutes since the reading behind the value. Absent ⇒ never read. */
  ageMin?: number;
  fresh: "fresh" | "stale" | "unverified" | "never";
  agree: "agree" | "drift";
  stage: "clean" | "proposed" | "staged";
  stagedBy?: "pea" | "you";
  cap: "editable" | "readonly" | "excluded" | "nohome";
  capReason?: string;
  grounding?: { doc: string; page: number };
  confidence?: "high" | "low";
  note?: string;
}

export const PARAM_ROWS: readonly ParamRow[] = [
  {
    key: "bodyWidth",
    param: "Body Width",
    scope: "type",
    value: "24 in",
    ageMin: 2,
    fresh: "fresh",
    agree: "agree",
    stage: "clean",
    cap: "editable",
  },
  {
    key: "fireRating",
    param: "Fire Rating",
    scope: "type",
    value: "2 hr",
    ageMin: 2,
    fresh: "fresh",
    agree: "agree",
    stage: "proposed",
    cap: "editable",
    confidence: "high",
    note: "matches the UL listing on the submittal",
    grounding: { doc: "Overhead Door 421 submittal.pdf", page: 4 },
  },
  {
    key: "sillHeight",
    param: "Sill Height",
    scope: "instance",
    value: "36 in",
    ageMin: 0,
    fresh: "fresh",
    agree: "agree",
    stage: "staged",
    stagedBy: "you",
    cap: "editable",
  },
  {
    key: "operatorType",
    param: "Operator Type",
    scope: "type",
    value: "Motor — FDCL-611",
    ageMin: 0,
    fresh: "fresh",
    agree: "agree",
    stage: "staged",
    stagedBy: "pea",
    cap: "editable",
    note: "accepted from pea's card, not yet written",
  },
  {
    key: "headHeight",
    param: "Head Height",
    scope: "instance",
    value: "84 in",
    ageMin: 2,
    fresh: "fresh",
    agree: "agree",
    stage: "clean",
    cap: "readonly",
    capReason: "driven by formula: Sill Height + Rough Opening",
  },
  {
    key: "frameDepth",
    param: "Frame Depth",
    scope: "type",
    value: "5.5 in",
    ageMin: 41,
    fresh: "stale",
    agree: "agree",
    stage: "clean",
    cap: "editable",
  },
  {
    key: "roughWidth",
    param: "Rough Width",
    scope: "instance",
    value: "26 in",
    fresh: "unverified",
    agree: "agree",
    stage: "clean",
    cap: "editable",
  },
  {
    /* The NEVER rung (ruled 2026-08-16 R2): nothing was ever attempted here — no reading, no
       value. Distinct from `unverified` (a value exists, never checked). Draws no squiggle. */
    key: "panelColor",
    param: "Panel Color",
    scope: "type",
    value: "—",
    fresh: "never",
    agree: "agree",
    stage: "clean",
    cap: "editable",
  },
  {
    key: "panelThickness",
    param: "Panel Thickness",
    scope: "type",
    value: "1.75 in",
    modelValue: "1.375 in",
    ageMin: 1,
    fresh: "fresh",
    agree: "drift",
    stage: "clean",
    cap: "editable",
  },
  {
    key: "assemblyCode",
    param: "Assembly Code",
    scope: "type",
    value: "B2010.10",
    ageMin: 2,
    fresh: "fresh",
    agree: "agree",
    stage: "clean",
    cap: "readonly",
    capReason: "Revit forbids writing this parameter",
  },
  {
    key: "typeComments",
    param: "Type Comments",
    scope: "type",
    value:
      "Coordinate rough opening with structural embed plate; verify clearances at head track before release.",
    ageMin: 12,
    fresh: "fresh",
    agree: "agree",
    stage: "clean",
    cap: "editable",
    grounding: { doc: "RFI-217 response.pdf", page: 2 },
  },
  {
    key: "mark",
    param: "Mark",
    scope: "instance",
    value: "—",
    ageMin: 2,
    fresh: "fresh",
    agree: "agree",
    stage: "clean",
    cap: "excluded",
    capReason: "parameter dropped by Revit: not bound to this category",
  },
  {
    key: "zoneArea",
    param: "Zone Area",
    scope: "instance",
    value: "412 sf",
    fresh: "fresh",
    agree: "agree",
    stage: "clean",
    cap: "nohome",
    capReason: "demo data — no real element behind it",
  },
  {
    /* THE CRUCIBLE the round never forced: pea proposes a value AND the model disagrees with what
       is shown. Precedence says the proposal owns the body and drift owns the squiggle slot; this
       row is the only proof that assertion has. */
    key: "connectedLoad",
    param: "Connected Load",
    scope: "type",
    value: "150 VA",
    modelValue: "100 VA",
    ageMin: 2,
    fresh: "fresh",
    agree: "drift",
    stage: "proposed",
    cap: "editable",
    confidence: "low",
    note: "inferred from motor schedule; Revit disagrees — two marks at once",
  },
];

/**
 * ParamRow → `StateCell` props. ONE reader, used by the index table, the key and both satellites,
 * so no surface can render the same row as a different cell.
 */
export function cellProps(row: ParamRow): StateCellProps {
  return {
    value: row.value,
    modelValue: row.modelValue,
    fresh: row.fresh,
    agree: row.agree,
    stage: row.stage,
    stagedBy: row.stagedBy,
    cap: row.cap,
    capReason: row.capReason,
    grounding: row.grounding,
    confidence: row.confidence,
    note: row.note,
  };
}

/** "2 min" / "41 min" / "never" — the freshness column's machine-measured text. */
export function ageText(row: ParamRow): string {
  if (row.ageMin === undefined) return "never";
  return row.ageMin === 0 ? "just now" : `${row.ageMin} min`;
}

/* ── 2 · the proposal-flow world ────────────────────────────────────────────────────────── */
/* ONE array behind two scales: pea's chat card and a StateCell table read the same objects, so
   accepting in the card moves the value in the table. That IS the property that won round 1 —
   one cell grammar everywhere — and it is only provable when the two share a world. */

export interface ProposalItem {
  key: string;
  param: string;
  /** What the document holds today. `null` ⇒ the parameter is empty. */
  current: string | null;
  /** What pea wants it to be. */
  proposed: string;
  confidence: "high" | "low";
  note?: string;
  grounding?: { doc: string; page: number };
  /** Set when Revit disagrees with `current` — drift travels independently of the proposal. */
  modelValue?: string;
  /** Review state. `open` = pea proposes · `accepted` = staged by pea · `denied` = struck. */
  review: "open" | "accepted" | "denied";
}

export const PROPOSAL_THREAD: readonly { who: "you" | "pea"; text: string }[] = [
  {
    who: "you",
    text: "fill in the fire ratings and electrical on the coiling door family from the submittal I attached",
  },
  {
    who: "pea",
    text: "Read the submittal (14 pages). I can ground 3 of the 4 values in it; the connected load is inferred from the motor schedule, so check that one — and Revit already disagrees with the load on record.",
  },
];

export const PROPOSAL_SEED: readonly ProposalItem[] = [
  {
    key: "fireRating",
    param: "Fire Rating",
    current: null,
    proposed: "2 hr",
    confidence: "high",
    note: "UL listing on the submittal",
    grounding: { doc: "Overhead Door 421 submittal.pdf", page: 4 },
    review: "open",
  },
  {
    key: "operatorType",
    param: "Operator Type",
    current: "Manual",
    proposed: "Motor — FDCL-611",
    confidence: "high",
    note: "spec section 08 33 23",
    review: "accepted",
  },
  {
    /* the two-marks crucible, one scale up: an open proposal on a value the model also disputes. */
    key: "connectedLoad",
    param: "Connected Load",
    current: "100 VA",
    proposed: "150 VA",
    confidence: "low",
    note: "inferred from the motor schedule, not stated directly",
    modelValue: "100 VA",
    review: "open",
  },
  {
    key: "voltage",
    param: "Voltage",
    current: null,
    proposed: "115 V",
    confidence: "high",
    review: "denied",
  },
];

export const PROPOSAL_TARGET = "Overhead Coiling Door 421";

/* ── 3 · the arming world ───────────────────────────────────────────────────────────────── */

export const ARMING_FIXTURE = {
  verb: "apply to Revit",
  target: "Overhead Coiling Door 421 · 3 types",
  count: 42,
  planHash: "a91f#c04",
  freshPlanHash: "b02e#118",
  reasonExample: "backfill fire ratings from approved submittal, per RFI-217",
  refusal:
    "refused — the model moved since this plan was made (plan a91f#c04, model now b02e#118). Nothing was written. Re-plan to continue.",
} as const;

/* ── 4 · the popover harness specimens' option lists ────────────────────────────────────── */
/* Long enough to overflow, and with one label long enough to force the popup wider than its
   anchor — which is where clamp behaviour stops being theoretical. */

export const CATEGORY_OPTIONS: readonly { value: string; label: string; description?: string }[] = [
  { value: "doors", label: "Doors", description: "OST_Doors" },
  { value: "windows", label: "Windows", description: "OST_Windows" },
  { value: "walls", label: "Walls", description: "OST_Walls" },
  { value: "curtain-panels", label: "Curtain Panels", description: "OST_CurtainWallPanels" },
  {
    value: "mech-equipment",
    label: "Mechanical Equipment",
    description: "OST_MechanicalEquipment",
  },
  { value: "duct-fittings", label: "Duct Fittings", description: "OST_DuctFitting" },
  { value: "pipe-accessories", label: "Pipe Accessories", description: "OST_PipeAccessory" },
  { value: "generic-models", label: "Generic Models", description: "OST_GenericModel" },
  {
    value: "specialty-equipment",
    label: "Specialty Equipment — Overhead Coiling Door 421 assembly",
    description: "OST_SpecialityEquipment",
  },
];
