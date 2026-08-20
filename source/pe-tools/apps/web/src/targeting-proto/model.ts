/**
 * PROTOTYPE — targeting-grammar round 3 shared model. Throwaway with the round.
 *
 * The five product manifests (fixtures, no host) every paradigm renders. Paradigms may NOT
 * invent product semantics — nouns, directions, stages, and demands live here only, so
 * variants compare RENDERING, never data. Round-2 verdicts baked in: granularity order is
 * the `rank`; direction is nullable (a world, or the rvt an rfa opens from, has no data
 * direction); stage relevance is verb-demand-derived; idle bindings render DIMMED, not hidden.
 */

export type Liveness = "attached" | "detached";
export type DataDir = "read" | "write" | "read+write" | "sync" | null;

export interface MockNoun {
  key: string;
  /** Granularity rank, big → small; every paradigm renders in this order. */
  rank: number;
  /** Prose joiner (round-2 winner keeps joiners). */
  joiner: string;
  label: string | null;
  placeholder: string;
  liveness: Liveness | null;
  dir: DataDir;
  /** Multi-pick slot: options carry checkboxes, the noun shows "n of m". */
  multi?: boolean;
  options: { id: string; label: string; sub?: string }[];
  empty: string;
}

export interface MockVerb {
  key: string;
  label: string;
  /** Noun keys this verb needs bound — the verbs-demand relevance model. */
  demands: string[];
}

export interface MockStage {
  key: string;
  label: string;
  verbs: MockVerb[];
}

export interface MockProduct {
  key: string;
  name: string;
  /** One line of what this product stresses in the paradigm — render it as a caption. */
  stress: string;
  nouns: MockNoun[];
  stages: MockStage[];
}

/** Two-axis annotation text: data-direction · liveness, either may be absent. */
export function annotation(noun: MockNoun): string {
  const parts: string[] = [];
  if (noun.dir) parts.push(noun.dir);
  if (noun.liveness) parts.push(noun.liveness);
  return parts.join(" · ") || "—";
}

/** Writes and syncs are the loud half of the taxonomy. */
export function annotationColor(noun: MockNoun): string {
  if (noun.dir === "write" || noun.dir === "sync" || noun.dir === "read+write")
    return "var(--r-ink)";
  return "var(--r-ink-2)";
}

/** The union of the mounted stage's verb demands — what "relevant right now" means. */
export function demandedKeys(stage: MockStage): Set<string> {
  return new Set(stage.verbs.flatMap((v) => v.demands));
}

