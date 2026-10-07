/**
 * PROTOTYPE — clean-room /family exploration. Throwaway; lives behind `/family?variant=`.
 *
 * One shared mock world all variants render, so flipping variants compares STRUCTURE, not data.
 *
 * The product reframe under test:
 *   PROFILE  — the portable unit (family.json). Versionable, pea-editable, grounded in a spec.
 *   LIVE     — the family open in Revit (or a loaded .rfa). Real, driftable, the proof.
 *   Verbs are CROSSINGS between the two: capture (live→profile), apply/materialize
 *   (profile→live), build (profile→evidence), ground (spec→profile), propose (pea→profile,
 *   EPHEMERAL — page-scoped, never persisted).
 */

// ── substrates ──────────────────────────────────────────────────────────────────────────────────

export interface ProtoParam {
  name: string;
  dataType: string;
  /** Family-level value, or formula text prefixed "=" — one or the other. */
  value: string;
  isInstance?: boolean;
  group?: string;
}

/**
 * GEOMETRY (round-3 exposure pass). The prose `solids`/`connectors` records say what a
 * constituent IS, in one human line. This says what it is MADE OF, in two halves that behave
 * completely differently and therefore must not be one list:
 *
 *   BINDABLE dims  — a number a family parameter can drive. Either it is driven today
 *                    (`param:<Name>`) or it is a literal frozen into the geometry. That binary is
 *                    the whole point: an unbound dim is a number no schedule, no type, and no
 *                    formula can reach, and a surface that shows it beside the bound ones is the
 *                    only way to notice.
 *   NON-BINDABLE   — direction, system type, a normal, where the frame sits. No parameter can
 *                    drive these; they are authored on the constituent itself and nowhere else.
 *
 * The prose records stay exactly as they were — variants a–d read them, and this section is
 * additive. Where the two overlap they agree by construction: this fixture mirrors the prose.
 */
/**
 * The constituent's kind, VERBATIM from the document. Widened from a five-member union to a
 * string in phase B: the union was this fixture's inventory, and the real schema carries kinds it
 * never named (`VoidPrism`, an `Electrical` connector). The kind is display-only — nothing
 * branches on it — so narrowing it bought type safety over a set that was never closed.
 */
type GeomKind = string;

/** `param:<Name>` when a family parameter drives the dim; anything else is a frozen literal. */
export type GeomBinding = string;

export interface GeomDim {
  /** Property on the constituent, in its own vocabulary: "width", "diameter", "stub.depth". */
  property: string;
  dataType: string;
  binding: GeomBinding;
  /** What the dim MEANS on this kind of constituent — the tooltip's honest half. */
  note: string;
}

export interface GeomMeta {
  key: string;
  label: string;
  /**
   * How honestly it can be edited. `read` is not a permission — it is a claim that typing here
   * would be dishonest (a normal is computed from the sketch plane, not chosen from a box).
   */
  control: "toggle" | "select" | "read";
  value: string;
  options?: string[];
  note: string;
}

export interface GeomConstituent {
  slug: string;
  kind: GeomKind;
  dims: GeomDim[];
  meta: GeomMeta[];
}

/** "param:Body Width" → "Body Width"; a literal → null. */
export function boundParam(binding: GeomBinding): string | null {
  return binding.startsWith("param:") ? binding.slice("param:".length) : null;
}

interface ProtoProfile {
  path: string;
  familyName: string;
  category: string;
  template: string;
  placement: string;
  params: ProtoParam[];
  /** typeName → paramName → override value */
  types: Record<string, Record<string, string>>;
  /** constituent slug → short human description (feeds anatomy-ish surfaces) */
  solids: Record<string, string>;
  connectors: Record<string, string>;
  /** ROUND 3: the structured half of the same constituents. Optional — a profile may be prose-only. */
  geometry?: GeomConstituent[];
}

export interface ProtoLiveValue {
  value: string;
  /** true when Revit's value disagrees with the profile's authored value for that cell */
  drift?: boolean;
  readOnly?: boolean;
}

export interface ProtoLive {
  familyName: string;
  worldLabel: string;
  /** Captured types, including types with no reported literal values. */
  typeNames?: string[];
  /** paramName → typeName → live value */
  values: Record<string, Record<string, ProtoLiveValue>>;
  /** params that exist in Revit but not in the profile */
  extraParams: string[];
  /** params in the profile that Revit does not have */
  missingParams: string[];
  /**
   * paramName -> the unit the READING'S OWN DOCUMENT renders it in, so a measured cell can stage a
   * bare number in the unit grammar a family value is written in ("300 CFM"). Absent for anything
   * unmeasurable, and for a source that reports no units.
   */
  units?: Record<
    string,
    { specTypeId: string; typeId?: string | null; label?: string | null; symbol?: string | null }
  >;
}

export type ProtoSpec = import("@pe/agent-contracts").ParsedDocView;

/** Pea's proposal — EPHEMERAL, page-scoped. Links a profile cell to the spec text it came from. */
export interface ProtoProposal {
  id: string;
  /** paramName, plus typeName when it targets a type override */
  param: string;
  typeName?: string;
  /** A proposal for a constituent (`/nested|connectors|forms/<slug>`): `param` is empty, and the
   * constituents list, not the parameters grid, draws it. */
  constituent?: { section: "nested" | "connectors" | "forms"; slug: string; property?: string };
  /** `/parameters/<name>/<property>` (isInstance, formula, propertiesGroup...): a proposal about
   * that property of the parameter, never about its family-level value. */
  property?: string;
  /** What the reading holds at the pointer, when it holds anything: the cell's tooltip says it. */
  current: string | null;
  proposed: string;
  sourceBlockId: string;
  note: string;
  /** Pea's own confidence in the reading. Contract-shaped (`cellProposalSchema`), so the shared
   * cell reader carries it to the cell without family re-deriving it from the prose. */
  confidence?: "high" | "low";
}

export interface FamilySpecModel {
  profile: ProtoProfile;
  live: ProtoLive | null;
  spec: ProtoSpec | null;
  proposals: ProtoProposal[];
  /** ROUND 2: param → spec block ids. The grounding LINK TABLE, independent of proposals —
   * a citation survives its proposal being accepted, and grounded-but-unproposed is real. */
  grounding?: Record<string, string[]>;
  /** ROUND 2: unsaved-draft fact for the profile document. */
  profileDirty?: boolean;
}
