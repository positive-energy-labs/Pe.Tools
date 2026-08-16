/**
 * PROTOTYPE — throwaway, round-2 converged variant of the /family clean room.
 *
 * Round 1 argued four theses; the user settled one skeleton, and this is it.
 *
 *   THE TABLE IS THE INTERFACE. One row per parameter, one column per TYPE, and the cross-type
 *   spread is never hidden — the whole point of a family is that its types disagree on purpose,
 *   and the only way to audit that is to see them side by side. Spreadsheet discipline: a cell is
 *   either editable or properly disabled WITH a reason. Nothing is greyed out mysteriously.
 *
 *   A-MODE DRILL-IN. Clicking a type's column header swaps the table pane — not the page — into
 *   variant A's aligned profile | spine | live reconciler for that one type. Esc comes back.
 *
 *   THE DOC PANE IS A SIDEBAR ON THE TABLE, like takeoff's. One pane, two modes: the OCR'd text
 *   blocks, or a stand-in for the real page camera. Proposals dock on top of it as D-style
 *   annotation cards. Hovering a grounded row lights its citation in whichever mode is showing;
 *   the citation comes from WORLD.grounding, so it survives its proposal being accepted.
 *
 *   THE ANATOMY IS A COLLAPSIBLE VISUAL PANE over the table, drawn from the profile's own
 *   parameter values. Hovering a solid lights the parameters it consumes and vice versa — one
 *   focus, two views, never two independent highlights.
 *
 * SETTLED (round 2 review): the verdict rail won, and its two competitors are gone.
 *
 *   RAIL = SCANNABLE. A narrow gutter left of every row. Blank when nothing is proposed; one
 *   pea-green dot when one proposal lands on the row; a counted chip when several do. It answers
 *   exactly one question, top to bottom, without reading a single value: WHERE do proposals live.
 *
 *   CELLS = LOCATABLE. Each proposed cell wears a small pea-green corner notch. The rail says the
 *   row is contested; the notches say WHICH cells in it are. Neither covers a value, neither
 *   changes the table's geometry, and neither carries a verdict.
 *
 *   CARDS = DECIDABLE. Accept and deny live only on the sidebar cards, next to the spec text that
 *   justifies them. Clicking a rail dot or a corner notch focuses the card(s); nothing pops over
 *   the table, so the evidence and the decision are never hidden by the affordance that reached
 *   them.
 *
 *   TYPING BEATS PROPOSING. A proposed cell is an ordinary editable cell. The moment you commit
 *   your own value into it the proposal linkage is SEVERED — no accept, no deny, the card settles
 *   to "superseded by your edit". Grounding is untouched: a citation is a fact about where a
 *   number came from, not a fact about pea.
 *
 * SETTLED (round 3, the GEOMETRY exposure pass) — THE GHOST-ROW LAW, in the user's words:
 *
 *   "Everything on a geom property that is bindable to a param should be visible in the table as
 *    a ghost row, but still editable. If it's unbound in the profile it's sorted to bottom. If it
 *    is bound, it's represented by that param. Non-bindable properties live somewhere else."
 *
 * Which resolves the one thing the table could not previously say. A family's numbers do not all
 * live in its parameters: a dimension frozen into the geometry is a number no type can differ on,
 * no schedule can read, and no formula can reach — and until now the surface showed it NOWHERE, so
 * the difference between "the bore is 3in because a parameter says so" and "the bore is 3in
 * forever" was invisible. The law puts both in the same table and distinguishes them by SHAPE:
 * bound dims are already there, wearing their parameter's row; unbound ones fall to the bottom as
 * ghosts. The bottom of the table becomes the list of numbers nothing can reach, and each ghost
 * carries exactly one verb — bind — which is its one crossing out of that condition.
 *
 * NON-BINDABLE metadata (a connector's direction, its system type, a normal) lives in the doc
 * pane's lower half instead, which is also where a PARAMETER's family-level value now lives —
 * the home round 3 owed it after the family-value column was removed.
 *
 * SETTLED (round 4) — THE CELL-STATE LAW, in the user's words:
 *
 *   "For each param value there are three dimensions, in order of importance: parameter name,
 *    family type, and proposed/grounded/live/saved (pseudo-dimension). These states are cell
 *    states or togglable overlays on the value cells — proposal as the triangle chip, grounded as
 *    underline, live as a whole-table overlay you switch (replaces staged/page-state values
 *    visually), saved/unsaved to be conveyed. Equivalently: for any column, the useful information
 *    is the diffs from the page-state/staged values to: saved profile, live params, and pea's
 *    proposed set."
 *
 * Which kills the LIVE COLUMN. A column is the second dimension — a family type — and Revit was
 * never a fourth type; it was a fourth reading of the same three. Squeezing all three of its
 * numbers into one 52px column was the tell: they were being folded because they had nowhere
 * honest to go. Now they go exactly where they belong — INTO the three cells they are readings of
 * — under an overlay you switch. The grid is parameter × type and nothing else, forever.
 *
 *   THE OVERLAY IS THE PSEUDO-DIMENSION. `draft` shows the page-state values, editable. `⇄ live`
 *   swaps every value cell to what Revit carries, read-only, clay where it differs. `⇄ saved`
 *   swaps them to what is on disk, read-only, kiln where it differs. Nothing moves: the row set,
 *   the column set, and every row height are identical in all three, so switching is a change of
 *   READING, never of place. It is page state, never the URL — an overlay is where you are
 *   looking from, not where you are.
 *
 *   THE MARKS SURVIVE THE OVERLAY. A proposal's triangle and a grounded cell's hairline underline
 *   are facts about the CELL, not about which reading is showing, so they persist across all
 *   three. Only the value swaps.
 *
 *   THE LIVE OVERLAY IS THE RECONCILE ROOM. capture-all and apply-all are dark in `draft` and lit
 *   under `⇄ live`, because a bulk crossing you cannot see the far side of is a bulk crossing made
 *   blind. Per-cell capture/apply stay in the drill-in, where the far side is already visible.
 *
 *   SAVED/UNSAVED, THE LAW'S OPEN HALF. In `draft`, a cell whose value differs from the profile on
 *   disk wears a 4px kiln dot in the BOTTOM-LEFT corner — diagonally opposite the proposal
 *   triangle, so the two marks can never collide or be confused. It says exactly what saving would
 *   write. `⇄ saved` then answers the same question the other way round: the disk's own numbers,
 *   in place, kiln where the draft would overwrite them.
 *
 * Nothing here talks to a host. Every verb rewrites page-local state, immediately and visibly.
 */
import { useEffect, useMemo, useRef, useState } from "react";

import {
  ReadCell,
  StateDot,
  TextCell,
  stateColumn,
  type StateMeta,
} from "#/components/master-table/cells";
import { MasterTable } from "#/components/master-table/master-table";
import type { Column, MasterTableState } from "#/components/master-table/model";
import { Sentence } from "#/components/sentence";
import { Chip } from "#/components/ui/chip";
import { Pane, PaneWorkspace } from "#/components/ui/pane";
import { Switcher } from "#/components/ui/switcher";
import { Verb } from "#/components/ui/verb";
import {
  WORLD,
  boundParam,
  type GeomConstituent,
  type GeomMeta,
  type ProposalVerdict,
  type ProtoLiveValue,
  type ProtoProposal,
} from "#/family/proto/world";
import { cn } from "#/lib/utils";

// ── the fixture, read once ──────────────────────────────────────────────────────────────────────

const TYPE_NAMES = Object.keys(WORLD.profile.types);
/** Where a ghost row's ONE merged literal cell is drawn: the first type column. Its neighbours are
 * suppressed, which is as close to a colspan as MasterTable can get today. */
const MERGE_ANCHOR = TYPE_NAMES[0] ?? "";
const SPEC = WORLD.spec;
const LIVE = WORLD.live;
/** ROUND 2: the grounding link table is its own field, independent of proposals. A citation is a
 * fact about where a number came from; accepting or denying pea's reading does not erase it. */
const GROUNDING: Record<string, string[]> = WORLD.grounding ?? {};
const MISSING_IN_REVIT = new Set(LIVE?.missingParams ?? []);

/** ROUND 3: the structured constituents. Their SHAPE is fixture; only their values are drafted. */
const GEOM: GeomConstituent[] = WORLD.profile.geometry ?? [];
const GEOM_BY_SLUG = new Map(GEOM.map((part) => [part.slug, part]));

/** "core-bore" + "stub.depth" → "Core Bore Stub Depth". The name a new parameter INHERITS from the
 * property it was lifted out of — a promoted literal should arrive already saying where it came
 * from, rather than making you invent a name at the exact moment you are trying to do something
 * else. It stays editable afterwards like any other name would be. */