export const PRODUCTS: MockProduct[] = [
  {
    key: "takeoffs",
    name: "takeoffs",
    stress: "the worst case — five bindings, three directions, a detached sync target",
    nouns: [
      {
        key: "world",
        rank: 0,
        joiner: "in",
        label: "R24 · pid 41232",
        placeholder: "pick a world",
        liveness: "attached",
        dir: null,
        options: [
          { id: "w1", label: "R24 · pid 41232", sub: "ProjectA_Cloud" },
          { id: "w2", label: "R23 · pid 8804", sub: "empty session" },
        ],
        empty: "no live worlds — start one from /instances",
      },
      {
        key: "rvt",
        rank: 1,
        joiner: "editing",
        label: "ProjectA_Cloud.rvt",
        placeholder: "no document",
        liveness: "attached",
        dir: "read+write",
        options: [{ id: "d1", label: "ProjectA_Cloud.rvt", sub: "active document" }],
        empty: "the document arrives with the bound world",
      },
      {
        key: "view",
        rank: 2,
        joiner: "from",
        label: "ZONING PLAN — MAIN",
        placeholder: "pick a zoning plan",
        liveness: null,
        dir: "read",
        options: [
          { id: "v1", label: "ZONING PLAN — MAIN", sub: "Main Level · 7 regions" },
          { id: "v2", label: "ZONING PLAN — ATTIC", sub: "Attic · 4 regions" },
          { id: "v3", label: "ZONING PLAN — LOWER", sub: "Lower Level · 9 regions" },
        ],
        empty: "views come from the bound model",
      },
      {
        key: "zones",
        rank: 3,
        joiner: "into",
        label: null,
        placeholder: "pick zones",
        liveness: null,
        dir: "write",
        multi: true,
        options: [
          { id: "z1", label: "ML05", sub: "diagonal wing · 7 rooms" },
          { id: "z2", label: "ML08", sub: "orthogonal · 11 rooms" },
          { id: "z3", label: "ML09", sub: "mixed-frame · 4 rooms" },
          { id: "z4", label: "ATTIC 00", sub: "3 rooms" },
          { id: "z5", label: "ATTIC 01", sub: "5 rooms" },
        ],
        empty: "zones come from adoption — stamp designer regions first",
      },
      {
        key: "r10",
        rank: 4,
        joiner: "syncing",
        label: "ManJ_Manuella_2026.08.14.r10",
        placeholder: "pick a .r10",
        liveness: "detached",
        dir: "sync",
        options: [
          { id: "r1", label: "ManJ_Manuella_2026.08.14.r10", sub: "template copy · 150 rooms" },
          { id: "r2", label: "ManJ_blank_template.r10", sub: "template · never synced" },
        ],
        empty: "needs a host op listing .r10 files near the model (legal-options gap)",
      },
    ],
    stages: [
      {
        key: "adopt",
        label: "adopt",
        verbs: [{ key: "adopt", label: "adopt zones", demands: ["world", "rvt", "view", "zones"] }],
      },
      {
        key: "audit",
        label: "audit",
        verbs: [
          { key: "capture", label: "capture", demands: ["world", "rvt", "view"] },
          { key: "partition", label: "partition", demands: ["world", "rvt", "zones"] },
          { key: "decide", label: "accept / dismiss", demands: ["world", "rvt", "zones"] },
        ],
      },
      {
        key: "sync",
        label: "sync",
        verbs: [
          { key: "load", label: "load .r10", demands: ["world", "r10"] },
          { key: "insert", label: "insert rooms", demands: ["world", "rvt", "zones", "r10"] },
        ],
      },
    ],
  },
  {
    key: "family",
    name: "family",
    stress: "the host rvt an rfa opens from has NO data direction; json ports BOTH ways",
    nouns: [
      {
        key: "world",
        rank: 0,
        joiner: "in",
        label: "R24 · pid 41232",
        placeholder: "pick a world",
        liveness: "attached",
        dir: null,
        options: [{ id: "w1", label: "R24 · pid 41232", sub: "family session" }],
        empty: "no live worlds — start one from /instances",
      },
      {
        key: "rvt",
        rank: 1,
        joiner: "via",
        label: "ProjectA_Cloud.rvt",
        placeholder: "no host document",
        liveness: "attached",
        dir: null, // the channel the rfa was opened from — no data flows to it here
        options: [{ id: "d1", label: "ProjectA_Cloud.rvt", sub: "host document" }],
        empty: "the host document arrives with the bound world",
      },
      {
        key: "rfa",
        rank: 2,
        joiner: "editing",
        label: "PE_FanCoil_Horizontal.rfa",
        placeholder: "pick a family",
        liveness: "attached",
        dir: "read+write",
        options: [
          { id: "f1", label: "PE_FanCoil_Horizontal.rfa", sub: "12 types · 47 params" },
          { id: "f2", label: "PE_VAV_ParallelFP.rfa", sub: "6 types · 33 params" },
        ],
        empty: "families come from the host document",
      },
      {
        key: "spec",
        rank: 3,
        joiner: "porting",
        label: "fan-coil-spec.json",
        placeholder: "no spec",
        liveness: "detached",
        dir: "sync", // parse_spec reads it in, export writes it out — both ways
        options: [
          { id: "s1", label: "fan-coil-spec.json", sub: "portable spec · schema v2" },
          { id: "s2", label: "vav-spec.json", sub: "portable spec · schema v2" },
        ],
        empty: "specs live beside the project — export one from a family first",
      },
    ],
    stages: [
      {
        key: "inspect",
        label: "inspect",
        verbs: [{ key: "snapshot", label: "refresh snapshot", demands: ["world", "rvt", "rfa"] }],
      },
      {
        key: "edit",
        label: "edit",
        verbs: [
          { key: "param", label: "edit parameter", demands: ["world", "rvt", "rfa"] },
          { key: "push", label: "push to family", demands: ["world", "rvt", "rfa"] },
        ],
      },
      {
        key: "port",
        label: "port",
        verbs: [
          { key: "export", label: "export spec", demands: ["rfa", "spec"] },
          { key: "import", label: "apply spec", demands: ["world", "rvt", "rfa", "spec"] },
        ],
      },
    ],
  },
  {
    key: "families",
    name: "families",
    stress: "an OPTIONAL read (the profile) — some workflows never bind it; plan is a lens, not state",
    nouns: [
      {
        key: "world",
        rank: 0,
        joiner: "in",
        label: "R24 · pid 41232",
        placeholder: "pick a world",
        liveness: "attached",
        dir: null,
        options: [{ id: "w1", label: "R24 · pid 41232", sub: "ProjectA_Cloud" }],
        empty: "no live worlds — start one from /instances",
      },
      {
        key: "rvt",
        rank: 1,
        joiner: "auditing",
        label: "ProjectA_Cloud.rvt",
        placeholder: "no document",
        liveness: "attached",
        dir: "read+write", // census reads; the plan's apply writes params back
        options: [{ id: "d1", label: "ProjectA_Cloud.rvt", sub: "212 families" }],
        empty: "the document arrives with the bound world",
      },
      {
        key: "profile",
        rank: 2,
        joiner: "against",
        label: null, // often unbound — that is the stress
        placeholder: "no profile",
        liveness: "detached",
        dir: "read",
        options: [
          { id: "p1", label: "pe-standard-profile.json", sub: "firm standard · 84 rules" },
          { id: "p2", label: "project-a-project-profile.json", sub: "project overrides" },
        ],
        empty: "profiles are firm/project json — census works without one",
      },
    ],
    stages: [
      {
        key: "census",
        label: "census",
        verbs: [{ key: "census", label: "read families", demands: ["world", "rvt"] }],
      },
      {
        key: "plan",
        label: "plan",
        verbs: [{ key: "diff", label: "diff vs profile", demands: ["world", "rvt", "profile"] }],
      },
      {
        key: "apply",
        label: "apply",
        verbs: [{ key: "apply", label: "apply plan", demands: ["world", "rvt"] }],
      },
    ],
  },
  {
    key: "chat",
    name: "chat",
    stress: "the meta-product — bindings arrive with the plugin in play, not with the route",
    nouns: [
      {
        key: "world",
        rank: 0,
        joiner: "in",
        label: "R24 · pid 41232",
        placeholder: "no world",
        liveness: "attached",
        dir: null,
        options: [{ id: "w1", label: "R24 · pid 41232", sub: "ProjectA_Cloud" }],
        empty: "chat works hostless; a world attaches when a plugin needs one",
      },
      {
        key: "doc",
        rank: 1,
        joiner: "operating",
        label: "schedule-grid — M501",
        placeholder: "no workspace",
        liveness: "attached",
        dir: "read+write", // pea proposes into it; commit writes through
        options: [
          { id: "ws1", label: "schedule-grid — M501", sub: "plugin workspace" },
          { id: "ws2", label: "family — PE_FanCoil", sub: "plugin workspace" },
        ],
        empty: "workspaces open when you or pea start a plugin",
      },
    ],
    stages: [
      {
        key: "converse",
        label: "converse",
        verbs: [{ key: "send", label: "send", demands: [] }],
      },
      {
        key: "operate",
        label: "operate",
        verbs: [{ key: "propose", label: "pea proposes", demands: ["world", "doc"] }],
      },
      {
        key: "commit",
        label: "commit",
        verbs: [{ key: "commit", label: "commit staged", demands: ["world", "doc"] }],
      },
    ],
  },
  {
    key: "settings",
    name: "settings",
    stress: "the minimum scale — one disk write, host optional; does the paradigm shrink gracefully?",
    nouns: [
      {
        key: "store",
        rank: 0,
        joiner: "editing",
        label: "settings.json",
        placeholder: "no store",
        liveness: "attached",
        dir: "read+write",
        options: [{ id: "st1", label: "settings.json", sub: "user scope · on disk" }],
        empty: "the settings store is always present",
      },
      {
        key: "host",
        rank: 1,
        joiner: "against",
        label: null,
        placeholder: "no host",
        liveness: "detached",
        dir: "read", // schema/defaults testimony only
        options: [{ id: "h1", label: "R24 · pid 41232", sub: "live schema source" }],
        empty: "host is optional — settings edit fine offline",
      },
    ],
    stages: [
      {
        key: "browse",
        label: "browse",
        verbs: [{ key: "read", label: "read settings", demands: ["store"] }],
      },
      {
        key: "edit",
        label: "edit",
        verbs: [{ key: "stage", label: "stage change", demands: ["store"] }],
      },
      {
        key: "save",
        label: "save",
        verbs: [{ key: "save", label: "write to disk", demands: ["store"] }],
      },
    ],
  },
];
