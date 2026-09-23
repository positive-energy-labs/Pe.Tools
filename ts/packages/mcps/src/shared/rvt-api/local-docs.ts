/**
 * Local Revit API docs engine.
 *
 * Parses the doc-comment XML that Autodesk ships with every Revit install
 * (C:\Program Files\Autodesk\Revit {year}\RevitAPI*.xml) into a cached
 * SQLite FTS5 (BM25) index, and joins members against a locally generated
 * usage-examples index (examples.json, produced by tools/usage-index).
 *
 * Zero network, zero shipped data: the corpus is the user's own install,
 * the index is built once per machine per year and cached under the
 * product root.
 */
import { existsSync, mkdirSync, readFileSync, rmSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";

const SCHEMA_VERSION = 1;

export type DocMember = {
  memberId: string;
  kind: "Class" | "Interface" | "Constructor" | "Method" | "Property" | "Field" | "Event";
  name: string;
  namespace: string;
  declaringType: string;
  signature: string;
  summary: string;
  remarks: string;
  extras: string;
  since: string;
  assembly: string;
};

type UsageExample = {
  file: string;
  startLine: number;
  endLine: number;
  enclosing: string;
};

export type LocalSearchResult = {
  title: string;
  namespace: string;
  type: string;
  url: string;
  memberId: string;
  summary: string;
  remarks?: string;
  since?: string;
  examples?: UsageExample[];
};

export type LocalDocsOptions = {
  /** Explicit XML files to index; defaults to the Revit install for the year. */
  xmlPaths?: string[];
  /** Index cache directory; defaults to the product root cache. */
  cacheDir?: string;
  /** examples.json path; defaults to env/product-root probing. */
  examplesPath?: string;
};

// ---------------------------------------------------------------------------
// Discovery

function productRoot(): string {
  const base = process.env.LOCALAPPDATA ?? join(homedir(), "AppData", "Local");
  return join(base, "Positive Energy", "Pe.Tools");
}

export function findRevitInstallXmls(year: number): string[] {
  const programFiles = process.env.ProgramFiles ?? "C:\\Program Files";
  const root = join(programFiles, "Autodesk", `Revit ${year}`);
  return ["RevitAPI.xml", "RevitAPIUI.xml", "RevitAPIIFC.xml"]
    .map((f) => join(root, f))
    .filter((p) => existsSync(p));
}

function defaultCacheDir(): string {
  return process.env.PE_RVT_DOCS_CACHE ?? join(productRoot(), "cache", "rvt-docs");
}

// ---------------------------------------------------------------------------
// XML parsing (doc-comment XML is machine-generated; a tolerant regex pass
// beats dragging in an XML parser for this shape)

const CREF_RE = /<see\s+cref="[A-Z]:([^"]+)"\s*\/?>(?:<\/see>)?/g;
const PARAMREF_RE = /<(?:param|type)ref\s+name="([^"]+)"\s*\/?>/g;

function cleanDocText(raw: string): string {
  return raw
    .replace(CREF_RE, (_, id: string) => id.split("(")[0].split(".").pop() ?? id)
    .replace(PARAMREF_RE, "$1")
    .replace(/<[^>]+>/g, " ")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();
}

function tagText(block: string, tag: string): string {
  const m = block.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`));
  return m ? cleanDocText(m[1]) : "";
}

function collectNamed(block: string, tag: string, attr: string): string {
  const re = new RegExp(`<${tag}\\s+${attr}="([^"]+)"[^>]*>([\\s\\S]*?)<\\/${tag}>`, "g");
  const parts: string[] = [];
  for (const m of block.matchAll(re)) {
    const label = attr === "cref" ? (m[1].split(".").pop() ?? m[1]) : m[1];
    const text = cleanDocText(m[2]);
    if (text) parts.push(`${label}: ${text}`);
  }
  return parts.join(" | ");
}

