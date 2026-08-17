/**
 * /family — the pure layer: what a family profile IS, and every reading of it.
 *
 * Nothing here renders and nothing here talks to a host. Everything is derived from ONE
 * `PageWorld` plus the page's `Draft`, so a verb that changes the draft visibly changes every
 * reading in the same beat — SURFACE-PHILOSOPHY §1, "compute agreement; do not remember it".
 *
 * THE WORLD IS A FACTORY ARGUMENT, NOT A MODULE CONSTANT (phase B, 2026-08-17). This layer used
 * to read `world.ts` at module scope, which made the fixture the only thing the page could ever
 * render. `buildPageWorld` now takes any `ProtoWorld` and returns everything those constants
 * carried, so the surface has exactly two lanes and one derivation:
 *
 *   LIVE     — a real `family.json` open through `route:settings`, projected by `project.ts`.
 *   FIXTURE  — `FIXTURE_WORLD`, the DECLARED no-host lane, wearing its dashed seam chip.
 *
 * Every helper below takes the world as its FIRST argument for the same reason: a helper that
 * closed over a module constant would silently keep answering about the fixture.
 */
import type { MasterTableState, VerdictTone } from "#/components/master-table/model";
import {
  WORLD,
  boundParam,
  type GeomConstituent,
  type ProposalVerdict,
  type ProtoLive,
  type ProtoLiveValue,
  type ProtoParam,
  type ProtoProposal,
  type ProtoSpec,
  type ProtoWorld,
} from "#/family/world";

// ── the ONE world factory ───────────────────────────────────────────────────────────────────────

/** A constituent the profile describes in PROSE — the anatomy list's row, and the only reading of
 * a constituent that a geometry-less profile can offer. */
export interface ProseConstituent {
  slug: string;
  kind: "solid" | "connector";
  text: string;
  params: string[];
}

/**
 * Everything the page reads about the document's SHAPE — computed once per world, never per render.
 * It carries exactly what the module constants used to carry, which is why threading it changed no
 * reading: `world.typeNames` was `TYPE_NAMES`, `world.geomBySlug` was `GEOM_BY_SLUG`, and so on.
 */
export interface PageWorld {
  /** The projection this world was built from — the page's only route back to raw fixture facts. */
  source: ProtoWorld;
  path: string;
  familyName: string;
  typeNames: string[];
  /** Where a ghost row's ONE merged literal cell is drawn: the first type column. Its neighbours
   * are suppressed, which is as close to a colspan as MasterTable can get today. */
  mergeAnchor: string;
  spec: ProtoSpec | null;
  live: ProtoLive | null;
  /** The grounding link table, independent of proposals. A citation is a fact about where a number
   * came from; accepting or denying pea's reading does not erase it. */
  grounding: Record<string, string[]>;
  missingInRevit: Set<string>;
  /** The structured constituents. Their SHAPE is the document's; only their values are drafted. */
  geom: GeomConstituent[];
  geomBySlug: Map<string, GeomConstituent>;
  params: ProtoParam[];
  paramRows: PRow[];
  liveOnlyRows: PRow[];
  constituents: ProseConstituent[];
  proposals: ProtoProposal[];
  profileDirty: boolean;
}

export function buildPageWorld(source: ProtoWorld): PageWorld {
  const params = source.profile.params;
  const geom = source.profile.geometry ?? [];
  const live = source.live;
  /** Which parameters a constituent consumes — read out of the profile's own description text, so
   * the link is the document's claim rather than a hand-authored map. */
  const paramsOf = (description: string) =>
    params.map((param) => param.name).filter((name) => description.includes(name));
  const typeNames = Object.keys(source.profile.types);
  return {
    source,
    path: source.profile.path,
    familyName: source.profile.familyName,
    typeNames,
    mergeAnchor: typeNames[0] ?? "",
    spec: source.spec,
    live,
    grounding: source.grounding ?? {},
    missingInRevit: new Set(live?.missingParams ?? []),
    geom,
    geomBySlug: new Map(geom.map((part) => [part.slug, part])),
    params,
    paramRows: params.map((param) => ({
      key: param.name,
      name: param.name,
      dataType: param.dataType,
      group: param.group ?? "other",
      isInstance: param.isInstance ?? false,
      kind: "profile" as const,
    })),
    liveOnlyRows: (live?.extraParams ?? []).map((name) => ({
      key: `live:${name}`,
      name,
      dataType: "unknown",
      group: "live only",
      isInstance: false,
      kind: "live-only" as const,
    })),
    constituents: [
      ...Object.entries(source.profile.solids).map(([slug, text]) => ({
        slug,
        kind: "solid" as const,
        text,
        params: paramsOf(text),
      })),
      ...Object.entries(source.profile.connectors).map(([slug, text]) => ({
        slug,
        kind: "connector" as const,
        text,
        params: paramsOf(text),
      })),
    ],
    proposals: source.proposals,
    profileDirty: source.profileDirty ?? false,
  };
}

