/**
 * PROTOTYPE — targeting round 4 shared model. Throwaway with the round.
 *
 * Round-3 reframe (kaitpw 2026-08-20): bindings are a FOREST OF PATHS, not a flat list.
 * A LINK is one pick; its options depend on its parent. A link with a `dir` is an ENDPOINT
 * (the leaf verbs read/write). Links without `dir` are pure context (world, the host rvt an
 * rfa opens from). Every view renders the SAME manifests; views may NOT invent semantics.
 *
 * Seams are DERIVED, never flagged (SURFACE-PHILOSOPHY §3):
 *   link.options === null     → legal-options seam (no real source of options yet)
 *   link.source === "fixture" → page-level seam chip ("reads a fixture until <needs>")
 *   verb.run === null         → verb seam (declared, not wired)
 *   pane.draws ⊄ bound∩demanded → pane disabled with reason (Q4 ruling: demands gate panes)
 */

export type Dir = "read" | "write" | "read+write" | "sync";
export type Liveness = "attached" | "detached";
export type Source = "host" | "disk" | "fixture";

export interface Option {
  id: string;
  label: string;
  sub?: string;
}

export interface Link {
  key: string;
  /** Parent link key; undefined = root of a path. */
  parent?: string;
  /** Prose joiner (round-2 ruling keeps joiners). */
  joiner: string;
  placeholder: string;
  /** Pre-bound option id, or null = unbound. */
  bound: string | null;
  multi?: boolean;
  /** Where real options would come from. "fixture" = the proto seeds them (page seam). */
  source: Source;
  /** Options keyed by parent option id (root links use "*"). null = legal-options SEAM. */
  options: Record<string, Option[]> | null;
  /** What discharges the seam / empty state. */
  needs: string;
  /** Endpoint-only. */
  dir?: Dir;
  liveness?: Liveness;
}

export interface Verb {
  key: string;
  label: string;
  demands: string[];
  /** Page-blast commit verb (the one blue). */
  commit?: boolean;
  /** null = SEAM: declared, not wired. Real ones resolve after a mock delay. */
  run: (() => Promise<void>) | null;
  /** Only when run === null: what wires it. */
  needs?: string;
}

export interface Stage {
  key: string;
  label: string;
  verbs: Verb[];
}

export interface Pane {
  key: string;
  label: string;
  /** Link keys this pane draws from. Unbound or undemanded ⇒ pane disabled. */
  draws: string[];
}

export interface Product {
  key: string;
  name: string;
  stress: string;
  links: Link[];
  stages: Stage[];
  panes: Pane[];
}

const mock = () => new Promise<void>((r) => setTimeout(r, 1600));

/* ------------------------------------------------------------------ derivations */

export const isEndpoint = (l: Link) => l.dir !== undefined;
export const loud = (l: Link) => l.dir === "write" || l.dir === "sync" || l.dir === "read+write";

/** Root → leaf chain for a link. */
export function pathOf(product: Product, key: string): Link[] {
  const byKey = new Map(product.links.map((l) => [l.key, l]));
  const out: Link[] = [];
  let cur = byKey.get(key);
  while (cur) {
    out.unshift(cur);
    cur = cur.parent ? byKey.get(cur.parent) : undefined;
  }
  return out;
}

/** Endpoints in declaration order (declaration order IS granularity order). */
export const endpoints = (p: Product) => p.links.filter(isEndpoint);

/** The DOMINANT chain: the longest ancestor prefix shared by the most endpoints (≥2).
 *  Endpoints count as ancestors of deeper endpoints (rvt is both). Empty when no two
 *  endpoints share a root — settings, chat-with-one-endpoint. Round-4 card/sentence
 *  builders converged on this shape: "hoist the dominant chain, crumb the rest". */
export function sharedPrefix(p: Product): Link[] {
  const eps = endpoints(p);
  const chains = eps.map((e) =>
    pathOf(p, e.key)
      .slice(0, -1)
      .map((l) => l.key),
  );
  let best: string[] = [];
  let bestCount = 1;
  for (const c of chains) {
    for (let n = c.length; n > 0; n--) {
      const prefix = c.slice(0, n);
      const count = chains.filter((o) => prefix.every((k, i) => o[i] === k)).length;
      if (count >= 2 && (count > bestCount || (count === bestCount && n > best.length))) {
        best = prefix;
        bestCount = count;
      }
    }
  }
  return best.map((k) => p.links.find((l) => l.key === k)!);
}

export const demandedKeys = (stage: Stage) => new Set(stage.verbs.flatMap((v) => v.demands));

/** Options legal for a link given the bound ids of its ancestors. null = seam. */
export function optionsFor(
  _product: Product,
  link: Link,
  bound: Record<string, string | null>,
): Option[] | null {
  if (link.options === null) return null;
  const parentId = link.parent ? bound[link.parent] : "*";
  if (parentId == null) return [];
  return link.options[parentId] ?? [];
}

