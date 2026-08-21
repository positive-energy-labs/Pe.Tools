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
export type GeomKind = string;

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

export interface ProtoProfile {
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
  readAgo: string;
  /** paramName → typeName → live value */
  values: Record<string, Record<string, ProtoLiveValue>>;
  /** params that exist in Revit but not in the profile */
  extraParams: string[];
  /** params in the profile that Revit does not have */
  missingParams: string[];
}

export interface SpecBlock {
  id: string;
  page: number;
  kind: "heading" | "table" | "text";
  md: string;
}

export interface ProtoSpec {
  fileName: string;
  blocks: SpecBlock[];
}

/** Pea's proposal — EPHEMERAL, page-scoped. Links a profile cell to the spec text it came from. */
export interface ProtoProposal {
  id: string;
  /** paramName, plus typeName when it targets a type override */
  param: string;
  typeName?: string;
  current: string | null;
  proposed: string;
  sourceBlockId: string;
  note: string;
}

export type ProposalVerdict = "open" | "accepted" | "denied";

export interface ProtoWorld {
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

// ── fixture ─────────────────────────────────────────────────────────────────────────────────────

const PARAMS: ProtoParam[] = [
  { name: "Body Width", dataType: "Length", value: "24in", group: "dimensions" },
  { name: "Body Depth", dataType: "Length", value: "18in", group: "dimensions" },
  { name: "Body Height", dataType: "Length", value: "30in", group: "dimensions" },
  { name: "Top Diameter", dataType: "Length", value: "8in", group: "dimensions" },
  { name: "Top Height", dataType: "Length", value: "4in", group: "dimensions" },
  {
    name: "Core Height",
    dataType: "Length",
    value: "= Body Height + Top Height",
    group: "dimensions",
  },
  { name: "Return Elevation", dataType: "Length", value: "15in", group: "connections" },
  { name: "Pipe Elevation", dataType: "Length", value: "8in", group: "connections" },
  { name: "Round Duct Diameter", dataType: "Length", value: "6in", group: "connections" },
  { name: "Stub Depth", dataType: "Length", value: "2in", group: "connections" },
  {
    name: "Airflow",
    dataType: "Air Flow",
    value: "450 CFM",
    isInstance: true,
    group: "mechanical",
  },
  // 240 V, deliberately WRONG against the cut sheet. p3 proposes 277 V, and a proposal whose
  // current and proposed values were identical was a no-op dressed as a decision — accepting it
  // moved nothing, so the surface could not be judged on whether accepting is VISIBLE.
  { name: "Voltage", dataType: "Electrical Potential", value: "240 V", group: "electrical" },
];

/**
 * The structured constituents, mirroring the prose ones one for one.
 *
 * TWO dims are deliberately UNBOUND, because the ghost-row law needs material to be judged on:
 *   core-bore.diameter    — "3in" frozen into the void. The prose says the bore "runs Core
 *                           Height", and it does — but its WIDTH was never given a parameter, so
 *                           no type can change it and nothing in the table would ever have said so.
 *   condensate.stub.depth — "1.5in", while its two duct siblings both bind Stub Depth. One
 *                           connector quietly disagreeing with the other two is exactly the kind
 *                           of thing a family carries for years without anyone seeing it.
 */
const GEOMETRY: GeomConstituent[] = [
  {
    slug: "body",
    kind: "Prism",
    dims: [
      {
        property: "width",
        dataType: "Length",
        binding: "param:Body Width",
        note: "X extent of the cabinet.",
      },
      {
        property: "depth",
        dataType: "Length",
        binding: "param:Body Depth",
        note: "Y extent of the cabinet.",
      },
      {
        property: "height",
        dataType: "Length",
        binding: "param:Body Height",
        note: "Extrusion depth, +Z off the base sketch.",
      },
    ],
    meta: [
      {
        key: "origin",
        label: "frame origin",
        control: "read",
        value: "family origin · base on the reference level",
        note: "Where the constituent's own frame sits. Read-only here because moving it is a sketch edit in the family editor, not a value — a text box pretending otherwise would be lying about what would happen.",
      },
      {
        key: "normal",
        label: "extrusion normal",
        control: "read",
        value: "+Z",
        note: "The direction the sketch is extruded along. Computed from the work plane, so it is reported rather than chosen.",
      },
    ],
  },
  {
    slug: "top-neck",
    kind: "Cylinder",
    dims: [
      {
        property: "diameter",
        dataType: "Length",
        binding: "param:Top Diameter",
        note: "Outside diameter of the discharge neck.",
      },
      {
        property: "height",
        dataType: "Length",
        binding: "param:Top Height",
        note: "How far the neck stands off the cabinet's top face.",
      },
    ],
    meta: [
      {
        key: "origin",
        label: "frame origin",
        control: "read",
        value: "top face of body · on the vertical centreline",
        note: "The neck is hosted on the body's top face, so its origin MOVES when Body Height moves. That dependency is geometry, not a value you can type.",
      },
      {
        key: "axis",
        label: "axis",
        control: "read",
        value: "+Z",
        note: "The cylinder's axis, reported from its sketch plane.",
      },
    ],
  },
  {
    slug: "core-bore",
    kind: "VoidCylinder",
    dims: [
      {
        property: "diameter",
        dataType: "Length",
        binding: "3in",
        note: "UNBOUND — the bore's width is frozen at 3in in the geometry. No type can differ, no schedule can read it, and no formula can reach it.",
      },
      {
        property: "length",
        dataType: "Length",
        binding: "param:Core Height",
        note: "How far the void runs; driven by the Core Height formula.",
      },
    ],
    meta: [
      {
        key: "origin",
        label: "frame origin",
        control: "read",
        value: "base of body · on the vertical centreline",
        note: "The void starts at the datum and runs up. Its placement is a sketch fact.",
      },
      { key: "axis", label: "axis", control: "read", value: "+Z", note: "The void's axis." },
      {
        key: "cuts",
        label: "cuts",
        control: "select",
        value: "body + top-neck",
        options: ["body", "top-neck", "body + top-neck"],
        note: "Which solids this void actually subtracts from. A void that cuts nothing is invisible in every view and still ships in the file — which is why this is chosen, not inferred.",
      },
    ],
  },
  {
    slug: "supply-air",
    kind: "DuctConnector",
    dims: [
      {
        property: "diameter",
        dataType: "Length",
        binding: "param:Round Duct Diameter",
        note: "Round connector diameter.",
      },
      {
        property: "stub.depth",
        dataType: "Length",
        binding: "param:Stub Depth",
        note: "How far the stub runs before the connector face.",
      },
    ],
    meta: [
      {
        key: "flowDirection",
        label: "flow direction",
        control: "toggle",
        value: "Out",
        options: ["In", "Out"],
        note: "Which way air crosses this connector. Get it backwards and the system still connects — it just solves the wrong way round, silently.",
      },
      {
        key: "systemType",
        label: "system type",
        control: "select",
        value: "SupplyAir",
        options: ["SupplyAir", "ReturnAir", "ExhaustAir"],
        note: "The system classification Revit matches on when it decides what may connect to what.",
      },
      {
        key: "normal",
        label: "normal",
        control: "read",
        value: "+Z",
        note: "The connector's outward normal, taken from its host face.",
      },
      {
        key: "origin",
        label: "frame origin",
        control: "read",
        value: "top of top-neck",
        note: "Hosted on the neck's top face.",
      },
    ],
  },
  {
    slug: "return-air",
    kind: "DuctConnector",
    dims: [
      {
        property: "diameter",
        dataType: "Length",
        binding: "param:Round Duct Diameter",
        note: "Shares the supply connector's diameter parameter — one number, two consumers.",
      },
      {
        property: "elevation",
        dataType: "Length",
        binding: "param:Return Elevation",
        note: "Centreline height above the datum.",
      },
      {
        property: "stub.depth",
        dataType: "Length",
        binding: "param:Stub Depth",
        note: "How far the stub runs before the connector face.",
      },
    ],
    meta: [
      {
        key: "flowDirection",
        label: "flow direction",
        control: "toggle",
        value: "In",
        options: ["In", "Out"],
        note: "Air enters here. The supply connector says Out; a family where both say the same thing is a family that cannot be solved.",
      },
      {
        key: "systemType",
        label: "system type",
        control: "select",
        value: "ReturnAir",
        options: ["SupplyAir", "ReturnAir", "ExhaustAir"],
        note: "The system classification Revit matches on when it decides what may connect to what.",
      },
      {
        key: "normal",
        label: "normal",
        control: "read",
        value: "−X",
        note: "Faces out of the cabinet's left side.",
      },
      {
        key: "origin",
        label: "frame origin",
        control: "read",
        value: "left face of body · at Return Elevation",
        note: "Hosted on the body's left face.",
      },
    ],
  },
  {
    slug: "condensate",
    kind: "PipeConnector",
    dims: [
      {
        property: "elevation",
        dataType: "Length",
        binding: "param:Pipe Elevation",
        note: "Centreline height above the datum.",
      },
      {
        property: "stub.depth",
        dataType: "Length",
        binding: "1.5in",
        note: "UNBOUND — 1.5in frozen here, while both duct connectors bind Stub Depth. Nothing in the family says the three should agree, and nothing has ever shown that they do not.",
      },
    ],
    meta: [
      {
        key: "flowDirection",
        label: "flow direction",
        control: "toggle",
        value: "Out",
        options: ["In", "Out"],
        note: "Condensate leaves the unit. A drain authored as In is a drain the analysis will try to feed.",
      },
      {
        key: "systemType",
        label: "system type",
        control: "select",
        value: "SanitaryDrainage",
        options: ["SanitaryDrainage", "HydronicReturn", "DomesticColdWater"],
        note: "The piping system classification. It decides what may connect, and it is the field most often left at the template's default.",
      },
      {
        key: "normal",
        label: "normal",
        control: "read",
        value: "+X",
        note: "Faces out of the cabinet's right side.",
      },
      {
        key: "origin",
        label: "frame origin",
        control: "read",
        value: "right face of body · at Pipe Elevation",
        note: "Hosted on the body's right face.",
      },
    ],
  },
];

export const WORLD: ProtoWorld = {
  profile: {
    path: "mechanical/fan-coil-fc42.family.json",
    familyName: "PE Fan Coil FC42",
    category: "Mechanical Equipment",
    template: "Generic Model",
    placement: "Unhosted",
    params: PARAMS,
    types: {
      // Airflow carries per-TYPE defaults, like every instance parameter authored in a .rfa: the
      // family editor holds a default per type and a placed element may then depart from it. So
      // its live numbers compare and drift exactly like a type parameter's, and the fixture
      // authors the ones the cut sheet gives (300/450/600) so Airflow AGREES everywhere — the
      // three real drifts stay the only clay marks on the page.
      Compact: {
        "Body Width": "18in",
        "Body Depth": "14in",
        "Body Height": "24in",
        Airflow: "300 CFM",
      },
      Standard: {},
      Tall: { "Body Height": "42in", "Return Elevation": "24in", Airflow: "600 CFM" },
    },
    solids: {
      body: "Prism · Body Width × Body Depth × Body Height",
      "top-neck": "Cylinder · Top Diameter × Top Height",
      "core-bore": "VoidCylinder · runs Core Height",
    },
    connectors: {
      "supply-air": "Duct · Round Duct Diameter · SupplyAir · out",
      "return-air": "Duct · at Return Elevation · ReturnAir · in",
      condensate: "Pipe · at Pipe Elevation · Condensate",
    },
    geometry: GEOMETRY,
  },

  live: {
    familyName: "PE Fan Coil FC42",
    worldLabel: "office-tower.rvt",
    readAgo: "2m ago",
    values: {
      "Body Width": {
        Compact: { value: "18in" },
        Standard: { value: "24in" },
        Tall: { value: "24in" },
      },
      "Body Height": {
        Compact: { value: "24in" },
        Standard: { value: "30in" },
        Tall: { value: "40in", drift: true }, // Revit says 40, profile says 42
      },
      "Return Elevation": {
        Compact: { value: "15in" },
        Standard: { value: "15in" },
        Tall: { value: "22in", drift: true }, // profile says 24
      },
      "Round Duct Diameter": {
        Compact: { value: "6in" },
        Standard: { value: "6in" },
        Tall: { value: "8in", drift: true }, // profile has no Tall override → 6in authored
      },
      Airflow: {
        Compact: { value: "300 CFM" },
        Standard: { value: "450 CFM" },
        Tall: { value: "600 CFM" },
      },
      "Core Height": {
        Compact: { value: "28in", readOnly: true },
        Standard: { value: "34in", readOnly: true },
        Tall: { value: "44in", readOnly: true },
      },
    },
    extraParams: ["Manufacturer URL", "Keynote"],
    missingParams: ["Voltage"],
  },

  spec: {
    fileName: "FC42-cut-sheet.pdf",
    blocks: [
      { id: "b1", page: 1, kind: "heading", md: "## FC42 Horizontal Fan Coil — Physical Data" },
      {
        id: "b2",
        page: 1,
        kind: "table",
        md: "| Unit | W | D | H |\n|---|---|---|---|\n| FC42-C | 18 | 14 | 24 |\n| FC42-S | 24 | 18 | 30 |\n| FC42-T | 24 | 18 | 42 |",
      },
      {
        id: "b3",
        page: 2,
        kind: "text",
        md: 'Return connection centreline at 15" AFF on C/S cabinets; 24" on the tall cabinet.',
      },
      {
        id: "b4",
        page: 2,
        kind: "table",
        md: '| Unit | Airflow | Duct Ø |\n|---|---|---|\n| FC42-C | 300 CFM | 6" |\n| FC42-S | 450 CFM | 6" |\n| FC42-T | 600 CFM | 8" |',
      },
      { id: "b5", page: 3, kind: "text", md: "Electrical: 277 V / 1 ph / 60 Hz across all sizes." },
    ],
  },

  grounding: {
    "Body Width": ["b2"],
    "Body Depth": ["b2"],
    "Body Height": ["b2"],
    "Return Elevation": ["b3"],
    "Round Duct Diameter": ["b4"],
    Airflow: ["b4"],
    Voltage: ["b5"],
  },
  profileDirty: false,

  proposals: [
    {
      id: "p1",
      param: "Round Duct Diameter",
      typeName: "Tall",
      current: null,
      proposed: "8in",
      sourceBlockId: "b4",
      note: 'Cut sheet gives the tall cabinet an 8" duct; the profile has no Tall override so it inherits 6in.',
    },
    {
      id: "p2",
      param: "Body Height",
      typeName: "Tall",
      current: "42in",
      proposed: "42in",
      sourceBlockId: "b2",
      note: "Confirms the authored 42in — Revit currently carries 40in, which drifts from both.",
    },
    {
      id: "p3",
      param: "Voltage",
      current: "240 V",
      proposed: "277 V",
      sourceBlockId: "b5",
      note: "The profile authors 240 V; the cut sheet says 277 V across all sizes. A real correction at the FAMILY level — accepting it moves every type that does not override, which is all three. Revit does not carry this parameter at all, so nothing there contradicts either reading.",
    },
    // A SECOND proposal on a row that already carries one (p1), at a different type — the
    // multi-proposal case the verdict rail has to survive. It is also deliberately WEAK: b4's own
    // table gives the compact cabinet a 6" duct, so the card's verbatim source text contradicts
    // the reading. A surface that shows its evidence lets you deny this in one glance, which is
    // the point of citing at all.
    {
      id: "p4",
      param: "Round Duct Diameter",
      typeName: "Compact",
      current: null,
      proposed: "5in",
      sourceBlockId: "b4",
      note: 'LOW CONFIDENCE — read the compact cabinet\'s duct as 5", but the block below gives FC42-C a 6" duct. Check the text before accepting; the two readings cannot both be right.',
    },
  ],
};