function paramNameFor(slug: string, property: string): string {
  return [...slug.split("-"), ...property.split(".")]
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

// ── agreement vocabulary (variant A's, plus the one A did not have) ─────────────────────────────

/**
 * The verdict for ONE cell — one parameter at one type. SIX states, the same six variant A shipped.
 *
 * Round 2 briefly grew a seventh, `per-instance`, on the theory that an instance parameter's live
 * number belongs to a placed element and so cannot disagree with the family. That was wrong about
 * Revit: an instance parameter carries a per-TYPE default inside the .rfa, and in the family editor
 * it behaves like a type parameter in every way except which formulas may reference it. So its
 * live value compares against an authored default and drifts normally, and a seventh state would
 * be a category invented to excuse a fixture. The fixture was fixed instead — Airflow now authors
 * the per-type defaults the cut sheet gives, and agrees everywhere.
 */
type Agreement = "agree" | "drift" | "derived" | "only-profile" | "only-live" | "unread";

const MARK: Record<Agreement, string> = {
  agree: "=",
  drift: "≠",
  derived: "ƒ",
  "only-profile": "◀ only",
  "only-live": "only ▶",
  unread: "·",
};

const MARK_TITLE: Record<Agreement, string> = {
  agree:
    "The profile and Revit carry the same value here. Nothing to cross; both verbs would be no-ops.",
  drift:
    "DRIFT — the profile and Revit disagree at this type. Capture lets Revit win, apply lets the profile win. Doing neither leaves two truths standing.",
  derived:
    "Derived — the profile authors this as a formula, so Revit's number is an OUTPUT, not a competing value. Capturing would freeze the formula into a literal; applying would write to a read-only cell.",
  "only-profile":
    "The profile carries this parameter and the live family does not. Apply writes values, not schema — the family needs the parameter added before anything can cross.",
  "only-live":
    "Revit carries this parameter and the profile does not claim it. Capture is what adopts it into the portable document; nothing else here applies.",
  unread:
    "The last read did not report this parameter, so its live value is UNKNOWN, not absent. Silence is not agreement.",
};

const MARK_COLOR: Record<Agreement, string> = {
  agree: "var(--st-meta)",
  drift: "var(--st-drift)",
  derived: "var(--st-derived)",
  "only-profile": "var(--st-warn)",
  "only-live": "var(--st-warn)",
  unread: "var(--st-meta)",
};

/** Worst-first, so a row's one-word state is the thing it is most asking of you. */
const AGREEMENT_RANK: Agreement[] = [
  "drift",
  "only-profile",
  "only-live",
  "unread",
  "derived",
  "agree",
];

// ── draft state ─────────────────────────────────────────────────────────────────────────────────

/**
 * A proposal's fate on this page. The world's three, plus the one only the TABLE can produce:
 * `superseded` — the user typed their own value into the proposed cell, so there is nothing left
 * to accept or deny. It is deliberately NOT "denied": denying is a judgement about pea's reading,
 * superseding is the user simply having gone first. The distinction is kept local to this variant
 * rather than widened into the shared fixture type, which the other variants also read.
 */
type CellVerdict = ProposalVerdict | "superseded";

interface Draft {
  /** paramName → family-level authored value, or "= formula". */
  authored: Record<string, string>;
  /** typeName → paramName → override. Absent ⇒ that type inherits the authored value. */
  types: Record<string, Record<string, string>>;
  /** paramName → typeName → what Revit carries. */
  live: Record<string, Record<string, ProtoLiveValue>>;
  verdicts: Record<string, CellVerdict>;
  /**
   * ROUND 3 — the geometry's mutable half, keyed slug → { dims, meta }. Only VALUES live here; the
   * constituent list and each dim's dataType are fixture and never move. A dim's value is its
   * BINDING: "param:<Name>" or a literal, so binding and unbinding are the same edit as retyping a
   * literal, and the ghost rows fall straight out of it rather than being a second list to keep in
   * step.
   */
  geom: Record<string, { dims: Record<string, string>; meta: Record<string, string> }>;
  /** Parameters this page created — every one of them promoted out of a frozen literal. */
  newParams: { name: string; dataType: string; group: string }[];
  /** The profile document has changes that are not on disk. Any profile-side edit sets it. */
  dirty: boolean;
}

function initialDraft(): Draft {
  return {
    authored: Object.fromEntries(WORLD.profile.params.map((param) => [param.name, param.value])),
    types: structuredClone(WORLD.profile.types),
    live: structuredClone(LIVE?.values ?? {}),
    verdicts: {},
    geom: Object.fromEntries(
      GEOM.map((part) => [
        part.slug,
        {
          dims: Object.fromEntries(part.dims.map((dim) => [dim.property, dim.binding])),
          meta: Object.fromEntries(part.meta.map((entry) => [entry.key, entry.value])),
        },
      ]),
    ),
    newParams: [],
    dirty: WORLD.profileDirty ?? false,
  };
}

/**
 * ROUND 4 — the pseudo-dimension, as a page-state toggle.
 *
 * `draft` is the staged document you edit. The other two are READINGS of the same cells against a
 * different substrate, shown in place: they replace the value and change nothing else, which is
 * what makes flipping between them a comparison rather than a navigation.
 */
type Overlay = "draft" | "live" | "saved";

const OVERLAY_LABEL: Record<Overlay, string> = {
  draft: "draft",
  live: "⇄ live",
  saved: "⇄ saved",
};

const OVERLAY_TITLE: Record<Overlay, string> = {
  draft:
    "The staged document — the page-state values, editable, and the only overlay in which they are. Every mark you see here (proposal triangles, grounded underlines, the kiln unsaved dots) is a fact about the cell and survives the other two overlays unchanged.",
  live: "Swap every value cell to what REVIT carries, in place. Read-only: editing a live number is not a thing that exists — apply is the write path, and its bulk verbs light up in this overlay because this is the only view where you can see what you would be overwriting. Clay marks every cell where Revit disagrees with the draft; a muted dot means that parameter was not reported by the last read, which is UNKNOWN rather than absent.",
  saved:
    "Swap every value cell to what is ON DISK, in place. Read-only, because the file is not an editor. Kiln marks every cell the draft would overwrite — read it as 'what save will write', which is the question the header's dirty fact can only answer with a yes or a no.",
};

/**
 * The profile as it sits on disk. Not a second document — a SNAPSHOT of the draft taken at save,
 * kept so the page can answer "what would save write" per cell rather than only per file. Storing
 * it beside the draft rather than diffing against the fixture is what makes the answer keep working
 * after the first save.
 */
interface SavedProfile {
  authored: Record<string, string>;
  types: Record<string, Record<string, string>>;
  /** slug → property → binding, so a frozen literal's unsaved state is readable like any other. */
  geom: Record<string, Record<string, string>>;
}

function savedFrom(draft: Draft): SavedProfile {
  return {
    authored: { ...draft.authored },
    types: structuredClone(draft.types),
    geom: Object.fromEntries(
      Object.entries(draft.geom).map(([slug, part]) => [slug, { ...part.dims }]),
    ),
  };
}

/** The binding a dim carries right now — drafted if the page has touched it, fixture otherwise. */
function bindingOf(draft: Draft, slug: string, property: string): string {
  return (
    draft.geom[slug]?.dims[property] ??
    GEOM_BY_SLUG.get(slug)?.dims.find((dim) => dim.property === property)?.binding ??
    ""
  );
}

/** paramName → every constituent.property it drives. Several dims may join on one parameter, and
 * that JOIN is the fact worth surfacing: editing the row moves all of them at once. */
function consumersOf(draft: Draft): Map<string, { slug: string; property: string }[]> {
  const map = new Map<string, { slug: string; property: string }[]>();
  for (const part of GEOM) {
    for (const dim of part.dims) {
      const name = boundParam(bindingOf(draft, part.slug, dim.property));
      if (name == null) continue;
      const list = map.get(name) ?? [];
      list.push({ slug: part.slug, property: dim.property });
      map.set(name, list);
    }
  }
  return map;
}

function isFormula(value: string): boolean {
  return value.trimStart().startsWith("=");
}

/** What a type actually resolves to: its own override, else the family-level authored value. */
function effective(draft: Draft, param: string, typeName: string): string {
  return draft.types[typeName]?.[param] ?? draft.authored[param] ?? "";
}

interface PRow {
  key: string;
  name: string;
  dataType: string;
  group: string;
  isInstance: boolean;
  /**
   * "live-only" rows exist in Revit and nowhere else — they carry a LIVE cell and nothing else.
   * "ghost" rows are not parameters at all: a bindable geometry dim that no parameter drives. They
   * are ordinary rows to every law on this page (the rail, focus, search, the row tint) and
   * deliberately NOT ordinary to the eye, because a literal frozen in geometry is a different kind
   * of thing from a parameter and a surface that hid that difference would be the lie.
   */
  kind: "profile" | "live-only" | "ghost";
  /** ghost only — which constituent.property the row IS. */
  slug?: string;
  property?: string;
}

const PARAM_ROWS: PRow[] = WORLD.profile.params.map((param) => ({
  key: param.name,
  name: param.name,
  dataType: param.dataType,
  group: param.group ?? "other",
  isInstance: param.isInstance ?? false,
  kind: "profile" as const,
}));

const LIVE_ONLY_ROWS: PRow[] = (LIVE?.extraParams ?? []).map((name) => ({
  key: `live:${name}`,
  name,
  dataType: "unknown",
  group: "live only",
  isInstance: false,
  kind: "live-only" as const,
}));

/**
 * THE GHOST ROWS: every bindable dim no parameter drives, in constituent order, at the BOTTOM.
 *
 * They are derived, never stored — binding one makes it disappear from here on the next render,
 * which is the whole visible payoff of the verb. The bottom of the table is therefore always
 * exactly "the numbers in this family that nothing can reach", and it empties as you work.
 */
function ghostRows(draft: Draft): PRow[] {
  const rows: PRow[] = [];
  for (const part of GEOM) {
    for (const dim of part.dims) {
      if (boundParam(bindingOf(draft, part.slug, dim.property)) != null) continue;
      rows.push({
        key: `geom:${part.slug}.${dim.property}`,
        name: `${part.slug}.${dim.property}`,
        dataType: dim.dataType,
        group: "unbound geometry",
        isInstance: false,
        kind: "ghost",
        slug: part.slug,
        property: dim.property,
      });
    }
  }
  return rows;
}

/** Every verdict is COMPUTED from the two substrates, never remembered — so an edit visibly
 * creates the same drift that Revit moving underneath would. */
function agreementOf(draft: Draft, row: PRow, typeName: string): Agreement {
  // A ghost is a literal in the geometry: Revit's family HAS this number, but no read reports it
  // as a parameter because it is not one. "unread" is the honest state — not agreement.
  if (row.kind === "ghost") return "unread";
  if (row.kind === "live-only") return "only-live";
  const authored = draft.authored[row.name] ?? "";
  if (isFormula(authored)) return "derived";
  const entry = draft.live[row.name]?.[typeName];
  if (!entry) return MISSING_IN_REVIT.has(row.name) ? "only-profile" : "unread";
  if (entry.readOnly) return "derived";
  return entry.value === effective(draft, row.name, typeName) ? "agree" : "drift";
}

function rowAgreement(draft: Draft, row: PRow): Agreement {
  const seen = new Set(TYPE_NAMES.map((typeName) => agreementOf(draft, row, typeName)));
  return AGREEMENT_RANK.find((state) => seen.has(state)) ?? "agree";
}

// ── the three readings of one cell ──────────────────────────────────────────────────────────────
//
// One function per substrate, all keyed the same way (row × type), so the overlay is a choice of
// FUNCTION and nothing else. That is why the swap costs no layout: the cell asks a different
// question of the same coordinates and renders in the same box.

/** What the staged document resolves to here — a ghost's literal, or the type's effective value. */
function draftValueAt(draft: Draft, row: PRow, typeName: string): string | null {
  if (row.kind === "ghost") return bindingOf(draft, row.slug ?? "", row.property ?? "");
  if (row.kind === "live-only") return null;
  return effective(draft, row.name, typeName);
}

/** What the file on disk carries here. `null` means the row itself is not on disk at all — a
 * promoted literal, whose whole parameter is new — which is a different fact from a changed value
 * and must not be shown as one. */
function savedValueAt(saved: SavedProfile, row: PRow, typeName: string): string | null {
  if (row.kind === "ghost") return saved.geom[row.slug ?? ""]?.[row.property ?? ""] ?? null;
  if (row.kind === "live-only") return null;
  if (!(row.name in saved.authored)) return null;
  return saved.types[typeName]?.[row.name] ?? saved.authored[row.name] ?? "";
}

/** true when saving would write something into this cell — including "the row is new". */
function isUnsavedAt(draft: Draft, saved: SavedProfile, row: PRow, typeName: string): boolean {
  if (row.kind === "live-only") return false;
  const disk = savedValueAt(saved, row, typeName);
  return disk === null || disk !== draftValueAt(draft, row, typeName);
}

/**
 * ROW PINNING, EMULATED — see the primitive gap noted on `pinnedSort`. Ghost rows must sit below
 * every parameter no matter how the table is sorted, because "the bottom of the table is the list
 * of numbers nothing can reach" is a claim about the bottom of the table, and a sort that
 * interleaves them retracts it silently.
 */
const PIN_RANK: Record<PRow["kind"], number> = { profile: 0, "live-only": 1, ghost: 2 };

/**
 * MasterTable has no row pinning, so the rank rides in front of the sort key as one character.
 * Descending flips the rank too, so the partition survives BOTH directions — a plain prefix would
 * pin ghosts to the bottom ascending and to the top descending, which is worse than not pinning.
 * This is a workaround, not a design: the primitive owes `pin: (row) => "bottom"`.
 */
function pinnedSort(row: PRow, value: string, dir: "asc" | "desc"): string {
  const rank = PIN_RANK[row.kind];
  return `${String.fromCharCode(48 + (dir === "desc" ? 2 - rank : rank))}\u0000${value}`;
}

function sortDirOf(state: MasterTableState, key: string): "asc" | "desc" {
  return state.sorts.find((sort) => sort.key === key)?.dir ?? "asc";
}

// ── anatomy geometry, parsed out of the profile's own numbers ───────────────────────────────────

/** "24in" → 24; a formula or anything unparseable → null, and the drawing says so. */
function inches(value: string | undefined): number | null {
  if (value == null || isFormula(value)) return null;
  const match = /-?\d+(\.\d+)?/.exec(value);
  return match ? Number(match[0]) : null;
}

/** Which parameters a constituent consumes — read out of the profile's own description text,
 * so the link is the document's claim rather than a hand-authored map. */
function paramsOf(description: string): string[] {
  return WORLD.profile.params
    .map((param) => param.name)
    .filter((name) => description.includes(name));
}

const CONSTITUENTS: {
  slug: string;
  kind: "solid" | "connector";
  text: string;
  params: string[];
}[] = [
  ...Object.entries(WORLD.profile.solids).map(([slug, text]) => ({
    slug,
    kind: "solid" as const,
    text,
    params: paramsOf(text),
  })),
  ...Object.entries(WORLD.profile.connectors).map(([slug, text]) => ({
    slug,
    kind: "connector" as const,
    text,
    params: paramsOf(text),
  })),
];

/** ONE focus for the whole page: either a parameter or a constituent is lit, never both
 * independently. Everything else derives its highlight from this. */
type Focus = { kind: "param"; id: string } | { kind: "part"; id: string } | null;

/**
 * ROUND 3: the focus map now reads the BINDINGS rather than the prose description text. The prose
 * link was a string match against a sentence — good enough to prove the idea, and wrong the moment
 * a binding moves. A dim that you rebind lights differently on the very next render, which is what
 * makes "bind" feel like it did something to the model rather than to a list.
 */
function paramsInFocus(focus: Focus, draft: Draft): Set<string> {
  if (!focus) return new Set();
  if (focus.kind === "param") return new Set([focus.id]);
  const part = GEOM_BY_SLUG.get(focus.id);
  if (part) {
    const names = part.dims
      .map((dim) => boundParam(bindingOf(draft, part.slug, dim.property)))
      .filter((name): name is string => name != null);
    return new Set(names);
  }
  return new Set(CONSTITUENTS.find((entry) => entry.slug === focus.id)?.params ?? []);
}

function partsInFocus(
  focus: Focus,
  consumers: Map<string, { slug: string; property: string }[]>,
): Set<string> {
  if (!focus) return new Set();
  if (focus.kind === "part") return new Set([focus.id]);
  return new Set((consumers.get(focus.id) ?? []).map((entry) => entry.slug));
}

// ── the stand-in page camera ────────────────────────────────────────────────────────────────────

/** Deterministic jitter — the stand-in must put a block in the SAME place every render, or it
 * stops standing in for a document and starts being noise. */
function hashOf(text: string): number {
  let hash = 2166136261;
  for (let index = 0; index < text.length; index += 1) {
    hash = Math.imul(hash ^ text.charCodeAt(index), 16777619) >>> 0;
  }
  return hash;
}

// ── the page ────────────────────────────────────────────────────────────────────────────────────

type DocMode = "text" | "sheet";

export function VariantE() {
  const [draft, setDraft] = useState<Draft>(initialDraft);
  /** ROUND 4 — the pseudo-dimension. PAGE state, never the URL: which reading you are looking
   * through is not a place, and a link that restored someone else's overlay would be claiming it
   * is. Draft is the default because it is the only one you can work in. */
  const [overlay, setOverlay] = useState<Overlay>("draft");
  /** The disk. Seeded from the fixture — the profile starts saved — and re-snapshotted on save. */
  const [saved, setSaved] = useState<SavedProfile>(() => savedFrom(initialDraft()));
  /** Bumped on every REFUSED commit. It keys the editors that can refuse, so a refused edit puts
   * the old value back in the box: leaving the emptied text sitting there while the model kept the
   * old number would be the input lying about what happened. */
  const [refusals, setRefusals] = useState(0);
  /**
   * The LAST refusal, held next to the cell that refused. The header receipt says it too, but a
   * receipt at the top of the page relaxes after four seconds and is nowhere near the box you were
   * typing in — a refusal has to be legible where the refusal happened. It clears when that cell
   * commits something acceptable, or when another one refuses.
   */
  const [refusal, setRefusal] = useState<{ key: string; text: string } | null>(null);
  /** Table state is OWNED here, because the sort direction is an input to the ghost-pinning
   * workaround — the sort key has to know which way it is about to be read. */
  const [tableState, setTableState] = useState<MasterTableState>(() => ({
    filters: {},
    sorts: [],
    query: "",
  }));
  const [drillState, setDrillState] = useState<MasterTableState>(() => ({
    filters: {},
    sorts: [],
    query: "",
  }));
  const [docMode, setDocMode] = useState<DocMode>("text");
  const [docZoom, setDocZoom] = useState(1);
  const [drillType, setDrillType] = useState<string | null>(null);
  const [stageType, setStageType] = useState<string>(TYPE_NAMES[1] ?? TYPE_NAMES[0] ?? "Standard");
  const [focus, setFocus] = useState<Focus>(null);
  const [focusedProposal, setFocusedProposal] = useState<string | null>(null);
  /** The row whose proposals were last LOCATED from the table. Sticky — hover comes and goes, but
   * "I clicked this row's rail dot" has to survive the pointer leaving the row on its way to the
   * sidebar, or the cards would go dark exactly as you reached for them. */
  const [pinnedParam, setPinnedParam] = useState<string | null>(null);
  const [anatomyCollapsed, setAnatomyCollapsed] = useState(false);
  /** Which ghost row is first in VISIBLE order — the one that carries the section hairline. */
  const [firstGhostKey, setFirstGhostKey] = useState<string | null>(null);
  const [receipt, setReceipt] = useState<{ text: string; atMs: number } | null>(null);
  const [target, setTarget] = useState("");
  /**
   * ROUND 3 — what the doc pane's LOWER HALF is showing. One slot, two subjects: a constituent's
   * non-bindable metadata, or a parameter's family-level value. They share the slot because they
   * are the same question asked twice — "what is true of this thing itself, rather than of it at
   * some type" — and because a page with two inspectors has no answer to which one you meant.
   */
  const [inspect, setInspect] = useState<
    { kind: "part"; slug: string } | { kind: "param"; name: string } | null
  >(null);
  /** The ghost row whose bind picker is open. One at a time; picking or cancelling closes it. */
  const [binding, setBinding] = useState<{ slug: string; property: string } | null>(null);
  const cardRefs = useRef<Record<string, HTMLDivElement | null>>({});

  const say = (text: string) => setReceipt({ text, atMs: Date.now() });

  // Esc unwinds ONE thing, innermost first: the bind picker, then the inspector, then the
  // drill-in. Each is a mode of a pane rather than a place, so leaving one must never feel like
  // navigating — and collapsing them all at once would throw away context you did not ask to lose.
  useEffect(() => {
    if (drillType == null && inspect == null && binding == null) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      if (binding != null) setBinding(null);
      else if (inspect != null) setInspect(null);
      else setDrillType(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [drillType, inspect, binding]);

  // Locating scrolls the card into the sidebar. That is the whole payoff of the rail and the
  // corner notches: the table points, the sidebar decides, and nothing covers the table.
  useEffect(() => {
    if (!focusedProposal) return;
    cardRefs.current[focusedProposal]?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [focusedProposal]);

  const verdictOf = (id: string): CellVerdict => draft.verdicts[id] ?? "open";

  /** Every OPEN proposal aimed at exactly one cell: a type override, or the family-level value.
   * A list, not a single one — a cell may be argued about twice, and hiding the second would be
   * the surface lying about how much is outstanding. */
  const proposalsAt = (param: string, typeName: string | null): ProtoProposal[] =>
    WORLD.proposals.filter(
      (entry) =>
        entry.param === param &&
        (entry.typeName ?? null) === typeName &&
        verdictOf(entry.id) === "open",
    );

  /** Every open proposal anywhere on a parameter's row — what the RAIL counts. */
  const proposalsOn = (param: string): ProtoProposal[] =>
    WORLD.proposals.filter((entry) => entry.param === param && verdictOf(entry.id) === "open");

  const openProposals = WORLD.proposals.filter((entry) => verdictOf(entry.id) === "open");

  /** Locate: point the sidebar at a proposal without deciding anything about it. */
  const locate = (proposal: ProtoProposal) => {
    setFocusedProposal(proposal.id);
    setPinnedParam(proposal.param);
  };

  /**
   * The table's rows, DERIVED from the draft rather than fixed at module load — because two of
   * this round's verbs change the row set itself. Promoting a literal adds a parameter row and
   * removes a ghost in the same edit, and that move is the only proof the user gets that binding
   * did anything at all.
   */
  const rows = useMemo<PRow[]>(
    () => [
      ...PARAM_ROWS,
      ...draft.newParams.map((param) => ({
        key: param.name,
        name: param.name,
        dataType: param.dataType,
        group: param.group,
        isInstance: false,
        kind: "profile" as const,
      })),
      // ROUND 4: live-only rows exist only while the LIVE overlay is on. They are rows with no
      // draft and no saved value — under `draft` every cell of them would be a blank refusal, and
      // a row that can only ever say "not here" is a row the table is better off not carrying.
      // Under the live overlay they are the other half of the reconcile: what Revit has that the
      // profile does not claim.
      ...(overlay === "live" ? LIVE_ONLY_ROWS : []),
      ...ghostRows(draft),
    ],
    [draft, overlay],
  );

  const consumers = useMemo(() => consumersOf(draft), [draft]);
  const ghostCount = rows.filter((row) => row.kind === "ghost").length;

  const driftCells = useMemo(() => {
    const cells: { param: string; typeName: string }[] = [];
    for (const row of rows) {
      for (const typeName of TYPE_NAMES) {
        if (agreementOf(draft, row, typeName) === "drift")
          cells.push({ param: row.name, typeName });
      }
    }
    return cells;
  }, [draft, rows]);

  /** How many value cells the draft would write into the file. The header's dirty fact says
   * WHETHER; this says HOW MUCH, and the kiln dots say WHERE. */
  const unsavedCount = useMemo(() => {
    let count = 0;
    for (const row of rows)
      for (const typeName of TYPE_NAMES) {
        if (row.kind === "ghost" && typeName !== TYPE_NAMES[0]) continue; // one merged cell, one count
        if (isUnsavedAt(draft, saved, row, typeName)) count += 1;
      }
    return count;
  }, [draft, saved, rows]);

  // ── verbs ─────────────────────────────────────────────────────────────────────────────────────

  const accept = (proposal: ProtoProposal) => {
    setDraft((previous) => {
      const next = structuredClone(previous);
      if (proposal.typeName) {
        next.types[proposal.typeName] = {
          ...next.types[proposal.typeName],
          [proposal.param]: proposal.proposed,
        };
      } else {
        next.authored[proposal.param] = proposal.proposed;
      }
      next.verdicts[proposal.id] = "accepted";
      next.dirty = true;
      return next;
    });
    say(`accepted ${proposal.param} = ${proposal.proposed}`);
  };

  const deny = (proposal: ProtoProposal) => {
    setDraft((previous) => ({
      ...previous,
      verdicts: { ...previous.verdicts, [proposal.id]: "denied" },
    }));
    say(`denied a proposal — the profile is unchanged`);
  };

  /**
   * TYPING BEATS PROPOSING. Committing your own value into a cell severs every open proposal
   * aimed at that exact cell — including an empty commit, which hands the type back to inheriting
   * and is just as much a decision. There is no verdict left to give: pea argued for a number and
   * you wrote a different one, so accept and deny both became meaningless. The card settles muted,
   * not green — nothing of pea's was adopted.
   */
  const sever = (next: Draft, param: string, typeName: string | null) => {
    for (const entry of WORLD.proposals) {
      if (entry.param !== param) continue;
      if ((entry.typeName ?? null) !== typeName) continue;
      if ((next.verdicts[entry.id] ?? "open") !== "open") continue;
      next.verdicts[entry.id] = "superseded";
    }
  };

  /**
   * The FAMILY-LEVEL value — round 3's friction fix. Removing the family-value column was right
   * (a fourth value column pretending to be a fourth type), but it left the value itself with no
   * home: the type columns show it only as a grey placeholder they inherit, and a placeholder is
   * not an editor. It lives in the inspector now, which is also the only place a formula can be
   * typed at a comfortable width. Committing here severs a family-level proposal exactly as
   * typing in a type cell severs a per-type one — the law does not care which level you beat pea to.
   */
  const editAuthored = (param: string, value: string) => {
    const trimmed = value.trim();
    // A parameter with no family value is not a state — but a REFUSAL has to be audible. The old
    // code dropped the empty commit silently, which looked exactly like an edit that landed and
    // then vanished. Now the box says the number back and the receipt says why.
    if (trimmed === "") {
      const text = `Refused — "${param}" cannot have an empty family value. Every type inherits it; clearing it would leave ${TYPE_NAMES.length} types resolving to nothing. To make one type differ, override it in that type's cell instead.`;
      setRefusals((count) => count + 1);
      setRefusal({ key: `param:${param}`, text });
      say(text);
      return;
    }
    setRefusal((current) => (current?.key === `param:${param}` ? null : current));
    setDraft((previous) => {
      const next = structuredClone(previous);
      next.authored[param] = trimmed;
      sever(next, param, null);
      next.dirty = true;
      return next;
    });
  };

  const editOverride = (param: string, typeName: string, value: string) =>
    setDraft((previous) => {
      const next = structuredClone(previous);
      const bucket = { ...next.types[typeName] };
      if (value.trim() === "") delete bucket[param];
      else bucket[param] = value.trim();
      next.types[typeName] = bucket;
      sever(next, param, typeName);
      next.dirty = true;
      return next;
    });

  /** capture — Revit wins. Writes live values into the profile as per-type overrides, dropping an
   * override that would merely restate the family value. Revit is not touched.
   * `only` narrows it to one parameter, so a per-row verb does exactly what its label says. */
  const capture = (types: string[], only?: string) =>
    setDraft((previous) => {
      const next = structuredClone(previous);
      let moved = 0;
      for (const row of rows) {
        if (row.kind !== "profile") continue;
        if (only !== undefined && row.name !== only) continue;
        for (const typeName of types) {
          if (agreementOf(previous, row, typeName) !== "drift") continue;
          const value = next.live[row.name]?.[typeName]?.value;
          if (value == null) continue;
          const bucket = { ...next.types[typeName] };
          if (value === next.authored[row.name]) delete bucket[row.name];
          else bucket[row.name] = value;
          next.types[typeName] = bucket;
          moved += 1;
        }
      }
      next.dirty = next.dirty || moved > 0;
      return next;
    });

  /** apply — the profile wins. The one direction that MODIFIES the model, hence the commit hue. */
  const apply = (types: string[], only?: string) =>
    setDraft((previous) => {
      const next = structuredClone(previous);
      for (const row of rows) {
        if (row.kind !== "profile") continue;
        if (only !== undefined && row.name !== only) continue;
        for (const typeName of types) {
          if (agreementOf(previous, row, typeName) !== "drift") continue;
          const entry = next.live[row.name]?.[typeName];
          if (!entry) continue;
          entry.value = effective(next, row.name, typeName);
          entry.drift = false;
        }
      }
      return next;
    });

  const captureAll = (types: string[]) => {
    const count = driftCells.filter((cell) => types.includes(cell.typeName)).length;
    capture(types);
    say(`captured ${count} value${count === 1 ? "" : "s"} out of Revit into the profile`);
  };

  const applyAll = (types: string[]) => {
    const count = driftCells.filter((cell) => types.includes(cell.typeName)).length;
    apply(types);
    say(`applied ${count} value${count === 1 ? "" : "s"} into the live family`);
  };

  const save = () => {
    // The disk moves to where the draft is. Every kiln dot goes out in the same beat, and the
    // saved overlay stops differing anywhere — which is the visible proof that save wrote what
    // the marks said it would.
    setSaved(savedFrom(draft));
    setDraft((previous) => ({ ...previous, dirty: false }));
    say(
      `saved ${WORLD.profile.path} — ${unsavedCount} value${unsavedCount === 1 ? "" : "s"} written`,
    );
  };

  // ── the geometry verbs ────────────────────────────────────────────────────────────────────────

  /** Retype a frozen literal. It stays frozen — this edits the number, not its reachability. */
  const editLiteral = (slug: string, property: string, value: string) => {
    const trimmed = value.trim();
    // An emptied literal is not a value — the geometry would have no number at all. Refused OUT
    // LOUD: the box puts the old literal back and the receipt says what would have happened.
    if (trimmed === "") {
      const text = `Refused — ${slug}.${property} is a frozen literal, so it cannot be emptied: the geometry would have no dimension at all. Type a number, or bind it to a parameter to give it somewhere else to come from.`;
      setRefusals((count) => count + 1);
      setRefusal({ key: `geom:${slug}.${property}`, text });
      say(text);
      return;
    }
    setRefusal((current) => (current?.key === `geom:${slug}.${property}` ? null : current));
    setDraft((previous) => {
      const next = structuredClone(previous);
      next.geom[slug] = {
        dims: { ...next.geom[slug]?.dims, [property]: trimmed },
        meta: { ...next.geom[slug]?.meta },
      };
      next.dirty = true;
      return next;
    });
  };

  const editMeta = (slug: string, key: string, value: string) =>
    setDraft((previous) => {
      const next = structuredClone(previous);
      next.geom[slug] = {
        dims: { ...next.geom[slug]?.dims },
        meta: { ...next.geom[slug]?.meta, [key]: value },
      };
      next.dirty = true;
      return next;
    });

  /**
   * BIND — a ghost row's one crossing, in the only two shapes it has.
   *
   *   to an existing parameter — the literal is DISCARDED and the dim starts reading that row.
   *     The ghost vanishes and the parameter grows a consumer; nothing else moves.
   *   to a new parameter       — the literal is KEPT and becomes that parameter's family value,
   *     so the geometry is byte-identical afterwards and only its reachability changed. That is
   *     the honest promotion: binding must never quietly move a number.
   */
  const bindTo = (slug: string, property: string, paramName: string) => {
    const literal = bindingOf(draft, slug, property);
    setDraft((previous) => {
      const next = structuredClone(previous);
      next.geom[slug] = {
        dims: { ...next.geom[slug]?.dims, [property]: `param:${paramName}` },
        meta: { ...next.geom[slug]?.meta },
      };
      next.dirty = true;
      return next;
    });
    setBinding(null);
    setFocus({ kind: "param", id: paramName });
    say(`bound ${slug}.${property} to ${paramName} — its ${literal} literal is gone`);
  };

  const bindToNew = (slug: string, property: string, dataType: string) => {
    const literal = bindingOf(draft, slug, property);
    const base = paramNameFor(slug, property);
    const taken = new Set(Object.keys(draft.authored));
    let name = base;
    for (let n = 2; taken.has(name); n += 1) name = `${base} ${n}`;
    setDraft((previous) => {
      const next = structuredClone(previous);
      next.authored[name] = literal;
      next.newParams = [...next.newParams, { name, dataType, group: "geometry" }];
      next.geom[slug] = {
        dims: { ...next.geom[slug]?.dims, [property]: `param:${name}` },
        meta: { ...next.geom[slug]?.meta },
      };
      next.dirty = true;
      return next;
    });
    setBinding(null);
    setFocus({ kind: "param", id: name });
    setInspect({ kind: "param", name });
    say(`promoted ${slug}.${property} → new parameter "${name}" seeded with ${literal}`);
  };

  // ── grounding highlight — independent of proposals, so it survives acceptance ──────────────────

  // MEMOISED, and that is load-bearing rather than tidy: `columns` depends on nothing that hover
  // touches, but a fresh Set identity on every render would still churn the array, and MasterTable
  // hands each column's `cell` to FlexRender as a COMPONENT TYPE. A new function identity there is
  // a new type, which unmounts and remounts every cell — including the input you are typing in.
  // Stable focus sets keep the table's inputs alive while the pointer moves.
  /**
   * ONE focus, COMPOSED rather than duplicated. Hover wins while the pointer is over something;
   * the inspected subject holds the focus the rest of the time. So opening a constituent's editor
   * lights its shape in the drawing and its parameters in the table and keeps them lit — which is
   * the one-focus law doing the work, not a second highlight channel bolted on beside it.
   */
  const heldFocus = useMemo<Focus>(
    () =>
      inspect == null
        ? null
        : inspect.kind === "part"
          ? { kind: "part", id: inspect.slug }
          : { kind: "param", id: inspect.name },
    [inspect],
  );
  const liveFocus = focus ?? heldFocus;
  const focusedParams = useMemo(() => paramsInFocus(liveFocus, draft), [liveFocus, draft]);
  const focusedParts = useMemo(() => partsInFocus(liveFocus, consumers), [liveFocus, consumers]);
  const litBlocks = useMemo(() => {
    const set = new Set<string>();
    for (const param of focusedParams) for (const id of GROUNDING[param] ?? []) set.add(id);
    if (focusedProposal) {
      const proposal = WORLD.proposals.find((entry) => entry.id === focusedProposal);
      if (proposal) set.add(proposal.sourceBlockId);
    }
    return set;
  }, [focusedParams, focusedProposal]);

  // ── columns ───────────────────────────────────────────────────────────────────────────────────
  //
  // Built by shared factories, because the DRILL-IN uses the same MasterTable and must therefore
  // use literally the same cells: the identity column and a type column are the two pieces both
  // modes need, and a per-type view that merely LOOKED like the cross-type table would drift away
  // from it the first time either changed.

  /** The verdict rail: scannable, countable, and carrying no verdict of its own. */
  const railColumn = (): Column<PRow> => ({
    key: "rail",
    label: "",
    group: "PARAMETER",
    width: "w-6",
    title:
      "The verdict rail — the page's answer to 'where do proposals live', readable top to bottom without reading a single value. A dot means one proposal on this row; a counted chip means several. Clicking either LOCATES them in the sidebar; it never decides anything, because a verdict belongs next to the spec text that justifies it.",
    cell: (row) => {
      const open = proposalsOn(row.name);
      const accepted = WORLD.proposals.filter(
        (entry) => entry.param === row.name && verdictOf(entry.id) === "accepted",
      );
      if (open.length === 0)
        return accepted.length > 0 ? (
          <ReadCell
            className="text-center text-[var(--st-done)]"
            value="✓"
            reason="Every proposal on this row is settled, and at least one was accepted — the value is in the profile, and its citation is still live in the sidebar."
          />
        ) : null;

      const where = open
        .map(
          (entry) =>
            `${entry.typeName ?? "family value"}: ${entry.current ?? "—"} → ${entry.proposed}`,
        )
        .join(" · ");
      return (
        <span className="flex h-7 items-center justify-center">
          <button
            type="button"
            onClick={() => locate(open[0]!)}
            aria-label={`locate ${open.length} proposal(s) on ${row.name}`}
            title={
              open.length === 1
                ? `One open proposal on ${row.name} — ${where}. Click to bring its card into view in the doc sidebar, where accept and deny sit beside the spec text. Nothing pops over the table.`
                : `${open.length} open proposals on ${row.name}, at different types — ${where}. The row is contested more than once; the pea-green notches in the cells say WHICH cells. Click to bring the cards into view.`
            }
            className={cn(
              "tele flex items-center justify-center",
              open.length === 1
                ? "size-2 rounded-[1px] bg-[var(--st-proposal)]"
                : "h-3.5 min-w-3.5 rounded-[2px] border border-[var(--st-proposal)] px-0.5 text-[9px] leading-none text-[var(--st-proposal)]",
            )}
          >
            {open.length > 1 ? open.length : null}
          </button>
        </span>
      );
    },
  });

  /**
   * The parameter's identity — and, since the family-value COLUMN is gone, the only place the
   * family level shows itself: a formula renders as a second line here, and a family-level
   * proposal wears its notch here. That is honest about where the value lives, where a fourth
   * value column pretending to be a fourth type was not.
   */
  const identityColumn = (state: MasterTableState): Column<PRow> => ({
    key: "param",
    label: "parameter",
    group: "PARAMETER",
    width: "w-64",
    // Sorting NEVER lifts a ghost above a parameter — the rank rides in front of the name. See
    // pinnedSort: this is an emulation of a row-pinning primitive MasterTable does not have.
    sort: (row) => pinnedSort(row, row.name, sortDirOf(state, "param")),
    search: (row) => `${row.name} ${row.dataType} ${row.group}`,
    title:
      "One row per parameter — the unit of the whole page. The marks after the name are the tight facts: instance binding, whether Revit has it at all, and which spec block grounds it. The second line carries the family level: a formula, and the geometry properties this parameter DRIVES. Click the name to open it in the inspector, where its family value is edited.",
    cell: (row) => {
      // GHOST — not a parameter, and it must never be mistakable for one. Muted, italic, named in
      // the geometry's vocabulary (slug.property, not Title Case). ROUND 4 moved its literal OUT
      // of this cell and into a single merged cell across the type columns, which is the honest
      // shape of "one number, no per-type spread" — and it stopped this column carrying an editor
      // for a value the value columns were simultaneously refusing.
      if (row.kind === "ghost") {
        const slug = row.slug ?? "";
        const property = row.property ?? "";
        const literal = bindingOf(draft, slug, property);
        const dim = GEOM_BY_SLUG.get(slug)?.dims.find((entry) => entry.property === property);
        return (
          <span className="flex h-7 min-w-0 items-center px-1.5">
            <button
              type="button"
              onClick={() => setInspect({ kind: "part", slug })}
              title={`${slug}.${property} — a bindable ${row.dataType} dimension that NO parameter drives. ${dim?.note ?? ""} It is ${literal} for every type of this family, forever: no type can differ, no schedule can read it, no formula can reach it. Its value is the ONE merged cell to the right, spanning every type column, because there is exactly one of it. Click to open ${slug} in the inspector; use "bind…" in the state column to give it a parameter.`}
              className="tele block w-full truncate text-left text-[10px] italic leading-[12px] text-muted-foreground/70 hover:text-foreground"
            >
              {row.name}
              <span className="ml-1 not-italic text-[9px] text-[var(--st-warn)]">geom</span>
            </button>
          </span>
        );
      }

      const authored = draft.authored[row.name] ?? "";
      const blocks = GROUNDING[row.name] ?? [];
      const family = proposalsAt(row.name, null);
      const drives = consumers.get(row.name) ?? [];
      const reason = `${row.name} — ${row.dataType}, bound per ${
        row.isInstance
          ? "instance (a placed element may depart from it; the family still authors a default per type, which is what the type columns hold)"
          : "type"
      }.${isFormula(authored) ? ` Driven by the family-level formula ${authored}, so no type can override its result.` : ""}${
        MISSING_IN_REVIT.has(row.name)
          ? " ⊘ — the live family has no parameter by this name; apply moves values, not schema."
          : ""
      }${
        blocks.length > 0
          ? ` Grounded in ${blocks.join(", ")} of ${SPEC?.fileName ?? "the spec"} — hover the row to light it in the sidebar.`
          : " Ungrounded: nothing in the spec claims this number."
      }${family.length > 0 ? ` Pea proposes a FAMILY-LEVEL value here: ${family[0]!.current ?? "—"} → ${family[0]!.proposed}. Accepting it moves every type that does not override.` : ""}${
        drives.length > 0
          ? ` Drives ${drives.map((entry) => `${entry.slug}.${entry.property}`).join(", ")} — this row IS those dimensions, which is why they have no rows of their own.`
          : row.kind === "profile"
            ? " Drives no geometry the profile declares — it is schedule data, or it is dead."
            : ""
      }`;
      return (
        <ProposedCell
          proposals={family}
          onLocate={locate}
          where={`the family value of ${row.name}`}
        >
          <span className="tele block min-w-0 flex-1 truncate px-1.5" title={reason}>
            <span className="block truncate leading-[13px]">
              {row.kind === "live-only" ? (
                <span className="text-muted-foreground">{row.name}</span>
              ) : (
                <button
                  type="button"
                  onClick={() => setInspect({ kind: "param", name: row.name })}
                  title={`Open ${row.name} in the inspector below the spec — where its FAMILY-LEVEL value is edited, along with its formula, its consumers, and its citation. The type columns on this row only ever hold overrides; the value they inherit lives there.`}
                  className="hover:text-foreground hover:underline"
                >
                  {row.name}
                </button>
              )}
              {row.isInstance && (
                <span className="ml-1 text-[9px] text-muted-foreground/70">inst</span>
              )}
              {MISSING_IN_REVIT.has(row.name) && (
                <span className="ml-1 text-[9px] text-[var(--st-warn)]">⊘</span>
              )}
              {blocks.length > 0 && (
                <span className="ml-1 text-[9px] text-muted-foreground/60">{blocks.join(" ")}</span>
              )}
            </span>
            {/* The family level, on ONE line: the formula, and what the parameter DRIVES. A bound
                geometry dim has no row of its own — it is represented by this parameter — so this
                mark is the only place the representation is visible. Several consumers join here,
                and that join is the point: editing this row moves all of them at once. */}
            {(isFormula(authored) || drives.length > 0) && (
              <span className="block truncate text-[9px] leading-[11px]">
                {isFormula(authored) && (
                  <span className="text-[var(--st-derived)]">{authored}</span>
                )}
                {isFormula(authored) && drives.length > 0 && (
                  <span className="text-muted-foreground/40"> · </span>
                )}
                {drives.length > 0 && <span className="text-muted-foreground/50">→ </span>}
                {drives.map((entry, index) => (
                  <button
                    key={`${entry.slug}.${entry.property}`}
                    type="button"
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={() => setInspect({ kind: "part", slug: entry.slug })}
                    title={`${row.name} drives ${entry.slug}.${entry.property}. Click to open ${entry.slug} in the inspector — its non-bindable metadata (direction, system type, where its frame sits) lives there, because no parameter can drive those.`}
                    className="text-muted-foreground/70 hover:text-foreground"
                  >
                    {index > 0 && <span className="text-muted-foreground/40">, </span>}
                    {entry.slug}.{entry.property}
                  </button>
                ))}
              </span>
            )}
          </span>
        </ProposedCell>
      );
    },
  });

  /** One type's overrides. Identical in the cross-type table and in the drill-in — except
   * alignment: the drill-in right-aligns this column so the profile's number and Revit's meet
   * at the spine and the eye reads one diff, not two lists. */
  const typeColumn = (
    typeName: string,
    options: { header?: boolean; align?: "right" } = {},
  ): Column<PRow> => ({
    key: `type:${typeName}`,
    label: typeName,
    group: "PROFILE",
    width: "w-28",
    right: options.align === "right",
    headerClassName:
      options.header && stageType === typeName
        ? "bg-[color-mix(in_srgb,var(--secondary)_70%,var(--muted))]"
        : undefined,
    header: options.header ? (
      <button
        type="button"
        onClick={() => {
          setStageType(typeName);
          setDrillType(typeName);
          // The drill-in has its OWN live column and its own per-row crossings, so it is already a
          // two-substrate view. Carrying the overlay in would put Revit's number in two places at
          // once and make the type column read-only for no reason the drill-in explains.
          setOverlay("draft");
        }}
        title={`Drill into "${typeName}". The table pane swaps to the same table, narrowed to this one type and opened up with the spine and the crossing verbs. "← all types" in the pane header, or Esc, comes back.`}
        className="tele-label block w-full text-left normal-case text-muted-foreground hover:text-foreground"
      >
        {typeName} <span className="opacity-60">⤢</span>
      </button>
    ) : undefined,
    title: `What "${typeName}" overrides in the DRAFT. An empty cell INHERITS — the family value shows through as the grey placeholder, which is the only place the family level appears now that it has no column of its own. Typing creates the override; clearing hands the type back to the family. Under the ⇄ live and ⇄ saved overlays this same column shows Revit's number and the disk's number instead, read-only, in place.`,
    cell: (row) => {
      // ── the ghost's ONE merged cell ─────────────────────────────────────────────────────────
      // A frozen literal has no per-type spread, so it gets no per-type cells: it gets one cell
      // the width of all of them, left-aligned like every other value. MasterTable cannot express
      // a colspan, so the anchor column renders it and its neighbours are SUPPRESSED — blank, but
      // blank WITH a reason, which is the same discipline every other refusal on this page keeps.
      if (row.kind === "ghost") {
        const slug = row.slug ?? "";
        const property = row.property ?? "";
        if (typeName !== MERGE_ANCHOR)
          return (
            <ReadCell
              value=""
              reason={`Suppressed — part of the ONE merged value cell for ${row.name}, which begins in the first type column and spans all of them. There is exactly one literal for the whole family, so it is drawn once. (MasterTable has no spanning cell; this is the honest emulation of one.)`}
            />
          );
        const literal = bindingOf(draft, slug, property);
        const diskLiteral = saved.geom[slug]?.[property] ?? null;
        if (overlay === "live")
          return (
            <ReadCell
              className="leading-7 text-muted-foreground/40"
              value="unread — not a parameter"
              reason={`UNREAD, not absent. Revit's family certainly carries this number — it is in the solid — but a parameter read cannot report it, because it is not a parameter. Nothing here can be compared, and silence is not agreement. Binding it is what makes it readable at all.`}
            />
          );
        if (overlay === "saved")
          return (
            <ReadCell
              className={cn(
                "leading-7",
                diskLiteral === null
                  ? "italic text-[var(--st-warn)]"
                  : diskLiteral !== literal
                    ? "text-[var(--st-warn)]"
                    : "text-muted-foreground",
              )}
              value={
                diskLiteral === null ? (
                  "not on disk"
                ) : (
                  <>
                    {diskLiteral}
                    {diskLiteral !== literal && (
                      <span className="ml-1 text-[var(--st-warn)]">→</span>
                    )}
                  </>
                )
              }
              reason={
                diskLiteral === null
                  ? `${row.name} is not in the saved profile at all.`
                  : diskLiteral === literal
                    ? `The file already carries ${diskLiteral} for ${row.name}. Saving would write nothing here.`
                    : `The file carries ${diskLiteral}; saving writes ${literal} over it.`
              }
            />
          );
        return (
          // The wrapper is unconditional here so the refusal chip has something to be positioned
          // against without ever pushing the input onto a second line — a row that grew a pixel
          // when it refused would break the one promise the overlays are built on.
          <span className="relative flex h-7 w-full items-center">
            <ProposedCell
              proposals={[]}
              onLocate={locate}
              where={row.name}
              unsaved={
                isUnsavedAt(draft, saved, row, typeName)
                  ? `UNSAVED — the file ${diskLiteral === null ? "does not carry this dimension at all" : `carries ${diskLiteral}`}; saving writes ${literal}.`
                  : null
              }
            >
              <TextCell
                key={`${literal}:${refusals}`}
                value={literal}
                className="text-foreground"
                title={`The literal itself, as ONE cell across every type — EDITABLE. Typing here rewrites the number frozen into the geometry; it does not make it reachable. That is what binding is for, and the two are deliberately different acts: this one changes what the family measures, binding changes who is allowed to say so. Emptying it is refused out loud — a dimension with no number is not a state.`}
                onCommit={(next) => editLiteral(slug, property, next)}
              />
            </ProposedCell>
            {refusal?.key === `geom:${slug}.${property}` && (
              <RefusalNote text={refusal.text} onDismiss={() => setRefusal(null)} />
            )}
          </span>
        );
      }

      // ── live-only rows: they exist ONLY under the live overlay, so they only speak there ─────
      if (row.kind === "live-only") {
        const entry = draft.live[row.name]?.[typeName];
        return (
          <ReadCell
            className="leading-7 text-muted-foreground/50"
            value={entry?.value ?? "—"}
            reason={`${MARK_TITLE["only-live"]} The last read listed "${row.name}" as present in the family but reported no per-type value for it, so there is nothing here to compare — only the fact that the parameter exists and the profile does not claim it.`}
          />
        );
      }

      const authored = draft.authored[row.name] ?? "";
      const proposals = proposalsAt(row.name, typeName);
      const grounded = (GROUNDING[row.name] ?? []).length > 0;
      const drifted = agreementOf(draft, row, typeName) === "drift";
      const diskValue = savedValueAt(saved, row, typeName);
      const draftValue = draftValueAt(draft, row, typeName);
      const unsaved = isUnsavedAt(draft, saved, row, typeName);
      // The two marks that are facts about the CELL rather than about the reading, so they are
      // applied identically in all three overlays. Grounded is a neutral hairline — it spends no
      // colour, because the colour budget belongs to drift (clay), commitment (--act-commit) and the
      // unsaved warning (--st-warn). Drift's clay outranks it: they are the same underline slot, and a
      // cell that is both is more urgently the first.
      const underline = drifted
        ? "underline decoration-[var(--st-drift)] decoration-dotted underline-offset-[3px]"
        : grounded
          ? "underline decoration-[var(--st-ground)] decoration-dotted underline-offset-[3px]"
          : undefined;
      const groundedNote = grounded
        ? ` Grounded in ${(GROUNDING[row.name] ?? []).join(", ")} of ${SPEC?.fileName ?? "the spec"} — the hairline underline is that citation, and it stays put in every overlay.`
        : "";

      const marks = (inner: React.ReactNode) => (
        <ProposedCell
          proposals={proposals}
          onLocate={locate}
          where={`${row.name} at ${typeName}`}
          unsaved={
            overlay === "draft" && unsaved
              ? `UNSAVED — ${
                  diskValue === null
                    ? `"${row.name}" is not in the file at all; saving adds it, resolving to ${draftValue} at ${typeName}.`
                    : `the file resolves ${typeName} to ${diskValue}; saving writes ${draftValue}.`
                } The dot sits opposite the proposal corner so the two marks can never be confused.`
              : null
          }
        >
          {inner}
        </ProposedCell>
      );

      // ── ⇄ LIVE: Revit's number, in the cell it is a reading of ──────────────────────────────
      if (overlay === "live") {
        if (MISSING_IN_REVIT.has(row.name))
          return marks(
            <ReadCell
              className={cn("leading-7 italic text-[var(--st-warn)]", underline)}
              value="not in Revit"
              reason={`${MARK_TITLE["only-profile"]}${groundedNote}`}
            />,
          );
        const entry = draft.live[row.name]?.[typeName];
        if (!entry)
          return marks(
            <ReadCell
              className={cn("leading-7 text-muted-foreground/40", underline)}
              value="·"
              reason={`${MARK_TITLE.unread} Re-read the family before treating this dot as a match.${groundedNote}`}
            />,
          );
        return marks(
          <ReadCell
            className={cn(
              "leading-7",
              drifted && "text-[var(--st-drift)]",
              entry.readOnly && "italic text-muted-foreground/60",
              underline,
            )}
            value={entry.value}
            reason={
              drifted
                ? `DRIFT — Revit carries ${entry.value} at ${typeName}; the draft resolves to ${draftValue}. ${MARK_TITLE.drift} Read-only here: editing a live number is not a thing that exists, which is why apply is the write path and its verbs are lit in this overlay.${groundedNote}`
                : `${typeName} — ${entry.value}. ${MARK_TITLE[agreementOf(draft, row, typeName)]}${groundedNote}`
            }
          />,
        );
      }

      // ── ⇄ SAVED: the disk's number, and what save would write over it ───────────────────────
      if (overlay === "saved") {
        if (diskValue === null)
          return marks(
            <ReadCell
              className={cn("leading-7 italic text-[var(--st-warn)]", underline)}
              value="new — not on disk"
              reason={`"${row.name}" is not in the saved profile at all: this page created it. Saving adds the whole parameter, and this type will resolve to ${draftValue}.${groundedNote}`}
            />,
          );
        const willWrite = diskValue !== draftValue;
        return marks(
          <ReadCell
            className={cn(
              "leading-7",
              willWrite ? "text-[var(--st-warn)]" : "text-muted-foreground",
              underline,
            )}
            value={
              <>
                {diskValue || "—"}
                {willWrite && <span className="ml-1">→</span>}
              </>
            }
            reason={
              willWrite
                ? `The file resolves ${typeName} to ${diskValue || "nothing"}; saving writes ${draftValue} over it. The kiln arrow is the direction of that write — it is a warning, not a drift: nothing about Revit is claimed here.${groundedNote}`
                : `The file already resolves ${typeName} to ${diskValue}. Saving writes nothing into this cell.${groundedNote}`
            }
          />,
        );
      }

      // ── DRAFT: the staged document, editable — exactly as it was ────────────────────────────
      if (isFormula(authored))
        return (
          <ReadCell
            className={cn(
              "leading-7 text-[var(--st-derived)]/70 italic",
              options.align === "right" && "text-right",
            )}
            value="driven"
            reason={`LOCKED — the family level drives this with ${authored}, so a type cannot override its result. The formula is shown on the parameter's own cell; change what feeds it instead. Switch to ⇄ live to see the number Revit computes for it.`}
          />
        );
      const override = draft.types[typeName]?.[row.name];
      return marks(
        <TextCell
          value={override ?? ""}
          placeholder={authored}
          className={cn(
            "placeholder:text-muted-foreground/35",
            proposals.length > 0 && "text-[var(--st-proposal)]",
            options.align === "right" && "text-right",
            underline,
          )}
          title={
            proposals.length > 0
              ? `Pea proposes ${proposals[0]!.proposed} here — but this cell is ORDINARY. Type your own value and the proposal is severed on the spot: no accept, no deny, the card settles to "superseded by your edit". ${override === undefined ? `Until then the type inherits ${authored || "nothing"}.` : `The type currently overrides with ${override}.`}${groundedNote}`
              : override === undefined
                ? `"${typeName}" inherits ${authored || "nothing"} from the family — the grey number is the inheritance showing through, not a value this type holds. Type here to make it differ.${drifted ? ` The clay underline says Revit disagrees; switch to ⇄ live to read its number in place.` : ""}${groundedNote}`
                : `"${typeName}" overrides the family value ${authored} with ${override}. Clear the cell to go back to inheriting.${drifted ? ` The clay underline says Revit disagrees; switch to ⇄ live to read its number in place.` : ""}${groundedNote}`
          }
          onCommit={(next) => editOverride(row.name, typeName, next)}
        />,
      );
    },
  });

  // Every column carries a group, including the identity ones. A grouped table renders two
  // header rows; a column WITHOUT a group spans both, and a spanning cell distorts the first
  // row's measured height — which is exactly what the sticky offset is measured from, so the
  // group labels end up hidden under the leaf row. Uniform grouping keeps the two rows honest.
  const stateCol = (state: MasterTableState): Column<PRow> => {
    const base = stateColumn<PRow>({
      key: "state",
      label: "state",
      title:
        "The row's worst verdict across all three types — what this parameter is most asking of you. Filter it to work one kind of trouble at a time. A ghost row's state is `unbound`, which is filterable like any other: that is how you ask the table for every number in this family that nothing can reach.",
      of: (row): StateMeta =>
        row.kind === "ghost"
          ? {
              label: "unbound",
              tone: "var(--st-warn)",
              note: `UNBOUND — ${row.name} is a bindable dimension with no parameter driving it. It is not drift and it is not disagreement: both sides carry the same number. It is UNREACHABILITY, and the only verb that answers it is bind.`,
            }
          : (() => {
              const state = rowAgreement(draft, row);
              return {
                label: state,
                tone: MARK_COLOR[state],
                alarm: state === "drift",
                dim: state === "agree" || state === "unread",
                note: MARK_TITLE[state],
              };
            })(),
    });
    return {
      ...base,
      group: "PARAMETER",
      width: "w-36",
      // ROUND 4: the state column SURVIVES the live column's death, and is careful about why. It
      // carries no live VALUE — it carries the row's worst agreement, which is a diff and not a
      // reading, and it is the only thing on the page you can filter by ("show me only drift",
      // "show me only unbound"). A facet is a use a cell state cannot serve.
      sort: (row) =>
        pinnedSort(
          row,
          row.kind === "ghost" ? "unbound" : rowAgreement(draft, row),
          sortDirOf(state, "state"),
        ),
      // A ghost's state cell carries its ONE crossing. Every other row's verbs live in the doc
      // sidebar or the drill-in, because they are decisions between two substrates; binding is
      // not — there is nothing to weigh, so it belongs on the row it changes.
      cell: (row) => (row.kind === "ghost" ? ghostStateCell(row) : base.cell(row)),
    };
  };

  /**
   * The bind picker — a plain render FUNCTION, not a component, and deliberately so: a component
   * declared inside the page gets a fresh identity every render, which remounts the open `select`
   * under the pointer. It is also INLINE rather than a popover, because a popover inside a
   * scrolling table has to be positioned against a moving viewport, and the row is already exactly
   * as wide as the choice needs. Cancel is the first option, so the picker can always be left.
   *
   * The same function serves the table and the constituent inspector, so the verb is literally the
   * same verb in both places rather than two that look alike.
   */
  const bindPicker = (
    slug: string,
    property: string,
    dataType: string,
    className?: string,
  ): React.ReactNode => {
    const literal = bindingOf(draft, slug, property);
    const open = binding?.slug === slug && binding.property === property;
    const newName = paramNameFor(slug, property);
    const candidates = [...PARAM_ROWS, ...draft.newParams].filter(
      (param) => param.dataType === dataType,
    );

    if (open)
      return (
        <select
          // eslint-disable-next-line jsx-a11y/no-autofocus
          autoFocus
          value=""
          aria-label={`bind ${slug}.${property}`}
          title={`Give ${slug}.${property} a parameter. Binding to an EXISTING parameter DISCARDS the ${literal} literal and the dim starts reading that row instead — check the row says what you want before you pick. Binding to a NEW parameter KEEPS ${literal} as that parameter's family value, so the geometry does not move at all and only its reachability changes.`}
          onChange={(event) => {
            const choice = event.target.value;
            if (choice === "") setBinding(null);
            else if (choice === "#new") bindToNew(slug, property, dataType);
            else bindTo(slug, property, choice);
          }}
          className={cn(
            "tele h-6 w-full min-w-0 truncate rounded-[2px] border-0 bg-secondary px-1 text-[10px] text-foreground outline-none",
            className,
          )}
        >
          <option value="">bind to… (Esc cancels)</option>
          <option value="#new">{`＋ new parameter "${newName}", seeded ${literal}`}</option>
          {/* PREVIEW, not just a name. Binding to an existing parameter DISCARDS the literal and
              the dim starts reading that row — so the option has to say the number it is about to
              inherit, and the one it is about to lose. A picker that showed only names would be
              asking you to approve a value change you cannot see. */}
          {candidates.map((param) => (
            <option key={param.name} value={param.name}>
              {`${param.name} — inherits ${draft.authored[param.name] ?? "nothing"}${
                (draft.authored[param.name] ?? "") === literal
                  ? " (same as now)"
                  : `, discards ${literal}`
              }`}
            </option>
          ))}
        </select>
      );

    return (
      <button
        type="button"
        onClick={() => setBinding({ slug, property })}
        title={`Bind ${slug}.${property} to a parameter — its one crossing, and the only verb that changes what CAN be said about this number. Offers every ${dataType} parameter already in the profile, or a new one named "${newName}" seeded with ${literal}. The ghost row then disappears into the parameter row that now represents it.`}
        className={cn(
          "tele h-4 shrink-0 rounded-[2px] border border-[var(--line-2)] px-1 text-[9px] leading-none text-foreground hover:border-[var(--act-hover)]",
          className,
        )}
      >
        bind…
      </button>
    );
  };

  const ghostStateCell = (row: PRow): React.ReactNode => {
    const slug = row.slug ?? "";
    const property = row.property ?? "";
    const literal = bindingOf(draft, slug, property);
    if (binding?.slug === slug && binding.property === property)
      return (
        <span className="flex h-7 items-center px-1">
          {bindPicker(slug, property, row.dataType)}
        </span>
      );
    return (
      <span className="flex h-7 items-center gap-1 px-1.5">
        <StateDot tone="var(--st-warn)" />
        <span
          className="tele text-[10px] text-[var(--st-warn)]"
          title={`UNBOUND — ${literal} is frozen into the geometry of ${slug}. Nothing in the profile, no type, and no schedule can reach it.`}
        >
          unbound
        </span>
        {bindPicker(slug, property, row.dataType, "ml-auto")}
      </span>
    );
  };

  /**
   * ROUND 4: PARAMETER × TYPE, and nothing else.
   *
   * The LIVE column is gone. It was three readings folded into one 52px cell because they had no
   * honest home — and now they have one: the three cells they are readings OF, under the ⇄ live
   * overlay. What survives of it is the agreement FACET on the state column, which is a diff
   * rather than a value, and which the cell overlay genuinely cannot serve: you cannot filter a
   * table by a colour.
   */
  const columns = useMemo<Column<PRow>[]>(() => {
    const list: Column<PRow>[] = [railColumn(), identityColumn(tableState), stateCol(tableState)];
    for (const typeName of TYPE_NAMES) list.push(typeColumn(typeName, { header: true }));
    return list;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draft, saved, overlay, refusals, stageType, binding, consumers, tableState]);

  /**
   * THE DRILL-IN, on the same primitive. Same MasterTable, same identity cell, same editable type
   * cell — narrowed to one type and opened up with the spine. The crossing verbs live ONLY in the
   * pane header (capture <type> / apply <type>): a per-row verb column was tried and retired —
   * the arrows read as claims about direction the cells already carry, and a bulk decision made
   * row-by-row is the surface inventing work (round-4 user ruling). The profile column
   * right-aligns and the live column left-aligns so the two numbers MEET at the spine and every
   * row reads as one diff.
   */
  const drillColumns = useMemo<Column<PRow>[]>(() => {
    if (!drillType) return [];
    const typeName = drillType;
    return [
      railColumn(),
      identityColumn(drillState),
      typeColumn(typeName, { align: "right" }),
      {
        key: "spine",
        label: "spine",
        group: "SPINE",
        width: "w-16",
        facet: (row) => agreementOf(draft, row, typeName),
        all: "any agreement",
        title:
          "The seam. Every verb on this page is a crossing between the two sides, so the verdict is read here rather than hunted for in either column.",
        cell: (row) => {
          const state = agreementOf(draft, row, typeName);
          return (
            <span
              className="tele block px-1.5 text-center"
              style={{ color: MARK_COLOR[state] }}
              title={MARK_TITLE[state]}
            >
              {MARK[state]}
            </span>
          );
        },
      },
      {
        key: "live",
        label: "revit",
        group: "LIVE",
        width: "w-28",
        title: `What Revit carries for the ${typeName} type right now. The profile's number right-aligns and this one left-aligns, so the two meet at the spine and each row reads as ONE diff. Reconciling them is the pane header's job — capture pulls Revit's numbers into the profile, apply writes the profile's numbers into Revit.`,
        cell: (row) => {
          if (MISSING_IN_REVIT.has(row.name))
            return (
              <ReadCell
                className="italic text-[var(--st-warn)]"
                value="missing"
                reason={MARK_TITLE["only-profile"]}
              />
            );
          const entry = draft.live[row.name]?.[typeName];
          const state = agreementOf(draft, row, typeName);
          return (
            <ReadCell
              className={cn(
                entry == null && "text-muted-foreground/40",
                state === "drift" && "text-[var(--st-drift)]",
                entry?.readOnly && "italic text-muted-foreground/60",
              )}
              value={entry?.value ?? "—"}
              reason={
                entry
                  ? `${typeName} — ${entry.value}. ${MARK_TITLE[state]}`
                  : MARK_TITLE[MISSING_IN_REVIT.has(row.name) ? "only-profile" : "unread"]
              }
            />
          );
        },
      },
    ];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draft, saved, overlay, refusals, drillType, stageType, binding, consumers, drillState]);

  // ── the anatomy pane ──────────────────────────────────────────────────────────────────────────

  const anatomy = (
    <Pane
      kind="visual"
      title="anatomy"
      meta={
        anatomyCollapsed
          ? "collapsed — the header strip stays so the drawing is one click away"
          : `drawn from the ${stageType} type`
      }
      actions={
        <Verb
          label={anatomyCollapsed ? "show" : "hide"}
          onClick={() => setAnatomyCollapsed((current) => !current)}
          reason={
            anatomyCollapsed
              ? "Show the drawing again. It is drawn from the profile's own numbers for the type on stage — it is a reading of the document, not a render of Revit."
              : "Collapse the drawing. Its header strip stays, so nothing about the page's shape changes except the height."
          }
        />
      }
    >
      <AnatomyDrawing
        draft={draft}
        typeName={stageType}
        focusedParts={focusedParts}
        onFocus={setFocus}
        onInspect={(slug) => setInspect({ kind: "part", slug })}
        inspecting={inspect?.kind === "part" ? inspect.slug : null}
      />
    </Pane>
  );

  // ── the table pane, in whichever mode ─────────────────────────────────────────────────────────

  /**
   * Ghost rows are ORDINARY to the focus and rail laws and marked to the eye, and both halves of
   * that matter. The hairline opens the section; the muted band says "everything below here is a
   * number nothing can reach".
   *
   * ROUND 4 made that claim survive SORTING. It previously did not: sorting by any column
   * interleaved the ghosts, and the hairline then drew a line across the middle of nothing. Both
   * sortable columns now carry a pin rank in front of their key (see pinnedSort), so the partition
   * holds in both directions and the hairline always means the same thing.
   */
  const rowTint = (row: PRow) => {
    const lit =
      row.kind === "ghost"
        ? focusedParts.has(row.slug ?? "")
        : focusedParams.has(row.name) || pinnedParam === row.name;
    return cn(
      row.kind === "ghost" && "bg-[color-mix(in_srgb,var(--st-warn)_4%,transparent)]",
      // The hairline is drawn on whichever ghost is first IN VISIBLE ORDER, not on whichever one
      // the fixture happened to list first — sorting reorders the ghosts among themselves, and a
      // section rule that stayed on a row in the middle of the section would be drawing a boundary
      // that is not there.
      row.key === firstGhostKey && "[&>td]:border-t [&>td]:border-t-[var(--line-2)]",
      lit && "bg-[color-mix(in_srgb,var(--secondary)_70%,transparent)]",
    );
  };

  // A ghost row's focus is its CONSTITUENT — it has no parameter to light, and lighting nothing
  // would make the bottom of the table feel disconnected from the drawing it came out of.
  const hoverRow = (row: PRow | null) =>
    setFocus(
      row == null
        ? null
        : row.kind === "ghost"
          ? { kind: "part", id: row.slug ?? "" }
          : { kind: "param", id: row.name },
    );

  const crossType = (
    <MasterTable
      rows={rows}
      columns={columns}
      rowKey={(row) => row.key}
      scopeLabel="parameters"
      searchPlaceholder="parameter"
      onRowHover={hoverRow}
      rowClassName={rowTint}
      tableState={tableState}
      onTableStateChange={setTableState}
      // Idempotent on purpose: the same key back in is not a state change, so this can be fed on
      // every render of the table without the two components pushing each other round in a loop.
      onVisibleChange={(keys) => {
        const first = keys.find((key) => key.startsWith("geom:")) ?? null;
        setFirstGhostKey((previous) => (previous === first ? previous : first));
      }}
      summary={
        <span title="Read left to right: how much of this profile the spec backs, what pea still wants, how many geometry dimensions nothing can reach, how many cells save would write, and where Revit disagrees. Clay is spent on drift and nothing else; unbound and unsaved wear kiln, because a gap and a pending write are warnings rather than conflicts.">
          {Object.keys(GROUNDING).length} grounded · {openProposals.length} open ·{" "}
          {TYPE_NAMES.length} types ·{" "}
          <span className={ghostCount > 0 ? "text-[var(--st-warn)]" : undefined}>
            {ghostCount} unbound
          </span>{" "}
          ·{" "}
          <span className={unsavedCount > 0 ? "text-[var(--st-warn)]" : undefined}>
            {unsavedCount} unsaved
          </span>{" "}
          ·{" "}
          <span className={driftCells.length > 0 ? "text-[var(--st-drift)]" : undefined}>
            {driftCells.length} drift
          </span>
        </span>
      }
      empty="A profile with no parameters has nothing to audit."
    />
  );

  /** The drill-in is the SAME primitive with a narrower column set — that is the whole claim. */
  const drillIn = drillType ? (
    <MasterTable
      // Ghosts and live-only rows stay OUT of the drill-in: it is a view of one type's profile
      // against Revit, and neither of those rows has a per-type value to reconcile. A ghost here
      // would be three refusals wide in a table two columns narrow.
      rows={rows.filter((row) => row.kind === "profile")}
      columns={drillColumns}
      rowKey={(row) => row.key}
      scopeLabel={`${drillType} · parameters`}
      searchPlaceholder="parameter"
      onRowHover={hoverRow}
      rowClassName={rowTint}
      tableState={drillState}
      onTableStateChange={setDrillState}
      summary={
        <span title="What this one type is asking of you. The same counts as the cross-type table, narrowed to this column of it.">
          {openProposals.filter((entry) => (entry.typeName ?? null) === drillType).length} open ·{" "}
          <span
            className={
              driftCells.some((cell) => cell.typeName === drillType)
                ? "text-[var(--st-drift)]"
                : undefined
            }
          >
            {driftCells.filter((cell) => cell.typeName === drillType).length} drift
          </span>
        </span>
      }
      empty="No parameters to reconcile at this type."
    />
  ) : null;

  const tablePane = (
    <Pane
      kind="content"
      scroll="clip"
      bodyClassName="flex min-h-0 flex-col"
      // The type's own NAME is the title while drilled in — a pane whose title still said
      // "parameters × types" would be claiming to show something it is not.
      title={drillType ?? "parameters × types"}
      meta={
        drillType
          ? "one type, the same table — profile, spine, live"
          : overlay === "live"
            ? "LIVE OVERLAY — Revit's numbers in place, read-only; clay is where it disagrees"
            : overlay === "saved"
              ? "SAVED OVERLAY — what is on disk, read-only; kiln is what save would overwrite"
              : "every type, side by side — the spread is the audit"
      }
      actions={
        drillType ? (
          <>
            <Verb
              label="← all types"
              tone="nav"
              onClick={() => setDrillType(null)}
              reason="Leave the drill-in and return to the cross-type table. Nothing is decided by leaving — every mark you did not settle is still standing. Esc does the same."
            />
            <Verb
              label={`capture ${drillType} ←`}
              disabled={driftCells.every((cell) => cell.typeName !== drillType)}
              onClick={() => captureAll([drillType])}
              reason={
                driftCells.some((cell) => cell.typeName === drillType)
                  ? `Let Revit win on every drifting parameter of the ${drillType} type. Each live value is written into the profile as a ${drillType} override; the model is not touched.`
                  : `Nothing is drifting at ${drillType}, so there is nothing to pull back.`
              }
            />
            <Verb
              label={`apply ${drillType} →`}
              tone="commit"
              disabled={driftCells.every((cell) => cell.typeName !== drillType)}
              onClick={() => applyAll([drillType])}
              reason={
                driftCells.some((cell) => cell.typeName === drillType)
                  ? `Let the profile win at ${drillType}: the authored values are written into the family open in Revit. This MODIFIES the model, which is why it is the only verb here wearing the commit colour.`
                  : `Nothing is drifting at ${drillType}, so an apply would write values Revit already has.`
              }
            />
          </>
        ) : (
          <>
            {/* THE OVERLAY SWITCH — the law's pseudo-dimension, as three exclusive readings of the
                same cells. It is deliberately the leftmost control in the pane, because it governs
                what every value below it means, and deliberately NOT in the URL. */}
            <Switcher
              ariaLabel="value overlay"
              value={overlay}
              onChange={setOverlay}
              options={(["draft", "live", "saved"] as const).map((choice) => ({
                value: choice,
                label: OVERLAY_LABEL[choice],
                title: OVERLAY_TITLE[choice],
              }))}
            />
            {/* The bulk crossings belong to the LIVE overlay and are dark everywhere else. A
                capture-all pressed from the draft view is a bulk write whose far side you cannot
                see; the same button pressed here is one you have just been reading. */}
            <Verb
              label="capture all ←"
              disabled={overlay !== "live" || driftCells.length === 0}
              onClick={() => captureAll(TYPE_NAMES)}
              reason={
                overlay !== "live"
                  ? "Switch to the ⇄ live overlay first. Capture rewrites the profile with Revit's numbers in bulk, and this is the one view where those numbers are on screen — pressing it from here would be a write you cannot see the far side of."
                  : driftCells.length === 0
                    ? "Nothing is drifting anywhere, so there is nothing to pull back. Capture only ever moves values the two sides disagree about."
                    : `Let Revit win on all ${driftCells.length} drifting cells, across every type — every clay cell you can see right now. Each live value lands in the profile as that type's override; Revit is not touched.`
              }
            />
            <Verb
              label="apply all →"
              tone="commit"
              disabled={overlay !== "live" || driftCells.length === 0}
              onClick={() => applyAll(TYPE_NAMES)}
              reason={
                overlay !== "live"
                  ? "Switch to the ⇄ live overlay first. Apply MODIFIES the family open in Revit; the overlay is where you can see exactly which numbers it would overwrite."
                  : driftCells.length === 0
                    ? "Revit already agrees with the profile everywhere the two can be compared."
                    : `Let the profile win on all ${driftCells.length} drifting cells — every clay cell on screen goes back to the draft's number. This is the direction that writes into the model, which is why it is the only verb here in the commit colour.`
              }
            />
          </>
        )
      }
    >
      {drillIn ?? crossType}
    </Pane>
  );

  // ── the inspector: the doc pane's LOWER HALF ──────────────────────────────────────────────────
  //
  // Two subjects, one slot, because they are the same question: what is true of this THING, rather
  // than of it at some type. A constituent's non-bindable metadata has no honest column — it does
  // not vary by type, half of it is not a number, and half of THAT cannot be edited at all. A
  // parameter's family-level value has no column either, since round 3 removed the one that was
  // pretending to be a fourth type. Both land here, and the pane keeps the spec above them so a
  // citation never leaves the screen while you edit the number it justifies.

  const metaControl = (slug: string, meta: GeomMeta): React.ReactNode => {
    const value = draft.geom[slug]?.meta[meta.key] ?? meta.value;
    if (meta.control === "read")
      return (
        <span
          className="tele text-[10px] text-muted-foreground"
          title={`${meta.note} READ-ONLY — a box you could type in would be claiming an edit that nothing downstream would actually make.`}
        >
          {value} <span className="text-[9px] opacity-50">reported</span>
        </span>
      );
    if (meta.control === "toggle")
      return (
        // An exclusive choice among a fixed set, so it wears the mode treatment: the standing
        // option is a mist FILL, not a colour. It edits the document rather than the view, which
        // is why nothing here is lit — a fill says "this is where you are standing", and that
        // reading is true of a value as much as of a pane.
        <Switcher
          ariaLabel={meta.label}
          value={value}
          onChange={(option) => editMeta(slug, meta.key, option)}
          options={(meta.options ?? []).map((option) => ({
            value: option,
            label: option,
            title:
              value === option
                ? `${meta.label} is ${option} today. ${meta.note}`
                : `Set ${meta.label} to ${option}. ${meta.note}`,
          }))}
        />
      );
    return (
      <select
        value={value}
        onChange={(event) => editMeta(slug, meta.key, event.target.value)}
        title={meta.note}
        aria-label={meta.label}
        className="tele h-5 w-full rounded-[2px] border border-[var(--line-2)] bg-transparent px-1 text-[10px] outline-none focus:border-[var(--ring)]"
      >
        {(meta.options ?? []).map((option) => (
          <option key={option} value={option}>
            {option}
          </option>
        ))}
      </select>
    );
  };

  const partInspector = (part: GeomConstituent): React.ReactNode => (
    <>
      <p
        className="tele mb-1.5 text-[9px] text-[var(--st-meta)]"
        title={`${part.slug} is a ${part.kind}. The kind is READ-ONLY here: a prism does not become a cylinder because a word changed, and the profile's job is to say what the geometry is, not to pretend it can be retyped.`}
      >
        {part.kind} · {part.dims.length} bindable · {part.meta.length} non-bindable
      </p>

      <div className="mb-2 rounded-[2px] border border-[var(--line-soft)] p-1.5">
        <p
          className="tele mb-1 text-[9px] text-[var(--st-meta)]"
          title="The constituent's bindable numbers, shown here as a STATEMENT OF WHERE EACH ONE LIVES rather than as a second place to work. A bound dim names the parameter that represents it in the table; an unbound one carries its literal and the very same bind verb its ghost row carries."
        >
          bindable dims — represented in the table
        </p>
        {part.dims.map((dim) => {
          const bound = boundParam(bindingOf(draft, part.slug, dim.property));
          return (
            <div key={dim.property} className="flex items-center gap-2 py-0.5">
              <span
                className="tele w-24 shrink-0 truncate text-[9px] text-[var(--st-meta)]"
                title={dim.note}
              >
                {dim.property}
              </span>
              {bound != null ? (
                <button
                  type="button"
                  onClick={() => {
                    setInspect({ kind: "param", name: bound });
                    setPinnedParam(bound);
                  }}
                  title={`Driven by "${bound}", currently ${draft.authored[bound] ?? "—"}. Click to select that parameter: the value is edited on its row and in its own inspector, never in two places.`}
                  className="tele min-w-0 flex-1 truncate text-left text-[10px] text-[var(--foreground)] hover:text-foreground hover:underline"
                >
                  {bound}
                </button>
              ) : (
                <>
                  <span className="min-w-0 flex-1">
                    <TextCell
                      key={`${bindingOf(draft, part.slug, dim.property)}:${refusals}`}
                      value={bindingOf(draft, part.slug, dim.property)}
                      className="h-5 rounded-[2px] border border-[var(--line-2)] px-1 text-[10px] text-[var(--st-warn)]"
                      title={`UNBOUND — the literal frozen into ${part.slug}. Editable, exactly as it is on its ghost row at the bottom of the table; editing it changes the number, not who can reach it.`}
                      onCommit={(next) => editLiteral(part.slug, dim.property, next)}
                    />
                  </span>
                  {bindPicker(part.slug, dim.property, dim.dataType)}
                </>
              )}
            </div>
          );
        })}
      </div>

      <div className="rounded-[2px] border border-[var(--line-soft)] p-1.5">
        <p
          className="tele mb-1 text-[9px] text-[var(--st-meta)]"
          title="The half of the constituent no parameter can drive. It has no column in the table because it does not vary by type and it is not a number — and this is the ONLY place it appears, which is exactly the claim: it lives somewhere else."
        >
          non-bindable metadata — lives only here
        </p>
        {part.meta.map((meta) => (
          <div key={meta.key} className="flex items-baseline gap-2 py-0.5">
            <span
              className="tele w-24 shrink-0 truncate text-[9px] text-[var(--st-meta)]"
              title={meta.note}
            >
              {meta.label}
            </span>
            <span className="min-w-0 flex-1">{metaControl(part.slug, meta)}</span>
          </div>
        ))}
      </div>
    </>
  );

  const paramInspector = (name: string): React.ReactNode => {
    const row = rows.find((entry) => entry.name === name && entry.kind === "profile");
    const authored = draft.authored[name] ?? "";
    const drives = consumers.get(name) ?? [];
    const blocks = GROUNDING[name] ?? [];
    const family = proposalsAt(name, null);
    return (
      <>
        <p className="tele mb-1.5 text-[9px] text-[var(--st-meta)]">
          {row?.dataType ?? "unknown"} · bound per {row?.isInstance ? "instance" : "type"}
          {row?.group ? ` · ${row.group}` : ""}
          {MISSING_IN_REVIT.has(name) && (
            <span className="ml-1 text-[var(--st-warn)]">⊘ not in Revit</span>
          )}
        </p>

        <div className="mb-2 rounded-[2px] border border-[var(--line-soft)] p-1.5">
          <p
            className="tele mb-1 text-[9px] text-[var(--st-meta)]"
            title="THE FAMILY-LEVEL VALUE — what every type inherits unless it overrides. The table shows it only as the grey placeholder in each type cell, and a placeholder is not an editor; this is where it is actually authored. Type an expression beginning with = to make it a formula instead, which locks every type column on the row."
          >
            family value {isFormula(authored) ? "· formula" : ""}
          </p>
          <TextCell
            // Keyed on the refusal counter so a refused empty commit puts the number back in the
            // box. A box that kept showing the empty text while the model kept the old value would
            // be the one place on this page where what you see is not what is stored.
            key={`${authored}:${refusals}`}
            value={authored}
            className={cn(
              "h-6 rounded-[2px] border border-[var(--line-2)] px-1 text-[11px]",
              isFormula(authored) && "text-[var(--st-derived)]",
            )}
            title={
              isFormula(authored)
                ? `A FORMULA — ${authored}. Its result is derived, so no type may override it and Revit's number for it is an output rather than a competing value. Edit the expression here; change what feeds it to change the result.`
                : `The value every type inherits unless it authors its own. Editing it moves all ${TYPE_NAMES.filter((typeName) => draft.types[typeName]?.[name] === undefined).length} inheriting type${TYPE_NAMES.filter((typeName) => draft.types[typeName]?.[name] === undefined).length === 1 ? "" : "s"} at once — watch the grey placeholders in the table change. Begin with = to make it a formula.`
            }
            onCommit={(next) => editAuthored(name, next)}
          />
          {refusal?.key === `param:${name}` && (
            <p
              className="tele mt-1 text-[9px] leading-snug text-[var(--st-warn)]"
              title={refusal.text}
            >
              {refusal.text}
            </p>
          )}
          {family.length > 0 && (
            <p className="tele mt-1 text-[9px] text-[var(--st-proposal)]">
              pea proposes {family[0]!.proposed} here — the card is above; typing your own value
              severs it instead.
            </p>
          )}
        </div>

        <div className="mb-2 rounded-[2px] border border-[var(--line-soft)] p-1.5">
          <p
            className="tele mb-1 text-[9px] text-[var(--st-meta)]"
            title="Every geometry property this parameter drives. These have no rows of their own — this parameter IS their row — so editing the value above moves all of them together. That fan-out is the thing worth knowing before you type."
          >
            drives {drives.length} geometry propert{drives.length === 1 ? "y" : "ies"}
          </p>
          {drives.length === 0 ? (
            <p className="tele text-[10px] text-muted-foreground/60">
              Nothing in the profile&apos;s geometry reads this parameter. That is fine for schedule
              data and suspicious for a Length.
            </p>
          ) : (
            drives.map((entry) => (
              <button
                key={`${entry.slug}.${entry.property}`}
                type="button"
                onClick={() => setInspect({ kind: "part", slug: entry.slug })}
                title={`Open ${entry.slug} — its kind, its other dims, and the non-bindable metadata no parameter can drive.`}
                className="tele block w-full truncate text-left text-[10px] text-[var(--foreground)] hover:text-foreground"
              >
                → {entry.slug}.{entry.property}
              </button>
            ))
          )}
        </div>

        <div className="rounded-[2px] border border-[var(--line-soft)] p-1.5">
          <p
            className="tele mb-1 text-[9px] text-[var(--st-meta)]"
            title="Where this number came from. Grounding is its own fact, independent of any proposal — accepting or denying pea's reading never erases the citation."
          >
            grounding
          </p>
          {blocks.length === 0 ? (
            <p className="tele text-[10px] text-muted-foreground/60">
              Ungrounded — nothing in {SPEC?.fileName ?? "the spec"} claims this number. It is
              asserted, not sourced.
            </p>
          ) : (
            blocks.map((id) => (
              <p
                key={id}
                className="tele line-clamp-3 whitespace-pre-line text-[10px] leading-snug text-[var(--foreground)]"
                title={`Block ${id} of ${SPEC?.fileName ?? "the spec"}, verbatim. If it does not say what the value says, the value is wrong.`}
              >
                <span className="text-[var(--st-meta)]">{id} · </span>
                {SPEC?.blocks.find((block) => block.id === id)?.md ?? "(block not found)"}
              </p>
            ))
          )}
        </div>
      </>
    );
  };

  const inspectorPanel =
    inspect == null ? null : (
      <div className="flex max-h-[58%] min-h-0 shrink-0 flex-col border-t-2 border-[var(--line)]">
        <div className="flex h-6 shrink-0 items-center gap-2 border-b border-[var(--line-soft)] bg-muted/40 px-2">
          <span className="tele-label shrink-0 text-[9px] text-muted-foreground">
            {inspect.kind === "part" ? "constituent" : "parameter"}
          </span>
          <span className="tele min-w-0 flex-1 truncate text-[10px] text-[var(--foreground)]">
            {inspect.kind === "part" ? inspect.slug : inspect.name}
          </span>
          <button
            type="button"
            onClick={() => setInspect(null)}
            title="Close the inspector and give the pane back to the spec. Esc does the same. Nothing is decided by closing — every edit here landed the moment you made it."
            className="tele h-4 shrink-0 rounded-[2px] border border-[var(--line-2)] px-1 text-[9px] leading-none text-[var(--st-meta)] hover:border-[var(--act-hover)]"
          >
            esc ×
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto p-2">
          {inspect.kind === "part"
            ? (GEOM_BY_SLUG.get(inspect.slug) ?? null) == null
              ? "The profile declares no structured geometry for this constituent — only its prose line."
              : partInspector(GEOM_BY_SLUG.get(inspect.slug)!)
            : paramInspector(inspect.name)}
        </div>
      </div>
    );

  // ── the doc pane: ONE sidebar, two modes, proposals docked on top ──────────────────────────────

  const docPane = (
    <Pane
      kind="inspector"
      // The pane is now a COLUMN: the spec and its proposals scroll in the upper half, the
      // inspector docks under them. Neither displaces the other — an inspector that replaced the
      // spec would take away the evidence at the exact moment you edit the number it justifies.
      bodyClassName="flex min-h-0 flex-col overflow-hidden p-0"
      title="doc"
      meta={SPEC ? `${SPEC.fileName} · ${SPEC.blocks.length} blocks` : "no spec attached"}
      actions={
        <>
          <Chip
            tone="proposal"
            className="mr-1"
            title="Open proposals waiting on a verdict. They are ephemeral — page-scoped, never written, gone on reload. Only accept makes one real."
          >
            {openProposals.length} open
          </Chip>
          <Switcher
            ariaLabel="doc mode"
            value={docMode}
            onChange={setDocMode}
            options={[
              {
                value: "text",
                label: "text",
                title:
                  "Show the spec as OCR read it: markdown blocks, checkable word for word. This is what a citation actually resolves to.",
              },
              {
                value: "sheet",
                label: "sheet",
                title:
                  "Show the spec as a page: the block boxes where they sit on the sheet, so a citation can be located by eye. STAND-IN — the real surface renders the PDF here through the grounded-doc camera.",
              },
            ]}
          />
          <Verb
            label="parse"
            onClick={() =>
              say(`re-parsed ${SPEC?.fileName ?? "the spec"} — ${SPEC?.blocks.length ?? 0} blocks`)
            }
            reason="Read the source document again and rebuild its blocks. Parsing is the doc pane's own verb — it changes what can be cited, and nothing about the profile."
          />
        </>
      }
    >
      <div className="min-h-0 flex-1 overflow-y-auto">
        {/* proposals — D's margin annotations, docked as a stack above the spec */}
        <div className="border-b border-[var(--line)] p-2">
          <p
            className="tele mb-1 text-[9px] text-[var(--st-meta)]"
            title="Pea's reading of the spec, aimed at named cells. Accepting moves the value into the table where you can see it land; the citation stays lit either way, because the grounding is a separate fact from the proposal."
          >
            pea proposes — ephemeral, page-scoped
          </p>
          {WORLD.proposals.map((proposal) => (
            <ProposalCard
              key={proposal.id}
              proposal={proposal}
              verdict={verdictOf(proposal.id)}
              // A card lights either because it is the one you located, or because its whole ROW is
              // the one you located — the two-proposal case has to light both cards or the count on
              // the rail would be pointing at something the sidebar refuses to show.
              focused={focusedProposal === proposal.id || pinnedParam === proposal.param}
              blockMd={
                SPEC?.blocks.find((block) => block.id === proposal.sourceBlockId)?.md ?? null
              }
              onAccept={() => accept(proposal)}
              onDeny={() => deny(proposal)}
              onHover={(on) => {
                setFocus(on ? { kind: "param", id: proposal.param } : null);
                setFocusedProposal(on ? proposal.id : null);
              }}
              register={(node) => {
                cardRefs.current[proposal.id] = node;
              }}
            />
          ))}
        </div>

        {docMode === "text" ? (
          <SpecText litBlocks={litBlocks} />
        ) : (
          <SpecSheet litBlocks={litBlocks} zoom={docZoom} onZoom={setDocZoom} />
        )}
      </div>

      {inspectorPanel}
    </Pane>
  );

  return (
    <main className="flex h-screen min-h-0 flex-col bg-[var(--paper)] text-[var(--foreground)]">
      <header className="flex shrink-0 flex-wrap items-center gap-2 border-b border-[var(--line)] px-4 py-2">
        <span className="tele-label text-[10px] tracking-[0.3em] text-muted-foreground">
          FAMILY
        </span>
        <Sentence
          prefix={
            openProposals.length > 0 ? `${openProposals.length} proposals against` : "editing"
          }
          prefixTone={openProposals.length > 0 ? "awaiting" : "rest"}
          documentLabel={WORLD.profile.path}
          documents={[WORLD.profile.path]}
          documentsEmpty="PROTOTYPE — the fixture carries exactly one profile."
          slots={[
            {
              key: "family",
              joiner: "against",
              text: LIVE ? `${LIVE.familyName} in ${LIVE.worldLabel}` : null,
              placeholder: "nothing live",
              options: null,
              title:
                "The family open in the bound Revit session — the LIVE column and the only thing apply writes into. Without it the profile still edits; it just cannot disagree with anything.",
            },
          ]}
          target={target}
          onBind={(selector) => setTarget(selector ?? "")}
          receipt={receipt}
        />
        {LIVE && (
          <Chip title="How long ago the live family was read. Every claim in the LIVE column is only as true as this number — an old read is a weaker claim, not a wrong one.">
            live · read {LIVE.readAgo}
          </Chip>
        )}
        <Chip
          tone={draft.dirty ? "warn" : "meta"}
          title={
            draft.dirty
              ? "The profile document has changes that are not on disk — an edit, an accepted proposal, or a capture. Nothing about Revit is implied by this; it is a fact about the file."
              : "The profile on disk matches what you are looking at. Edits and accepted proposals flip this the moment they land."
          }
        >
          {draft.dirty ? "unsaved draft" : "saved"}
        </Chip>
        <Verb
          label="save profile"
          tone="commit"
          onClick={save}
          disabled={!draft.dirty}
          reason={
            draft.dirty
              ? `Write the profile back to ${WORLD.profile.path}. This commits the DOCUMENT — it touches nothing in Revit, which is what apply is for.`
              : "Nothing to save — the document already matches the file."
          }
        />
        <Chip
          dashed
          className="ml-auto"
          title="PROTOTYPE — round-2 converged variant, running on a fixture. No host, no store, no network; every verb rewrites page-local state so the flow can be judged rather than imagined."
        >
          prototype · converged
        </Chip>
      </header>

      <PaneWorkspace
        className="min-h-0 flex-1"
        visual={anatomy}
        content={tablePane}
        inspector={docPane}
        inspectorSpan="full"
        resize={{
          visual: {
            defaultSize: 240,
            minSize: 34,
            collapse: {
              collapsed: anatomyCollapsed,
              onCollapsedChange: setAnatomyCollapsed,
              collapsedSize: 34,
              collapseBelow: 90,
            },
          },
          inspector: { defaultSize: 340, minSize: 260, minOtherSize: 560 },
        }}
      />
    </main>
  );
}

// ── pieces ──────────────────────────────────────────────────────────────────────────────────────

/**
 * A cell that something has been proposed for — and NOTHING MORE. It adds two marks and no
 * behaviour: a pea-green underline along the cell, and a small notch in the top-right corner that
 * says "this exact cell is one of the contested ones". Clicking the notch LOCATES the card in the
 * sidebar; it decides nothing, because the verdict belongs beside the evidence.
 *
 * What the wrapper deliberately does NOT do is capture the cell. The child is whatever the column
 * would have rendered anyway — usually an editable input — and it stays fully editable: no click
 * handler on the wrapper to swallow a caret placement, no overlay across the text, no refocus.
 * Typing beats proposing, and a wrapper that intercepted the pointer would make that a lie.
 */
function ProposedCell({
  proposals,
  where,
  onLocate,
  unsaved,
  children,
}: {
  proposals: ProtoProposal[];
  /** Human name for the cell, for the notch's tooltip. */
  where: string;
  onLocate: (proposal: ProtoProposal) => void;
  /**
   * ROUND 4 — the saved/unsaved half of the cell-state law. A string means "saving would write
   * here", and the string itself says what. It renders as a 4px kiln square in the BOTTOM-LEFT
   * corner: diagonally opposite the proposal triangle, so the two can never overlap, never touch,
   * and never be read as one mark. Kiln because a pending write is a WARNING (it is about to
   * change the file), not a drift (--st-drift) and not a commitment (--act-commit).
   */
  unsaved?: string | null;
  children: React.ReactNode;
}) {
  const first = proposals[0];
  if (!first && !unsaved) return <>{children}</>;

  return (
    <span
      className="relative flex min-h-7 w-full items-center"
      style={first ? { boxShadow: "inset 0 -1.5px 0 0 var(--st-proposal)" } : undefined}
    >
      {children}
      {unsaved && (
        <span
          aria-hidden
          title={unsaved}
          className="absolute bottom-px left-px z-20 size-1 rounded-[1px] bg-[var(--st-warn)]"
        />
      )}
      {first && (
        <ProposalNotch first={first} count={proposals.length} where={where} onLocate={onLocate} />
      )}
    </span>
  );
}

/**
 * A refused commit, said WHERE it was refused. Absolutely positioned so it cannot change the row's
 * height, kiln because a refusal is a warning, and dismissible because a message that will not go
 * away becomes noise on the row it is trying to explain. The full reason is the title; the chip is
 * only as wide as the word.
 */
function RefusalNote({ text, onDismiss }: { text: string; onDismiss: () => void }) {
  return (
    <button
      type="button"
      onMouseDown={(event) => event.preventDefault()}
      onClick={onDismiss}
      title={`${text} — click to dismiss this mark. Your value was put back; nothing was written.`}
      className="tele absolute right-0.5 top-1/2 z-20 -translate-y-1/2 rounded-[2px] border border-[var(--st-warn)] bg-[var(--paper)] px-1 text-[9px] leading-[13px] text-[var(--st-warn)]"
    >
      ⊘ refused
    </button>
  );
}

function ProposalNotch({
  first,
  count,
  where,
  onLocate,
}: {
  first: ProtoProposal;
  count: number;
  where: string;
  onLocate: (proposal: ProtoProposal) => void;
}) {
  return (
    <>
      <button
        type="button"
        tabIndex={-1}
        // Do not take focus from the input on the way down — the notch is a pointer, not an editor.
        onMouseDown={(event) => event.preventDefault()}
        onClick={() => onLocate(first)}
        aria-label={`locate the proposal for ${where}`}
        title={`Pea proposes ${first.proposed} for ${where}${count > 1 ? ` (and ${count - 1} more on this cell)` : ""}. ${first.note} — click the notch to bring the card into the sidebar. The cell itself is ORDINARY: type your own value and the proposal is severed, with no verdict to give. The triangle survives every overlay, because a proposal is a fact about the cell rather than about which reading is showing.`}
        className="absolute right-0 top-0 z-20 size-0 border-l-[7px] border-t-[7px] border-l-transparent border-t-[var(--st-proposal)]"
      />
    </>
  );
}

// ── the doc pane's two modes ────────────────────────────────────────────────────────────────────

function SpecText({ litBlocks }: { litBlocks: Set<string> }) {
  if (!SPEC)
    return (
      <p className="tele p-3 text-[11px] text-[var(--st-meta)]">
        No spec attached — every number in the profile is asserted rather than sourced.
      </p>
    );
  return (
    <div className="space-y-2 p-2">
      {SPEC.blocks.map((block) => {
        const lit = litBlocks.has(block.id);
        return (
          <div
            key={block.id}
            title={
              lit
                ? "This is the block the focused parameter is grounded in. That correspondence is the whole claim — if the text does not say what the cell says, the cell is wrong."
                : `Page ${block.page} of ${SPEC.fileName}, as OCR read it. Hover a grounded row in the table to light the block it cites.`
            }
            className={cn(
              "rounded-[2px] border p-2",
              lit
                ? "border-[var(--st-meta)] bg-[color-mix(in_srgb,var(--secondary)_70%,transparent)]"
                : "border-[var(--line-soft)]",
            )}
          >
            <div className="tele flex items-baseline justify-between text-[9px] text-[var(--st-meta)]">
              <span>
                {block.id} · p{block.page}
              </span>
              <span>{block.kind}</span>
            </div>
            <pre className="mt-1 whitespace-pre-wrap break-words font-sans text-[10px] leading-snug text-[var(--foreground)]">
              {block.md}
            </pre>
          </div>
        );
      })}
    </div>
  );
}

/**
 * The sheet mode: a STAND-IN for the grounded-doc camera. It draws where the blocks sit on the
 * page, not what they say — enough to answer "whereabouts on the sheet did this come from", which
 * the text mode cannot answer at all. Positions are hashed from the block id, so they are
 * arbitrary but STABLE; a stand-in that moved between renders would be worse than nothing.
 */
function SpecSheet({
  litBlocks,
  zoom,
  onZoom,
}: {
  litBlocks: Set<string>;
  zoom: number;
  onZoom: (zoom: number) => void;
}) {
  if (!SPEC)
    return (
      <p className="tele p-3 text-[11px] text-[var(--st-meta)]">No spec attached to render.</p>
    );

  const pages = [...new Set(SPEC.blocks.map((block) => block.page))].sort((a, b) => a - b);

  return (
    <div className="p-2">
      <div className="mb-2 flex items-center gap-1">
        <span
          className="tele flex-1 text-[9px] text-[var(--st-warn)]"
          title="This is NOT the document. It is a placeholder showing block PLACEMENT only — the real surface renders the actual PDF page here through the grounded-doc camera, at which point these outlines become the real text."
        >
          stand-in for the page camera — placement only, not the real PDF
        </span>
        <Switcher
          ariaLabel="page zoom"
          value={zoom === 1 ? "fit" : "in"}
          onChange={(next) => onZoom(next === "fit" ? 1 : 1.6)}
          options={[
            {
              value: "fit",
              label: "fit",
              title: "Fit the whole page in the sidebar — the view for locating a citation.",
            },
            {
              value: "in",
              label: "1.6×",
              title:
                "Zoom in. The sidebar scrolls; the highlighted block stays highlighted, so zooming never loses the thing you were looking at.",
            },
          ]}
        />
      </div>

      <div className="space-y-3 overflow-x-auto">
        {pages.map((page) => {
          const blocks = SPEC.blocks.filter((block) => block.page === page);
          return (
            <div key={page} style={{ width: `${100 * zoom}%`, minWidth: 180 }}>
              <div className="tele mb-0.5 text-[9px] text-[var(--st-meta)]">page {page}</div>
              <svg
                viewBox="0 0 100 130"
                className="block w-full border border-[var(--line-2)] bg-[var(--paper)]"
                role="img"
                aria-label={`stand-in page ${page}`}
              >
                {blocks.map((block, index) => {
                  const hash = hashOf(block.id);
                  const x = 8 + (hash % 18);
                  const y = 12 + index * 34;
                  const width = Math.min(84 - (x - 8), 42 + ((hash >>> 7) % 40));
                  const height = block.kind === "table" ? 24 : block.kind === "heading" ? 7 : 14;
                  const lit = litBlocks.has(block.id);
                  return (
                    <g key={block.id}>
                      <rect
                        x={x}
                        y={y}
                        width={width}
                        height={height}
                        fill={
                          lit
                            ? "color-mix(in srgb, var(--secondary) 80%, transparent)"
                            : "transparent"
                        }
                        stroke={lit ? "var(--st-meta)" : "var(--line-2)"}
                        strokeWidth={lit ? 1 : 0.4}
                      >
                        <title>
                          {lit
                            ? `${block.id} — cited by the parameter in focus. This is roughly where it sits on page ${page}.`
                            : `${block.id} · ${block.kind} on page ${page}. Hover a grounded row in the table to light it.`}
                        </title>
                      </rect>
                      {lit && (
                        <text
                          x={x}
                          y={y - 1.5}
                          fontSize={4}
                          fill="var(--st-meta)"
                          style={{ fontFamily: "ui-monospace, monospace" }}
                        >
                          {block.id}
                        </text>
                      )}
                    </g>
                  );
                })}
              </svg>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function ProposalCard({
  proposal,
  verdict,
  focused,
  blockMd,
  onAccept,
  onDeny,
  onHover,
  register,
}: {
  proposal: ProtoProposal;
  verdict: CellVerdict;
  focused: boolean;
  blockMd: string | null;
  onAccept: () => void;
  onDeny: () => void;
  onHover: (on: boolean) => void;
  register: (node: HTMLDivElement | null) => void;
}) {
  const target = proposal.typeName
    ? `${proposal.param} · ${proposal.typeName}`
    : `${proposal.param} · family value`;

  // A settled proposal collapses to one line rather than disappearing: the sidebar keeps the
  // record that a claim was made and answered, and the citation link stays hoverable.
  if (verdict !== "open") {
    const settled = {
      accepted: {
        mark: "✓",
        word: "accepted",
        colour: "var(--st-done)",
        note: `Accepted — the table now reads ${proposal.proposed} for ${target}. The proposal itself was never persisted; only the value it argued for is in the document, and its citation is still live.`,
      },
      denied: {
        mark: "—",
        word: "denied",
        colour: "var(--st-meta)",
        note: `Denied — the profile keeps its own value for ${target}. Nothing was written, and the citation is unaffected: grounding is a fact about the spec, not about pea.`,
      },
      superseded: {
        mark: "—",
        word: "superseded by your edit",
        colour: "var(--st-meta)",
        // MUTED, never green: nothing of pea's was adopted. Accepted and superseded look
        // different because they ARE different — one is agreement, the other is being overtaken.
        note: `Superseded — you typed your own value into ${target}, so pea's ${proposal.proposed} has nothing left to argue for. There was no accept and no deny; the cell simply moved on. The grounding citation is untouched, because where a number came from is a separate fact from what pea read.`,
      },
    }[verdict];
    return (
      <div
        ref={register}
        onMouseEnter={() => onHover(true)}
        onMouseLeave={() => onHover(false)}
        className="tele flex items-baseline gap-1 py-0.5 text-[9px]"
        title={settled.note}
        style={{ color: settled.colour }}
      >
        <span>{settled.mark}</span>
        <span className="truncate">{target}</span>
        <span className="ml-auto shrink-0 opacity-70">{settled.word}</span>
      </div>
    );
  }

  return (
    <div
      ref={register}
      onMouseEnter={() => onHover(true)}
      onMouseLeave={() => onHover(false)}
      className="mb-1.5 py-1 pl-2"
      style={{
        borderLeft: "1.5px solid var(--st-proposal)",
        background: focused
          ? "color-mix(in srgb, var(--st-proposal) 12%, transparent)"
          : "transparent",
        transition: "background 0.25s",
      }}
      title="A pea proposal — ephemeral and page-scoped. It is not in the document and never will be; accepting is what writes the value, and leaving the page throws the proposal away."
    >
      <div className="tele text-[9px] text-[var(--st-meta)]">{target}</div>
      <div className="tele text-[11px] text-[var(--st-proposal)]">
        {proposal.current ?? "—"} → {proposal.proposed}
      </div>
      <p className="mt-0.5 text-[10px] leading-snug text-[var(--foreground)]">{proposal.note}</p>
      {blockMd && (
        <p
          className="tele mt-1 line-clamp-3 whitespace-pre-line text-[9px] leading-snug text-[var(--st-meta)]"
          title={`Read from ${proposal.sourceBlockId} of ${SPEC?.fileName ?? "the spec"} — the source text verbatim, so the claim is checkable without leaving the page.`}
        >
          {blockMd}
        </p>
      )}
      {/* Both verbs are page-scoped ACTS, and accept deliberately so: it STAGES the value into the
          draft, where the unsaved dot then says the file has not moved. Only `save profile` crosses
          out of the page, and it is the only thing on this sidebar wearing the commit colour —
          which is nothing. */}
      <div className="mt-1 flex gap-1">
        <Verb
          label="accept"
          onClick={onAccept}
          reason={`Write ${proposal.proposed} into the table for ${target}. You will see it land in the cell — that IS the accept; the profile then reads unsaved until you save it.`}
        />
        <Verb
          label="deny"
          onClick={onDeny}
          reason="Throw the proposal away and keep the profile as authored. The card collapses to a struck line so the sidebar still records that it was answered."
        />
      </div>
    </div>
  );
}

// ── the anatomy drawing ─────────────────────────────────────────────────────────────────────────

/**
 * An honest elevation, drawn from the numbers the table is showing for the type on stage. It is a
 * reading of the PROFILE, not a render of Revit — so when a parameter is a formula or unparseable,
 * the drawing says so rather than guessing a shape.
 */
function AnatomyDrawing({
  draft,
  typeName,
  focusedParts,
  onFocus,
  onInspect,
  inspecting,
}: {
  draft: Draft;
  typeName: string;
  focusedParts: Set<string>;
  onFocus: (focus: Focus) => void;
  /** ROUND 3: a constituent is now something you can OPEN, not just light. */
  onInspect: (slug: string) => void;
  inspecting: string | null;
}) {
  const value = (param: string) => inches(effective(draft, param, typeName));
  const bodyW = value("Body Width");
  const bodyH = value("Body Height");
  const topD = value("Top Diameter");
  const topH = value("Top Height");
  const returnZ = value("Return Elevation");
  const pipeZ = value("Pipe Elevation");
  const ductD = value("Round Duct Diameter");

  if (bodyW == null || bodyH == null)
    return (
      <p className="tele p-3 text-[11px] text-[var(--st-meta)]">
        The body's width or height is not a literal at this type, so there is no shape to draw.
        Nothing here guesses — the drawing only ever shows numbers the profile actually holds.
      </p>
    );

  // Fixed viewBox, fixed scale: the drawing must be comparable between types, so a taller type
  // draws TALLER rather than being refitted to the same box.
  const scale = 3;
  const base = 175;
  const centre = 100;
  const bodyTop = base - bodyH * scale;
  const neckH = (topH ?? 0) * scale;
  const neckW = (topD ?? 0) * scale;
  const coreTop = bodyTop - neckH;

  // The drawing keeps its own ink (clay for material, lichen for connectors) — it is a picture of
  // a thing, not a status surface. FOCUS, though, is page vocabulary: it lights as a mist fill and
  // a foreground stroke, exactly as the table's focused row does, and spends no state colour.
  const partFill = (slug: string) =>
    focusedParts.has(slug)
      ? "color-mix(in srgb, var(--secondary) 80%, transparent)"
      : "transparent";
  const partStroke = (slug: string) =>
    focusedParts.has(slug) ? "var(--foreground)" : "var(--clay-ink)";
  // Hovering LIGHTS, clicking OPENS — the same two-step the table's rows use, so the drawing is
  // not a separate interaction vocabulary you have to learn beside it.
  const hover = (slug: string) => ({
    onMouseEnter: () => onFocus({ kind: "part", id: slug }),
    onMouseLeave: () => onFocus(null),
    onClick: () => onInspect(slug),
    style: { cursor: "pointer" as const },
  });

  return (
    <div className="flex size-full min-h-0">
      <svg viewBox="0 0 200 200" className="h-full" role="img" aria-label="family elevation">
        {/* ground line — every elevation needs a datum or the connector heights mean nothing */}
        <line x1={20} y1={base} x2={180} y2={base} stroke="var(--line-2)" strokeWidth={0.5} />

        <rect
          {...hover("body")}
          x={centre - (bodyW * scale) / 2}
          y={bodyTop}
          width={bodyW * scale}
          height={bodyH * scale}
          fill={partFill("body")}
          stroke={partStroke("body")}
          strokeWidth={0.8}
        >
          <title>
            {`body — ${WORLD.profile.solids.body}. Drawn at ${bodyW}in × ${bodyH}in for the ${typeName} type; hovering it lights the parameters it consumes in the table.`}
          </title>
        </rect>

        {topD != null && topH != null && (
          <rect
            {...hover("top-neck")}
            x={centre - neckW / 2}
            y={coreTop}
            width={neckW}
            height={neckH}
            fill={partFill("top-neck")}
            stroke={partStroke("top-neck")}
            strokeWidth={0.8}
          >
            <title>
              {`top-neck — ${WORLD.profile.solids["top-neck"]}. A cylinder, drawn in elevation as its ${topD}in width by ${topH}in height.`}
            </title>
          </rect>
        )}

        {/* the void, dashed: it is a subtraction, so it must not read as material */}
        <line
          {...hover("core-bore")}
          x1={centre}
          y1={base}
          x2={centre}
          y2={coreTop}
          stroke={focusedParts.has("core-bore") ? "var(--foreground)" : "var(--line-2)"}
          strokeWidth={1}
          strokeDasharray="3 2"
        >
          <title>
            {`core-bore — ${WORLD.profile.solids["core-bore"]}. Core Height is a formula, so this is drawn from what feeds it rather than from a literal.`}
          </title>
        </line>

        {ductD != null && topD != null && (
          <circle
            {...hover("supply-air")}
            cx={centre}
            cy={coreTop}
            r={(ductD * scale) / 2}
            fill={partFill("supply-air")}
            stroke={focusedParts.has("supply-air") ? "var(--foreground)" : "var(--lichen)"}
            strokeWidth={0.8}
          >
            <title>{`supply-air — ${WORLD.profile.connectors["supply-air"]}, ${ductD}in across.`}</title>
          </circle>
        )}

        {returnZ != null && (
          <rect
            {...hover("return-air")}
            x={centre - (bodyW * scale) / 2 - 6}
            y={base - returnZ * scale - 3}
            width={6}
            height={6}
            fill={partFill("return-air")}
            stroke={focusedParts.has("return-air") ? "var(--foreground)" : "var(--lichen)"}
            strokeWidth={0.8}
          >
            <title>{`return-air — ${WORLD.profile.connectors["return-air"]}, at ${returnZ}in above the datum.`}</title>
          </rect>
        )}

        {pipeZ != null && (
          <circle
            {...hover("condensate")}
            cx={centre + (bodyW * scale) / 2 + 4}
            cy={base - pipeZ * scale}
            r={3}
            fill={partFill("condensate")}
            stroke={focusedParts.has("condensate") ? "var(--foreground)" : "var(--lichen)"}
            strokeWidth={0.8}
          >
            <title>{`condensate — ${WORLD.profile.connectors.condensate}, at ${pipeZ}in above the datum.`}</title>
          </circle>
        )}
      </svg>

      <div className="min-w-0 flex-1 overflow-y-auto border-l border-[var(--line-soft)] p-2">
        <p
          className="tele mb-1 text-[9px] text-[var(--st-meta)]"
          title="The profile's own constituent list. Hovering one lights both the shape and the table rows it drives, because there is only ever ONE thing in focus. Clicking OPENS it in the doc pane's lower half, where the half of it no parameter can drive — direction, system type, where its frame sits — is edited."
        >
          constituents · {typeName}
        </p>
        {CONSTITUENTS.map((part) => {
          const geom = GEOM_BY_SLUG.get(part.slug);
          const unbound =
            geom?.dims.filter(
              (dim) => boundParam(bindingOf(draft, part.slug, dim.property)) == null,
            ).length ?? 0;
          return (
            <button
              key={part.slug}
              type="button"
              onMouseEnter={() => onFocus({ kind: "part", id: part.slug })}
              onMouseLeave={() => onFocus(null)}
              onClick={() => onInspect(part.slug)}
              title={`${part.text} — consumes ${part.params.length > 0 ? part.params.join(", ") : "no parameter the profile names, which is worth a second look"}.${
                geom
                  ? ` Click to open it: ${geom.kind}, ${geom.dims.length} bindable dims${unbound > 0 ? ` (${unbound} of them UNBOUND — frozen literals, waiting at the bottom of the table)` : " (all bound)"}, and ${geom.meta.length} non-bindable properties that live only in the inspector.`
                  : ""
              }`}
              className={cn(
                "tele flex w-full items-center gap-1 truncate rounded-[2px] border px-1 py-0.5 text-left text-[10px]",
                // Selection is a FILL, not a hue: the open constituent sits in mist, the hovered
                // one wears a hairline. Neither is a state of the model, so neither spends colour.
                inspecting === part.slug
                  ? "border-[var(--line-2)] bg-secondary text-foreground"
                  : focusedParts.has(part.slug)
                    ? "border-[var(--line-2)] text-foreground"
                    : "border-transparent text-[var(--foreground)]",
              )}
            >
              <span className="text-[var(--st-meta)]">{part.kind} </span>
              <span className="min-w-0 truncate">{part.slug}</span>
              {unbound > 0 && (
                <span
                  className="ml-auto shrink-0 text-[9px] text-[var(--st-warn)]"
                  title={`${unbound} of this constituent's dimensions are frozen literals no parameter drives. They are the ghost rows at the bottom of the table.`}
                >
                  {unbound}⚠
                </span>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}