export interface Seam {
  kind: "options" | "fixture" | "verb";
  subject: string;
  needs: string;
}

/** Every seam a product carries — the page chip and the census both read this. */
export function seams(p: Product): Seam[] {
  const out: Seam[] = [];
  for (const l of p.links) {
    if (l.options === null) out.push({ kind: "options", subject: l.key, needs: l.needs });
    else if (l.source === "fixture") out.push({ kind: "fixture", subject: l.key, needs: l.needs });
  }
  for (const s of p.stages)
    for (const v of s.verbs)
      if (v.run === null)
        out.push({ kind: "verb", subject: `${s.key}/${v.key}`, needs: v.needs ?? "a handler" });
  return out;
}

/* ------------------------------------------------------------------ fixtures */

const WORLD: Link = {
  key: "world",
  joiner: "in",
  placeholder: "pick a world",
  bound: "w1",
  source: "host",
  options: {
    "*": [
      { id: "w1", label: "R24 · pid 41232", sub: "ProjectA_Cloud" },
      { id: "w2", label: "R23 · pid 8804", sub: "empty session" },
    ],
  },
  needs: "a live world — start one from /instances",
  liveness: "attached",
};

const RVT = (joiner: string, dir?: Dir): Link => ({
  key: "rvt",
  parent: "world",
  joiner,
  placeholder: "no document",
  bound: "d1",
  source: "host",
  options: {
    w1: [{ id: "d1", label: "ProjectA_Cloud.rvt", sub: "active document" }],
    w2: [],
  },
  needs: "the document arrives with the bound world",
  ...(dir ? { dir, liveness: "attached" as const } : {}),
});