export function parseMemberId(memberId: string): {
  kind: DocMember["kind"];
  name: string;
  namespace: string;
  declaringType: string;
  signature: string;
} {
  const kindChar = memberId[0];
  const rest = memberId.slice(2);
  const parenIdx = rest.indexOf("(");
  const signature = parenIdx >= 0 ? rest.slice(parenIdx) : "";
  const fqn = parenIdx >= 0 ? rest.slice(0, parenIdx) : rest;
  const segments = fqn.split(".");

  if (kindChar === "T") {
    const name = segments[segments.length - 1];
    // ponytail: enums/structs are indistinguishable from classes in doc XML;
    // IFoo heuristic covers interfaces, everything else reads as Class
    const kind = /^I[A-Z]/.test(name) ? "Interface" : "Class";
    return {
      kind,
      name,
      namespace: segments.slice(0, -1).join("."),
      declaringType: name,
      signature,
    };
  }

  const memberName = segments[segments.length - 1];
  const declaringType = segments[segments.length - 2] ?? "";
  const namespace = segments.slice(0, -2).join(".");
  const kind =
    memberName === "#ctor"
      ? "Constructor"
      : kindChar === "P"
        ? "Property"
        : kindChar === "F"
          ? "Field"
          : kindChar === "E"
            ? "Event"
            : "Method";
  const name = memberName === "#ctor" ? declaringType : memberName;
  return { kind, name, namespace, declaringType, signature };
}

export function parseDocXml(xml: string, assembly: string): DocMember[] {
  const members: DocMember[] = [];
  for (const m of xml.matchAll(/<member name="([^"]+)">([\s\S]*?)<\/member>/g)) {
    const memberId = m[1];
    if (!/^[TMPFE]:/.test(memberId)) continue;
    const block = m[2];
    const parts = parseMemberId(memberId);
    const extras = [
      collectNamed(block, "param", "name"),
      tagText(block, "returns") ? `returns: ${tagText(block, "returns")}` : "",
      collectNamed(block, "exception", "cref"),
    ]
      .filter(Boolean)
      .join(" | ");
    members.push({
      memberId,
      ...parts,
      summary: tagText(block, "summary"),
      remarks: tagText(block, "remarks"),
      extras,
      since: tagText(block, "since"),
      assembly,
    });
  }
  return members;
}

// ---------------------------------------------------------------------------
// Tokenization: FTS5's tokenizer can't split camelCase, so we index a
// pre-split shadow column and split query terms the same way.

export function splitCamel(text: string): string[] {
  return text
    .split(/[^A-Za-z0-9]+/)
    .flatMap((w) => w.split(/(?<=[a-z0-9])(?=[A-Z])|(?<=[A-Z])(?=[A-Z][a-z])/))
    .filter((w) => w.length > 0);
}

function buildMatchQuery(query: string, mode: "and" | "or"): string {
  const terms = [...new Set(splitCamel(query).map((t) => t.toLowerCase()))];
  if (terms.length === 0) return "";
  const quoted = terms.map((t) => (t.length >= 3 ? `"${t}" *` : `"${t}"`));
  return quoted.join(mode === "and" ? " AND " : " OR ");
}

// ---------------------------------------------------------------------------
// Index build + cache

function fingerprint(xmlPaths: string[]): string {
  const stats = xmlPaths.map((p) => {
    const s = statSync(p);
    return `${p}|${s.size}|${s.mtimeMs}`;
  });
  return `v${SCHEMA_VERSION}::${stats.join("::")}`;
}

function createSchema(db: DatabaseSync): void {
  db.exec(`
    CREATE VIRTUAL TABLE docs USING fts5(
      name, name_tokens, namespace, summary, remarks, extras,
      member_id UNINDEXED, kind UNINDEXED, declaring_type UNINDEXED,
      signature UNINDEXED, since UNINDEXED, assembly UNINDEXED,
      tokenize = 'porter unicode61'
    );
    CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT);
  `);
}