/** THE DECLARED FIXTURE LANE. Built once, because `world.ts` never changes at runtime — the page
 * renders this when no family document is open, and says so with its dashed seam chip. */
export const FIXTURE_WORLD: PageWorld = buildPageWorld(WORLD);

/** "core-bore" + "stub.depth" → "Core Bore Stub Depth". The name a new parameter INHERITS from the
 * property it was lifted out of — a promoted literal should arrive already saying where it came
 * from, rather than making you invent a name at the exact moment you are trying to do something
 * else. It stays editable afterwards like any other name would be. */
export function paramNameFor(slug: string, property: string): string {
  return [...slug.split("-"), ...property.split(".")]
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

// ── agreement vocabulary ────────────────────────────────────────────────────────────────────────

/**
 * The verdict for ONE cell — one parameter at one type. SIX states.
 *
 * A seventh, `per-instance`, was briefly grown on the theory that an instance parameter's live
 * number belongs to a placed element and so cannot disagree with the family. That was wrong about
 * Revit: an instance parameter carries a per-TYPE default inside the .rfa, and in the family editor
 * it behaves like a type parameter in every way except which formulas may reference it. So its
 * live value compares against an authored default and drifts normally, and a seventh state would
 * be a category invented to excuse a fixture. The fixture was fixed instead — Airflow now authors
 * the per-type defaults the cut sheet gives, and agrees everywhere.
 */
export type Agreement = "agree" | "drift" | "derived" | "only-profile" | "only-live" | "unread";

export const MARK: Record<Agreement, string> = {
  agree: "=",
  drift: "≠",
  derived: "ƒ",
  "only-profile": "◀ only",
  "only-live": "only ▶",
  unread: "·",
};

export const MARK_TITLE: Record<Agreement, string> = {
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

/**
 * The one alarm and nothing else. `drift` MEANS "the model disagrees", so it is the only member of
 * this vocabulary allowed on `--r-alarm`; every other word is either a gap in what the profile
 * claims (caution) or a fact with no urgency (the ink ladder).
 *
 * `derived` deliberately spends NO colour: the language has no role for "a formula computed this"
 * (DESIGN-AUDIT #3), and the `ƒ` glyph plus italic already carry it. Borrowing `--r-done` — which
 * is what the retired `--st-derived` shim resolved to — would have claimed the value LANDED.
 */
export const AGREEMENT_TONE: Record<Agreement, VerdictTone> = {
  agree: "ink",
  drift: "alarm",
  derived: "ink",
  "only-profile": "caution",
  "only-live": "caution",
  unread: "mute",
};

/** Worst-first, so a row's one-word state is the thing it is most asking of you. */
export const AGREEMENT_RANK: Agreement[] = [
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
 * superseding is the user simply having gone first.
 *
 * The cell grammar cannot draw this state at all (SURFACE-PHILOSOPHY §3 owes a specimen for it;
 * DESIGN-AUDIT #7), so it lives only on the sidebar card, muted.
 */
export type CellVerdict = ProposalVerdict | "superseded";

export interface Draft {
  /** paramName → family-level authored value, or "= formula". */
  authored: Record<string, string>;
  /** typeName → paramName → override. Absent ⇒ that type inherits the authored value. */
  types: Record<string, Record<string, string>>;
  /** paramName → typeName → what Revit carries. */
  live: Record<string, Record<string, ProtoLiveValue>>;
  verdicts: Record<string, CellVerdict>;
  /**
   * The geometry's mutable half, keyed slug → { dims, meta }. Only VALUES live here; the
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

export function initialDraft(world: PageWorld): Draft {
  return {
    authored: Object.fromEntries(world.params.map((param) => [param.name, param.value])),
    types: structuredClone(world.source.profile.types),
    live: structuredClone(world.live?.values ?? {}),
    verdicts: {},
    geom: Object.fromEntries(
      world.geom.map((part) => [
        part.slug,
        {
          dims: Object.fromEntries(part.dims.map((dim) => [dim.property, dim.binding])),
          meta: Object.fromEntries(part.meta.map((entry) => [entry.key, entry.value])),
        },
      ]),
    ),
    newParams: [],
    dirty: world.profileDirty,
  };
}

/**
 * THE PSEUDO-DIMENSION, as a page-state toggle (SURFACE-PHILOSOPHY §2).
 *
 * `draft` is the staged document you edit. The other two are READINGS of the same cells against a
 * different substrate, shown in place: they replace the value and change nothing else, which is
 * what makes flipping between them a comparison rather than a navigation.
 */
export type Overlay = "draft" | "live" | "saved";

export const OVERLAY_LABEL: Record<Overlay, string> = {
  draft: "draft",
  live: "⇄ live",
  saved: "⇄ saved",
};

export const OVERLAY_TITLE: Record<Overlay, string> = {
  draft:
    "The staged document — the page-state values, editable, and the only overlay in which they are. Every mark you see here (pea's proposal folds, grounded underlines, the caution unsaved squares) is a fact about the cell and survives the other two overlays unchanged.",
  live: "Swap every value cell to what REVIT carries, in place. Read-only: editing a live number is not a thing that exists — apply is the write path, and its bulk verbs light up in this overlay because this is the only view where you can see what you would be overwriting. The alarm marks every cell where Revit disagrees with the draft; a muted dot means that parameter was not reported by the last read, which is UNKNOWN rather than absent.",
  saved:
    "Swap every value cell to what is ON DISK, in place. Read-only, because the file is not an editor. Caution marks every cell the draft would overwrite — read it as 'what save will write', which is the question the header's dirty fact can only answer with a yes or a no.",
};

/**
 * The profile as it sits on disk. Not a second document — a SNAPSHOT of the draft taken at save,
 * kept so the page can answer "what would save write" per cell rather than only per file. Storing
 * it beside the draft rather than diffing against the fixture is what makes the answer keep working
 * after the first save.
 */
export interface SavedProfile {
  authored: Record<string, string>;
  types: Record<string, Record<string, string>>;
  /** slug → property → binding, so a frozen literal's unsaved state is readable like any other. */
  geom: Record<string, Record<string, string>>;
}

export function savedFrom(draft: Draft): SavedProfile {
  return {
    authored: { ...draft.authored },
    types: structuredClone(draft.types),
    geom: Object.fromEntries(
      Object.entries(draft.geom).map(([slug, part]) => [slug, { ...part.dims }]),
    ),
  };
}

/** The binding a dim carries right now — drafted if the page has touched it, document otherwise. */
export function bindingOf(world: PageWorld, draft: Draft, slug: string, property: string): string {
  return (
    draft.geom[slug]?.dims[property] ??
    world.geomBySlug.get(slug)?.dims.find((dim) => dim.property === property)?.binding ??
    ""
  );
}

/** paramName → every constituent.property it drives. Several dims may join on one parameter, and
 * that JOIN is the fact worth surfacing: editing the row moves all of them at once. */
export function consumersOf(
  world: PageWorld,
  draft: Draft,
): Map<string, { slug: string; property: string }[]> {
  const map = new Map<string, { slug: string; property: string }[]>();
  for (const part of world.geom) {
    for (const dim of part.dims) {
      const name = boundParam(bindingOf(world, draft, part.slug, dim.property));
      if (name == null) continue;
      const list = map.get(name) ?? [];
      list.push({ slug: part.slug, property: dim.property });
      map.set(name, list);
    }
  }
  return map;
}

export function isFormula(value: string): boolean {
  return value.trimStart().startsWith("=");
}

/** What a type actually resolves to: its own override, else the family-level authored value. */
export function effective(draft: Draft, param: string, typeName: string): string {
  return draft.types[typeName]?.[param] ?? draft.authored[param] ?? "";
}

export interface PRow {
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

/**
 * THE GHOST ROWS: every bindable dim no parameter drives, in constituent order, at the BOTTOM.
 *
 * They are derived, never stored — binding one makes it disappear from here on the next render,
 * which is the whole visible payoff of the verb. The bottom of the table is therefore always
 * exactly "the numbers in this family that nothing can reach", and it empties as you work.
 */
export function ghostRows(world: PageWorld, draft: Draft): PRow[] {
  const rows: PRow[] = [];
  for (const part of world.geom) {
    for (const dim of part.dims) {
      if (boundParam(bindingOf(world, draft, part.slug, dim.property)) != null) continue;
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
export function agreementOf(
  world: PageWorld,
  draft: Draft,
  row: PRow,
  typeName: string,
): Agreement {
  // A ghost is a literal in the geometry: Revit's family HAS this number, but no read reports it
  // as a parameter because it is not one. "unread" is the honest state — not agreement.
  if (row.kind === "ghost") return "unread";
  if (row.kind === "live-only") return "only-live";
  const authored = draft.authored[row.name] ?? "";
  if (isFormula(authored)) return "derived";
  const entry = draft.live[row.name]?.[typeName];
  if (!entry) return world.missingInRevit.has(row.name) ? "only-profile" : "unread";
  if (entry.readOnly) return "derived";
  return entry.value === effective(draft, row.name, typeName) ? "agree" : "drift";
}

export function rowAgreement(world: PageWorld, draft: Draft, row: PRow): Agreement {
  const seen = new Set(world.typeNames.map((typeName) => agreementOf(world, draft, row, typeName)));
  return AGREEMENT_RANK.find((state) => seen.has(state)) ?? "agree";
}

// ── the three readings of one cell ──────────────────────────────────────────────────────────────
//
// One function per substrate, all keyed the same way (row × type), so the overlay is a choice of
// FUNCTION and nothing else. That is why the swap costs no layout: the cell asks a different
// question of the same coordinates and renders in the same box.

/** What the staged document resolves to here — a ghost's literal, or the type's effective value. */
export function draftValueAt(
  world: PageWorld,
  draft: Draft,
  row: PRow,
  typeName: string,
): string | null {
  if (row.kind === "ghost") return bindingOf(world, draft, row.slug ?? "", row.property ?? "");
  if (row.kind === "live-only") return null;
  return effective(draft, row.name, typeName);
}

/** What the file on disk carries here. `null` means the row itself is not on disk at all — a
 * promoted literal, whose whole parameter is new — which is a different fact from a changed value
 * and must not be shown as one. */
export function savedValueAt(saved: SavedProfile, row: PRow, typeName: string): string | null {
  if (row.kind === "ghost") return saved.geom[row.slug ?? ""]?.[row.property ?? ""] ?? null;
  if (row.kind === "live-only") return null;
  if (!(row.name in saved.authored)) return null;
  return saved.types[typeName]?.[row.name] ?? saved.authored[row.name] ?? "";
}

/** true when saving would write something into this cell — including "the row is new". */
export function isUnsavedAt(
  world: PageWorld,
  draft: Draft,
  saved: SavedProfile,
  row: PRow,
  typeName: string,
): boolean {
  if (row.kind === "live-only") return false;
  const disk = savedValueAt(saved, row, typeName);
  return disk === null || disk !== draftValueAt(world, draft, row, typeName);
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
export function pinnedSort(row: PRow, value: string, dir: "asc" | "desc"): string {
  const rank = PIN_RANK[row.kind];
  return `${String.fromCharCode(48 + (dir === "desc" ? 2 - rank : rank))}\u0000${value}`;
}

/** The direction a column is about to be read in — the input `pinnedSort` needs, which is why
 * this surface owns its `MasterTableState` rather than letting the table keep it private. */
export function sortDirOf(state: MasterTableState, key: string): "asc" | "desc" {
  return state.sorts.find((sort) => sort.key === key)?.dir ?? "asc";
}

// ── anatomy geometry, parsed out of the profile's own numbers ───────────────────────────────────

/** "24in" → 24; a formula or anything unparseable → null, and the drawing says so. */
export function inches(value: string | undefined): number | null {
  if (value == null || isFormula(value)) return null;
  const match = /-?\d+(\.\d+)?/.exec(value);
  return match ? Number(match[0]) : null;
}

/** ONE focus for the whole page: either a parameter or a constituent is lit, never both
 * independently. Everything else derives its highlight from this. */
export type Focus = { kind: "param"; id: string } | { kind: "part"; id: string } | null;

/**
 * The focus map reads the BINDINGS rather than the prose description text. The prose link was a
 * string match against a sentence — good enough to prove the idea, and wrong the moment a binding
 * moves. A dim that you rebind lights differently on the very next render, which is what makes
 * "bind" feel like it did something to the model rather than to a list.
 */
export function paramsInFocus(world: PageWorld, focus: Focus, draft: Draft): Set<string> {
  if (!focus) return new Set();
  if (focus.kind === "param") return new Set([focus.id]);
  const part = world.geomBySlug.get(focus.id);
  if (part) {
    const names = part.dims
      .map((dim) => boundParam(bindingOf(world, draft, part.slug, dim.property)))
      .filter((name): name is string => name != null);
    return new Set(names);
  }
  return new Set(world.constituents.find((entry) => entry.slug === focus.id)?.params ?? []);
}

export function partsInFocus(
  focus: Focus,
  consumers: Map<string, { slug: string; property: string }[]>,
): Set<string> {
  if (!focus) return new Set();
  if (focus.kind === "part") return new Set([focus.id]);
  return new Set((consumers.get(focus.id) ?? []).map((entry) => entry.slug));
}

/** Deterministic jitter for the stand-in page camera — it must put a block in the SAME place every
 * render, or it stops standing in for a document and starts being noise. */
export function hashOf(text: string): number {
  let hash = 2166136261;
  for (let index = 0; index < text.length; index += 1) {
    hash = Math.imul(hash ^ text.charCodeAt(index), 16777619) >>> 0;
  }
  return hash;
}