export const PRODUCTS: Product[] = [
  {
    key: "takeoffs",
    name: "takeoffs",
    stress: "worst case — two host endpoints under one rvt, plus a disk-rooted sync endpoint",
    links: [
      WORLD,
      RVT("editing", "read+write"),
      {
        key: "view",
        parent: "rvt",
        joiner: "from",
        placeholder: "pick a zoning plan",
        bound: "v1",
        source: "host",
        options: {
          d1: [
            { id: "v1", label: "ZONING PLAN — MAIN", sub: "Main Level · 7 regions" },
            { id: "v2", label: "ZONING PLAN — ATTIC", sub: "Attic · 4 regions" },
            { id: "v3", label: "ZONING PLAN — LOWER", sub: "Lower Level · 9 regions" },
          ],
        },
        needs: "views come from the bound model",
        dir: "read",
      },
      {
        key: "zones",
        parent: "rvt",
        joiner: "into",
        placeholder: "pick zones",
        bound: null,
        multi: true,
        source: "host",
        options: {
          d1: [
            { id: "z1", label: "ML05", sub: "diagonal wing · 7 rooms" },
            { id: "z2", label: "ML08", sub: "orthogonal · 11 rooms" },
            { id: "z3", label: "ML09", sub: "mixed-frame · 4 rooms" },
            { id: "z4", label: "ATTIC 00", sub: "3 rooms" },
            { id: "z5", label: "ATTIC 01", sub: "5 rooms" },
          ],
        },
        needs: "zones come from adoption — stamp designer regions first",
        dir: "write",
      },
      {
        key: "folder",
        joiner: "beside",
        placeholder: "pick a folder",
        bound: "f1",
        source: "disk",
        options: {
          "*": [
            { id: "f1", label: "project-a/rhvac", sub: "3 files" },
            { id: "f2", label: "project-a/archive", sub: "11 files" },
          ],
        },
        needs: "a folder near the model",
      },
      {
        key: "r10",
        parent: "folder",
        joiner: "syncing",
        placeholder: "pick a .r10",
        bound: null,
        source: "disk",
        options: null, // SEAM — no host/disk op lists .r10 files yet
        needs: "host op listing .r10 files in the folder",
        dir: "sync",
        liveness: "detached",
      },
    ],
    stages: [
      {
        key: "adopt",
        label: "adopt",
        verbs: [{ key: "adopt", label: "adopt zones", demands: ["view", "zones"], run: mock }],
      },
      {
        key: "audit",
        label: "audit",
        verbs: [
          { key: "capture", label: "capture", demands: ["view"], run: mock },
          { key: "partition", label: "partition", demands: ["zones"], run: mock },
          { key: "decide", label: "accept / dismiss", demands: ["zones"], run: mock },
        ],
      },
      {
        key: "sync",
        label: "sync",
        verbs: [
          { key: "load", label: "load .r10", demands: ["r10"], run: null, needs: "r10 read op" },
          {
            key: "insert",
            label: "insert rooms",
            demands: ["zones", "r10"],
            commit: true,
            run: null,
            needs: "r10 surgical write",
          },
        ],
      },
    ],
    panes: [
      { key: "plan", label: "plan image", draws: ["view"] },
      { key: "rooms", label: "room table", draws: ["zones"] },
      { key: "r10", label: ".r10 diff", draws: ["zones", "r10"] },
    ],
  },
  {
    key: "family",
    name: "family",
    stress:
      "three-deep host path (world › rvt › rfa); the rvt is pure context; spec is a disk path",
    links: [
      WORLD,
      RVT("via"),
      {
        key: "rfa",
        parent: "rvt",
        joiner: "editing",
        placeholder: "pick a family",
        bound: "fa1",
        source: "host",
        options: {
          d1: [
            { id: "fa1", label: "PE_FanCoil_Horizontal.rfa", sub: "12 types · 47 params" },
            { id: "fa2", label: "PE_VAV_ParallelFP.rfa", sub: "6 types · 33 params" },
          ],
        },
        needs: "families come from the host document",
        dir: "read+write",
        liveness: "attached",
      },
      {
        key: "specdir",
        joiner: "under",
        placeholder: "pick a spec folder",
        bound: "sd1",
        source: "disk",
        options: {
          "*": [
            { id: "sd1", label: "pe-specs/mechanical", sub: "14 specs" },
            { id: "sd2", label: "pe-specs/plumbing", sub: "6 specs" },
          ],
        },
        needs: "a spec folder in the repo",
      },
      {
        key: "spec",
        parent: "specdir",
        joiner: "porting",
        placeholder: "no spec",
        bound: null,
        source: "fixture", // SEAM — proto seeds these; real = disk listing
        options: {
          sd1: [
            { id: "s1", label: "fan-coil-spec.json", sub: "schema v2" },
            { id: "s2", label: "vav-spec.json", sub: "schema v2" },
          ],
          sd2: [{ id: "s3", label: "wh-spec.json", sub: "schema v1" }],
        },
        needs: "disk listing of the spec folder",
        dir: "sync",
        liveness: "detached",
      },
    ],
    stages: [
      {
        key: "inspect",
        label: "inspect",
        verbs: [{ key: "snapshot", label: "refresh snapshot", demands: ["rfa"], run: mock }],
      },
      {
        key: "edit",
        label: "edit",
        verbs: [
          { key: "param", label: "edit parameter", demands: ["rfa"], run: mock },
          { key: "push", label: "push to family", demands: ["rfa"], commit: true, run: mock },
        ],
      },
      {
        key: "port",
        label: "port",
        verbs: [
          {
            key: "export",
            label: "export spec",
            demands: ["rfa", "spec"],
            run: null,
            needs: "spec writer",
          },
          {
            key: "import",
            label: "apply spec",
            demands: ["rfa", "spec"],
            commit: true,
            run: null,
            needs: "spec parser + apply",
          },
        ],
      },
    ],
    panes: [
      { key: "params", label: "parameters", draws: ["rfa"] },
      { key: "types", label: "types", draws: ["rfa"] },
      { key: "json", label: "spec json", draws: ["spec"] },
    ],
  },
  {
    key: "families",
    name: "families",
    stress: "an OPTIONAL read (profile) that some workflows never bind",
    links: [
      WORLD,
      RVT("auditing", "read+write"),
      {
        key: "profile",
        joiner: "against",
        placeholder: "no profile",
        bound: null,
        source: "disk",
        options: {
          "*": [
            { id: "p1", label: "pe-standard-profile.json", sub: "firm · 84 rules" },
            { id: "p2", label: "project-a-profile.json", sub: "project overrides" },
          ],
        },
        needs: "a firm/project profile json — census works without one",
        dir: "read",
        liveness: "detached",
      },
    ],
    stages: [
      {
        key: "census",
        label: "census",
        verbs: [{ key: "census", label: "read families", demands: ["rvt"], run: mock }],
      },
      {
        key: "plan",
        label: "plan",
        verbs: [{ key: "diff", label: "diff vs profile", demands: ["rvt", "profile"], run: mock }],
      },
      {
        key: "apply",
        label: "apply",
        verbs: [{ key: "apply", label: "apply plan", demands: ["rvt"], commit: true, run: mock }],
      },
    ],
    panes: [
      { key: "table", label: "family table", draws: ["rvt"] },
      { key: "plan", label: "plan", draws: ["rvt", "profile"] },
    ],
  },
  {
    key: "chat",
    name: "chat",
    stress: "meta-product — bindings arrive with the plugin in play, not the route",
    links: [
      {
        ...WORLD,
        placeholder: "no world",
        needs: "chat works hostless; a world attaches when a plugin needs one",
      },
      {
        key: "doc",
        parent: "world",
        joiner: "operating",
        placeholder: "no workspace",
        bound: "ws1",
        source: "host",
        options: {
          w1: [
            { id: "ws1", label: "schedule-grid — M501", sub: "plugin workspace" },
            { id: "ws2", label: "family — PE_FanCoil", sub: "plugin workspace" },
          ],
          w2: [],
        },
        needs: "workspaces open when you or pea start a plugin",
        dir: "read+write",
        liveness: "attached",
      },
    ],
    stages: [
      {
        key: "converse",
        label: "converse",
        verbs: [{ key: "send", label: "send", demands: [], run: mock }],
      },
      {
        key: "operate",
        label: "operate",
        verbs: [{ key: "propose", label: "pea proposes", demands: ["doc"], run: mock }],
      },
      {
        key: "commit",
        label: "commit",
        verbs: [
          { key: "commit", label: "commit staged", demands: ["doc"], commit: true, run: mock },
        ],
      },
    ],
    panes: [
      { key: "thread", label: "thread", draws: [] },
      { key: "workspace", label: "workspace", draws: ["doc"] },
    ],
  },
  {
    key: "settings",
    name: "settings",
    stress: "minimum scale — one disk endpoint, host optional",
    links: [
      {
        key: "store",
        joiner: "editing",
        placeholder: "no store",
        bound: "st1",
        source: "disk",
        options: { "*": [{ id: "st1", label: "settings.json", sub: "user scope" }] },
        needs: "the settings store is always present",
        dir: "read+write",
        liveness: "attached",
      },
      {
        key: "host",
        joiner: "against",
        placeholder: "no host",
        bound: null,
        source: "host",
        options: { "*": [{ id: "h1", label: "R24 · pid 41232", sub: "live schema source" }] },
        needs: "host is optional — settings edit fine offline",
        dir: "read",
        liveness: "detached",
      },
    ],
    stages: [
      {
        key: "browse",
        label: "browse",
        verbs: [{ key: "read", label: "read settings", demands: ["store"], run: mock }],
      },
      {
        key: "edit",
        label: "edit",
        verbs: [{ key: "stage", label: "stage change", demands: ["store"], run: mock }],
      },
      {
        key: "save",
        label: "save",
        verbs: [
          { key: "save", label: "write to disk", demands: ["store"], commit: true, run: mock },
        ],
      },
    ],
    panes: [
      { key: "form", label: "schema form", draws: ["store"] },
      { key: "live", label: "live defaults", draws: ["host"] },
    ],
  },
  {
    key: "specs",
    name: "specs",
    stress:
      "NO host at all — a three-deep disk path (repo › dir › file); must render like the host ones",
    links: [
      {
        key: "repo",
        joiner: "in",
        placeholder: "pick a repo",
        bound: "rp1",
        source: "disk",
        options: {
          "*": [
            { id: "rp1", label: "pe-specs", sub: "main · clean" },
            { id: "rp2", label: "pe-specs-archive", sub: "read-only" },
          ],
        },
        needs: "a checked-out repo",
      },
      {
        key: "dir",
        parent: "repo",
        joiner: "under",
        placeholder: "pick a dir",
        bound: "dr1",
        source: "disk",
        options: {
          rp1: [
            { id: "dr1", label: "mechanical", sub: "14 files" },
            { id: "dr2", label: "plumbing", sub: "6 files" },
          ],
          rp2: [{ id: "dr3", label: "2024", sub: "40 files" }],
        },
        needs: "a directory in the repo",
      },
      {
        key: "file",
        parent: "dir",
        joiner: "editing",
        placeholder: "pick a spec",
        bound: null,
        source: "disk",
        options: {
          dr1: [
            { id: "fl1", label: "fan-coil-spec.json" },
            { id: "fl2", label: "vav-spec.json" },
          ],
          dr2: [{ id: "fl3", label: "wh-spec.json" }],
          dr3: [{ id: "fl4", label: "legacy-ahu.json" }],
        },
        needs: "files come from the directory",
        dir: "read+write",
        liveness: "attached",
      },
    ],
    stages: [
      {
        key: "browse",
        label: "browse",
        verbs: [{ key: "open", label: "open", demands: ["file"], run: mock }],
      },
      {
        key: "edit",
        label: "edit",
        verbs: [
          { key: "edit", label: "edit field", demands: ["file"], run: mock },
          { key: "save", label: "save", demands: ["file"], commit: true, run: mock },
        ],
      },
      {
        key: "validate",
        label: "validate",
        verbs: [
          {
            key: "validate",
            label: "validate schema",
            demands: ["file"],
            run: null,
            needs: "schema validator",
          },
        ],
      },
    ],
    panes: [
      { key: "tree", label: "file tree", draws: ["dir"] },
      { key: "editor", label: "editor", draws: ["file"] },
    ],
  },
];