function insertMembers(db: DatabaseSync, members: DocMember[]): void {
  const stmt = db.prepare(
    `INSERT INTO docs (name, name_tokens, namespace, summary, remarks, extras,
       member_id, kind, declaring_type, signature, since, assembly)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  db.exec("BEGIN");
  for (const m of members) {
    const nameTokens = [
      ...splitCamel(m.declaringType === m.name ? m.name : `${m.declaringType} ${m.name}`),
      ...splitCamel(m.namespace),
    ].join(" ");
    stmt.run(
      m.declaringType && m.declaringType !== m.name ? `${m.declaringType}.${m.name}` : m.name,
      nameTokens,
      m.namespace,
      m.summary,
      m.remarks,
      m.extras,
      m.memberId,
      m.kind,
      m.declaringType,
      m.signature,
      m.since,
      m.assembly,
    );
  }
  db.exec("COMMIT");
}

/** Opens the cached index for a year, (re)building it if absent or stale. Returns null when no XML corpus exists. */
function openIndex(year: number, opts: LocalDocsOptions = {}): DatabaseSync | null {
  const xmlPaths = opts.xmlPaths ?? findRevitInstallXmls(year);
  if (xmlPaths.length === 0) return null;

  const cacheDir = opts.cacheDir ?? defaultCacheDir();
  const dbPath = join(cacheDir, `docs-${year}.sqlite`);
  const wanted = fingerprint(xmlPaths);

  if (existsSync(dbPath)) {
    try {
      const db = new DatabaseSync(dbPath);
      const row = db.prepare("SELECT value FROM meta WHERE key = 'fingerprint'").get() as
        | { value: string }
        | undefined;
      if (row?.value === wanted) return db;
      db.close();
    } catch {
      // corrupt/old cache falls through to rebuild
    }
    rmSync(dbPath, { force: true });
  }

  mkdirSync(cacheDir, { recursive: true });
  const db = new DatabaseSync(dbPath);
  createSchema(db);
  for (const xmlPath of xmlPaths) {
    const assembly = (xmlPath.split(/[\\/]/).pop() ?? "").replace(/\.xml$/i, "");
    insertMembers(db, parseDocXml(readFileSync(xmlPath, "utf8"), assembly));
  }
  db.prepare("INSERT INTO meta (key, value) VALUES ('fingerprint', ?)").run(wanted);
  return db;
}

// ---------------------------------------------------------------------------
// Examples index (generated by tools/usage-index/UsageIndex.cs)

type ExamplesFile = {
  schemaVersion: number;
  sourceRoot: string;
  members: Record<string, UsageExample[]>;
};

let cachedExamples: { path: string; index: Map<string, UsageExample[]> } | null = null;

function findExamplesPath(): string | null {
  if (process.env.PE_API_EXAMPLES_JSON && existsSync(process.env.PE_API_EXAMPLES_JSON)) {
    return process.env.PE_API_EXAMPLES_JSON;
  }
  // Installed layout is fixed: the index ships beside the Host bundle. The add-in no longer lives
  // under the product root, so nothing here reaches into a Revit payload. The index is staged into
  // dist-installed/ beside Pe.Host.exe by CreateInstallerModule.StageUsageIndex at pack time.
  const candidate = join(productRoot(), "bin", "host", "examples.json");
  return existsSync(candidate) ? candidate : null;
}

function loadExamples(examplesPath?: string | null): Map<string, UsageExample[]> {
  const path = examplesPath ?? findExamplesPath();
  if (!path || !existsSync(path)) return new Map();
  if (cachedExamples?.path === path) return cachedExamples.index;

  const parsed = JSON.parse(readFileSync(path, "utf8")) as ExamplesFile;
  // A sourceRoot recorded at pack time may not exist on this machine (CI path);
  // installed bundles carry the source next to the json, so fall back to its dir.
  let root = isAbsolute(parsed.sourceRoot)
    ? parsed.sourceRoot
    : resolve(dirname(path), parsed.sourceRoot);
  if (!existsSync(root)) root = dirname(path);
  const index = new Map<string, UsageExample[]>();
  for (const [memberId, sites] of Object.entries(parsed.members ?? {})) {
    index.set(
      memberId,
      sites.map((s) => ({ ...s, file: resolve(root, s.file) })),
    );
  }
  cachedExamples = { path, index };
  return index;
}

// ---------------------------------------------------------------------------
// Search

const KIND_TO_RESULT_TYPE: Record<string, string> = {
  Class: "Class",
  Interface: "Interface",
  Constructor: "Constructor",
  Method: "Method",
  Property: "Property",
  Field: "Property", // ponytail: website taxonomy has no Field bucket; Property is the nearest
  Event: "Property",
};

type DocsRow = {
  name: string;
  namespace: string;
  summary: string;
  remarks: string;
  extras: string;
  member_id: string;
  kind: string;
  signature: string;
  since: string;
  assembly: string;
  rank: number;
};

export function searchLocalDocs(
  query: string,
  year: number,
  maxResults: number,
  types?: ReadonlyArray<string>,
  opts: LocalDocsOptions = {},
): LocalSearchResult[] | null {
  const db = openIndex(year, opts);
  if (!db) return null;
  try {
    const examples = loadExamples(opts.examplesPath);
    const select = (match: string) =>
      db
        .prepare(
          `SELECT name, namespace, summary, remarks, extras, member_id, kind,
                  signature, since, assembly,
                  bm25(docs, 8.0, 10.0, 2.0, 4.0, 3.0, 1.0) AS rank
           FROM docs WHERE docs MATCH ? ORDER BY rank LIMIT ?`,
        )
        // wide candidate window: re-ranking boosts (exact name, examples) must be
        // able to pull rows that raw bm25 left outside the requested page
        .all(match, Math.max(100, maxResults * 4)) as unknown as DocsRow[];

    const andMatch = buildMatchQuery(query, "and");
    if (!andMatch) return [];
    let rows = select(andMatch);
    if (rows.length === 0) rows = select(buildMatchQuery(query, "or"));

    const wantedTypes = types ? new Set(types) : null;
    const queryCompact = query.replace(/[^A-Za-z0-9]/g, "").toLowerCase();
    const scored = rows
      .map((row) => {
        const memberExamples = examples.get(row.member_id);
        const nameCompact = row.name.replace(/[^A-Za-z0-9]/g, "").toLowerCase();
        return {
          row,
          // bm25 rank is negative-better; exact identifier hits and
          // example-backed members get pulled up
          score:
            row.rank -
            (nameCompact === queryCompact ? 10.0 : 0) -
            // the type page beats its own ctors/members on an exact type-name query
            (nameCompact === queryCompact && (row.kind === "Class" || row.kind === "Interface")
              ? 5.0
              : 0) -
            (memberExamples?.length ? 1.0 : 0),
          memberExamples,
        };
      })
      .filter(({ row }) => {
        if (!wantedTypes) return true;
        const t = KIND_TO_RESULT_TYPE[row.kind] ?? row.kind;
        // "Methods"/"Properties" are website member-list pages; treat them as their singulars
        return (
          wantedTypes.has(t) || wantedTypes.has(`${t}s`) || wantedTypes.has(t.replace(/s$/, ""))
        );
      })
      .sort((a, b) => a.score - b.score)
      .slice(0, maxResults);

    return scored.map(({ row, memberExamples }) => ({
      title: `${row.name}${row.signature ? row.signature : ""} ${row.kind === "Interface" ? "Interface" : row.kind}`,
      namespace: row.namespace,
      type: KIND_TO_RESULT_TYPE[row.kind] ?? row.kind,
      url: `local:${row.member_id}`,
      memberId: row.member_id,
      summary: row.summary,
      ...(row.remarks ? { remarks: row.remarks } : {}),
      ...(row.since ? { since: row.since } : {}),
      ...(memberExamples?.length ? { examples: memberExamples.slice(0, 5) } : {}),
    }));
  } finally {
    db.close();
  }
}

/** Full doc text for one member, rendered as markdown. Used by revit_api_docs_fetch for local: slugs. */
export function fetchLocalDoc(
  memberId: string,
  year: number,
  opts: LocalDocsOptions = {},
): string | null {
  const db = openIndex(year, opts);
  if (!db) return null;
  try {
    const row = db.prepare("SELECT * FROM docs WHERE member_id = ?").get(memberId) as
      | (DocsRow & { declaring_type: string })
      | undefined;
    if (!row) return null;
    const examples = loadExamples(opts.examplesPath).get(memberId) ?? [];
    const lines = [
      `# ${row.name}${row.signature ?? ""}`,
      ``,
      `- **Member:** \`${row.member_id}\``,
      `- **Namespace:** ${row.namespace}`,
      `- **Assembly:** ${row.assembly}`,
      ...(row.since ? [`- **Since:** Revit ${row.since}`] : []),
      ``,
      ...(row.summary ? [`## Summary`, row.summary, ``] : []),
      ...(row.remarks ? [`## Remarks`, row.remarks, ``] : []),
      ...(row.extras ? [`## Parameters / Returns / Exceptions`, row.extras, ``] : []),
      ...(examples.length
        ? [
            `## Local usage examples`,
            ...examples.map(
              (e) =>
                `- ${e.file}#L${e.startLine}-L${e.endLine} (${e.enclosing}) — read the file for full context`,
            ),
          ]
        : []),
    ];
    return lines.join("\n");
  } finally {
    db.close();
  }
}
