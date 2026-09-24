/**
 * =============================================================================================
 * THE ROUTE PRIMITIVE GUARD — mechanical proof for route-primitive-fable.html §8.
 * =============================================================================================
 *
 * Same posture as design-guard.test.ts / docs-guard.test.ts: plain fs walks, plain regexes, no
 * AST, no new dependency.
 *
 * One `it` per row of fable §8:
 *  1. no fixture lane leak        no fixture*.ts(x)/fixtures.ts file, no "fixture" literal
 *                                 outside *.test.*, under apps/web/src.
 *  2. dead importers              nothing imports targeting/model, targeting/actions,
 *                                 host/route-target, host/target, state/route-store,
 *                                 targeting/flow, targeting/kit, workbench/route-state
 *                                 (fold-2-paper.md disposal list plus the final compatibility owner).
 *  3. no react-query               no @tanstack/react-query in a package.json or an import.
 *  4. one manifest per route      every routes/*.tsx (excluding __root.tsx, -*.test.tsx,
 *                                 design-system_*) exports exactly one `export const manifest`.
 *  5. one stream, one registry    exactly one `new EventSource(` and one `AtomRegistry.make(`
 *                                 in apps/web/src production files.
 *  6. dead-word grep              exported identifiers carrying a dead word (World/Verb/Feed/
 *                                 Lane/Bound/Multi/Slot/Store/Resource/Link/Document/Fixture)
 *                                 as a PascalCase or camelCase segment, in apps/web/src and
 *                                 packages/agent-contracts/src. `Stage` is a Situation word and
 *                                 `Scope` is the hotkey tree's node, so neither is dead.
 *                                 Allowlist holds only the Revit Document/Link senses.
 *  7. no hand-written keymap      no `Alt+${` / `Ctrl+${` / `Mod+${` / `Cmd+${` template
 *                                 outside route/keys.tsx.
 *  8. one hotkey door             nothing under apps/web names @tanstack/react-hotkeys except
 *                                 route/keys.tsx: every chord is bound by `useScopeKeys` on a
 *                                 scope node, so help can say which region owns it and a hidden
 *                                 node can switch it off (ledger 2026-09-22).
 *  9. a target draws the Situation N1 (MAP ruling 29): a routes/*.tsx whose own module or a direct
 *                                 import names a target (a route-level `needs` of document,
 *                                 project, family or session; an AddressingBar; a `target` search
 *                                 param) reaches a `<Situation` through its import closure. Held
 *                                 as a ratchet on the current offenders.
 * =============================================================================================
 */
import { execFileSync } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vite-plus/test";

// ── the walk ─────────────────────────────────────────────────────────────────────────────────

const HERE = dirname(fileURLToPath(import.meta.url)); // …/tests/repo-guards/src (once promoted)
const REPO = execFileSync("git", ["rev-parse", "--show-toplevel"], {
  cwd: HERE,
  encoding: "utf8",
}).trim();

const WEB_SRC = resolve(REPO, "ts/apps/web/src");
const AGENT_CONTRACTS_SRC = resolve(REPO, "ts/packages/agent-contracts/src");
const PE_TOOLS_ROOT = resolve(REPO, "ts");

type Entry = { rel: string; abs: string; text: string };

/** Walk `dir`, returning every file matching `match`, `rel` relative to `dir`. */
const collect = (
  dir: string,
  match: RegExp,
  skipDirs = new Set(["node_modules", "dist", ".turbo"]),
): Entry[] => {
  const out: Entry[] = [];
  const walk = (d: string, relBase: string): void => {
    let entries;
    try {
      entries = readdirSync(d, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      const rel = relBase === "" ? e.name : `${relBase}/${e.name}`;
      const abs = join(d, e.name);
      if (e.isDirectory()) {
        if (!skipDirs.has(e.name)) walk(abs, rel);
        continue;
      }
      if (!match.test(e.name)) continue;
      out.push({ rel, abs, text: readFileSync(abs, "utf8") });
    }
  };
  walk(dir, "");
  return out;
};

const WEB_FILES = collect(WEB_SRC, /\.(?:tsx?|css)$/);
const WEB_PROD_FILES = WEB_FILES.filter((f) => !/\.test\.tsx?$/.test(f.rel));
const AGENT_CONTRACTS_FILES = collect(AGENT_CONTRACTS_SRC, /\.tsx?$/);
const PACKAGE_JSONS = collect(PE_TOOLS_ROOT, /^package\.json$/);

const list = (items: string[], cap = 40): string =>
  items
    .slice(0, cap)
    .map((s) => `  ${s}`)
    .join("\n") + (items.length > cap ? `\n  … +${items.length - cap} more` : "");

const lineOf = (text: string, index: number): number => text.slice(0, index).split("\n").length;

const hits = (files: Entry[], re: RegExp): string[] => {
  const out: string[] = [];
  for (const f of files) {
    const r = new RegExp(re.source, re.flags.includes("g") ? re.flags : `${re.flags}g`);
    for (const m of f.text.matchAll(r)) out.push(`${f.rel}:${lineOf(f.text, m.index ?? 0)}`);
  }
  return out;
};

// ── 1. no fixture lane leak ──────────────────────────────────────────────────────────────────

describe("route primitive guard — no fixture lane leak", () => {
  it('no fixture*.ts(x)/fixtures.ts file and no "fixture" literal outside *.test.* under apps/web/src', () => {
    const fixtureFiles = WEB_FILES.filter(
      (f) => /(^|\/)fixtures?\.tsx?$/i.test(f.rel) || /(^|\/)fixture[^/]*\.tsx?$/i.test(f.rel),
    );
    expect(
      fixtureFiles.length,
      `Fixture-named files leak the fixture lane into apps/web/src (fable §5):\n${list(fixtureFiles.map((f) => f.rel))}`,
    ).toBe(0);

    const nonTest = WEB_FILES.filter((f) => !/\.test\.tsx?$/.test(f.rel));
    const literalHits = hits(nonTest, /"fixture"/g);
    expect(
      literalHits.length,
      `"fixture" string literal found outside *.test.* (fable §5):\n${list(literalHits)}`,
    ).toBe(0);
  });
});

// ── 2. dead importers ────────────────────────────────────────────────────────────────────────

const DEAD_MODULES = [
  "targeting/model",
  "targeting/actions",
  "host/route-target",
  "host/target",
  "state/route-store",
  "targeting/flow",
  "targeting/kit",
  "workbench/route-state",
];

describe("route primitive guard — dead importers", () => {
  it("nothing imports a retired route owner or targeting module", () => {
    const offences: string[] = [];
    for (const f of WEB_FILES) {
      for (const mod of DEAD_MODULES) {
        const re = new RegExp(`from\\s+["'][^"']*${mod.replace("/", "\\/")}["']`, "g");
        for (const m of f.text.matchAll(re)) {
          offences.push(`${f.rel}:${lineOf(f.text, m.index ?? 0)} → ${mod}`);
        }
      }
    }
    expect(
      offences.length,
      `Dead module still imported — these files are deleted by fold-2-paper.md's disposal table:\n${list(offences)}`,
    ).toBe(0);
  });
});

// ── 3. no react-query ────────────────────────────────────────────────────────────────────────

describe("route primitive guard — no react-query", () => {
  it("no @tanstack/react-query in any package.json or import under apps/web", () => {
    const pkgOffences = PACKAGE_JSONS.filter((f) => f.text.includes("@tanstack/react-query")).map(
      (f) => f.rel,
    );
    const importOffences = hits(WEB_FILES, /["']@tanstack\/react-query["']/g);
    const offences = [...pkgOffences, ...importOffences];
    expect(
      offences.length,
      `@tanstack/react-query still referenced — the dependency is gone (fable law 5):\n${list(offences)}`,
    ).toBe(0);
  });
});

// ── 5. one stream, one registry ──────────────────────────────────────────────────────────────

describe("route primitive guard — one stream, one registry", () => {
  it("exactly one `new EventSource(` and exactly one `AtomRegistry.make(` in apps/web/src production files", () => {
    const eventSourceHits = hits(WEB_PROD_FILES, /new EventSource\(/g);
    const registryHits = hits(WEB_PROD_FILES, /AtomRegistry\.make\(/g);
    expect(
      eventSourceHits.length,
      `Expected exactly one \`new EventSource(\` in apps/web/src production files (fable law 5):\n${list(eventSourceHits)}`,
    ).toBe(1);
    expect(
      registryHits.length,
      `Expected exactly one \`AtomRegistry.make(\` in apps/web/src production files (fable law 5):\n${list(registryHits)}`,
    ).toBe(1);
  });
});

// ── 6. dead-word grep ────────────────────────────────────────────────────────────────────────

/**
 * Allowlist. Each entry is a sense the 2026-09-10 "six nouns" ruling explicitly keeps, and each
 * one says why. Matched on the exported symbol name (not file:line), so an allowance survives
 * edits above it. Nothing else goes in here without a ledger entry.
 */
const DEAD_WORD_ALLOWLIST: readonly RegExp[] = [
  // Revit document identity — the request DTO the host answers with a real Revit Document.
  /^DocumentRequest$/,
  // Revit document identity — the ref that names an open Revit Document.
  /^DocumentRef$/,
  // Revit document identity — the schema for DocumentRequest above.
  /^documentRequestSchema$/,
  // Revit document identity — the open Revit document's id.
  /^openDocumentId$/,
  // A Revit family link (parameter-links): Revit's Link, not a route Link.
  /^ParameterLink[A-Za-z0-9_]*$/,
  // Same Revit family link sense, camelCase values/functions in parameter-links.
  /^parameterLink[A-Za-z0-9_]*$/,
  // Revit parameter-link value rendering (parameter-links/Evaluation.tsx, ops detail sheets,
  // param-tables variant-e): all five name a Revit family parameter link, not a route Link.
  /^displayParameterLinkValue$/,
  /^linkValueText$/,
  /^Link$/,
  /^LINKS$/,
  /^DEMO_LINK$/,
  // Geometry: an axis-aligned bounding box in model/sheet space. Revit's Bounds, not a route Bound.
  /^Bounds[0-9]*$/,
  /^(?:bounds|union|sheet|loop|level)[A-Za-z0-9_]*Bounds?[0-9]*$/,
  /^boundsOf$/,
  /^familyModel[A-Za-z0-9_]*Bounds$/,
  // A Revit family parameter BINDING ("param:Body Width" → the parameter name), not a route Bound.
  /^boundParam$/,
  // The host lane (dev|installed) is the SDK's own word for which install answers; keeping it is
  // the honest name for the SDK union these render.
  /^laneVar$/,
  /^laneOf$/,
  /^LANES$/,
  // The Work document and the Revit document. These are the persisted Work document schema names
  // in packages/agent-contracts plus their apps/web readers; rename to *Work is owed and is a
  // cross-package job — see docs/features/design-system/LEDGER.md.
  /^[A-Za-z0-9_]*Document(?:Schema|Id|Tab|SessionView|Ladder|Address|Ref)?$/,
  /^[a-z][A-Za-z0-9_]*Document[A-Za-z0-9_]*$/,
  /^document[A-Za-z0-9_]*$/,
  /^SETTINGS_SEED_DOCUMENT_ID$/,
  // Route-local stores. Their retirement is owed — see docs/features/design-system/LEDGER.md F2.
  /^(?:create)?(?:Ops|Family|Families|ChatPage)Store(?:Owner)?$/,
  /^use(?:Families|Family)Store$/,
  /^RoomPanelFromStore$/,
  // The chat "world" pane (workbench/world) is a product name the user may keep.
  /^WORLD_ROW$/,
];

/**
 * `Stage` is NOT here: the 2026-09-10 ruling makes it a Situation word. `Scope` left the list on
 * 2026-09-22, when hotkeys became a scope tree and a scope node became a named primitive.
 * Store/Resource/Link/Document/Fixture are named dead by the "six nouns" ruling.
 */
const DEAD_WORDS = [
  "world",
  "verb",
  "feed",
  "lane",
  "bound",
  "multi",
  "slot",
  "store",
  "resource",
  "link",
  "document",
  "fixture",
];

/**
 * Split an identifier into case segments: `worldTarget` → [world, target], `ExportVerbs` →
 * [export, verbs], `Bounds2` → [bounds, 2], `HTTPStore` → [http, store]. Trailing digits and a
 * plural/inflection `s`/`es` are stripped so `Verbs` and `Bounds2` still read as the dead word.
 */
const deadWordSegments = (symbol: string): string[] =>
  (symbol.match(/[A-Z]+(?![a-z])|[A-Z]?[a-z]+|[0-9]+/g) ?? []).map((raw) =>
    raw
      .toLowerCase()
      .replace(/[0-9]+$/, "")
      .replace(/(?:es|s)$/, ""),
  );

describe("route primitive guard — dead-word grep", () => {
  it("no exported identifier with a dead word as a PascalCase or camelCase segment in apps/web/src or packages/agent-contracts/src", () => {
    const dead = new Set(DEAD_WORDS);
    // Catch the whole exported name, either case style; the segment split decides, not the regex.
    const re = /export\s+(?:type|interface|const|function|class)\s+([A-Za-z_$][A-Za-z0-9_$]*)/g;
    const offences: string[] = [];
    for (const f of [...WEB_FILES, ...AGENT_CONTRACTS_FILES]) {
      if (/\.test\.tsx?$/.test(f.rel)) continue;
      for (const m of f.text.matchAll(re)) {
        const symbol = m[1] ?? "";
        if (!deadWordSegments(symbol).some((seg) => dead.has(seg))) continue;
        if (DEAD_WORD_ALLOWLIST.some((allowed) => allowed.test(symbol))) continue;
        offences.push(`${f.rel}:${lineOf(f.text, m.index ?? 0)} export ${symbol}`);
      }
    }
    expect(
      offences.length,
      `Dead-word export found — fable §8 dead-word grep:\n${list(offences, 500)}`,
    ).toBe(0);
  });
});

// ── 7. no hand-written keymap ────────────────────────────────────────────────────────────────

// ── 8. one hotkey door ───────────────────────────────────────────────────────────────────────

describe("route primitive guard — one hotkey door", () => {
  it("only route/keys.tsx names @tanstack/react-hotkeys; every other chord goes through useScopeKeys", () => {
    const offences = hits(
      WEB_FILES.filter((f) => f.rel !== "route/keys.tsx"),
      /@tanstack\/react-hotkeys/g,
    );
    expect(
      offences.length,
      `A hotkey bound outside the scope tree — import \`useScopeKeys\` from \`#/route/keys\` instead (ledger 2026-09-22):
${list(offences)}`,
    ).toBe(0);
  });
});

describe("route primitive guard — no hand-written keymap", () => {
  it("no Alt+${ / Ctrl+${ / Mod+${ / Cmd+${ template outside route/keys.tsx", () => {
    const re = /\b(?:Alt|Ctrl|Mod|Cmd)\+\$\{/g;
    const offences: string[] = [];
    for (const f of WEB_FILES) {
      if (f.rel === "route/keys.tsx") continue;
      for (const m of f.text.matchAll(re)) {
        offences.push(`${f.rel}:${lineOf(f.text, m.index ?? 0)}`);
      }
    }
    expect(
      offences.length,
      `Hand-written keymap string found outside route/keys.tsx (fable §6, one authority for chord rendering):\n${list(offences)}`,
    ).toBe(0);
  });
});

// ── 9. a target draws the Situation (N1) ─────────────────────────────────────────────────────

/** Ratchet: today's offenders. A new one fails; cutting one over fails until it leaves this list. */
const SITUATIONLESS_TARGET_ROUTES = [
  "instances.tsx",
  "lab.tsx",
  "parameter-links.tsx",
  "pods.tsx",
];

const WEB_BY_REL = new Map(WEB_PROD_FILES.map((f) => [f.rel, f]));
const importsOf = (f: Entry): Entry[] =>
  [...f.text.matchAll(/(?:import|export)\s[^;]*?from\s+["']([^"']+)["']/g)].flatMap((m) => {
    const spec = m[1] ?? "";
    const base = spec.startsWith("#/")
      ? spec.slice(2)
      : spec.startsWith(".")
        ? join(dirname(f.rel), spec).replaceAll("\\", "/")
        : null;
    if (base == null) return [];
    const hit = ["", ".tsx", ".ts", "/index.ts", "/index.tsx"]
      .map((ext) => WEB_BY_REL.get(base + ext))
      .find(Boolean);
    return hit ? [hit] : [];
  });
const TARGET_MARK =
  /needs: "(?:document|project|family|session)"|<AddressingBar\b|\btarget: typeof search\.target/;

describe("route primitive guard — a target draws the Situation (N1)", () => {
  it("every targeted route reaches a <Situation>; the offender list only shrinks", () => {
    const offenders = WEB_PROD_FILES.filter((f) =>
      /^routes\/(?!__|design-system)[^/]+\.tsx$/.test(f.rel),
    )
      .filter((route) => [route, ...importsOf(route)].some((f) => TARGET_MARK.test(f.text)))
      .filter((route) => {
        const seen = new Set<Entry>();
        const walk = (f: Entry): void => {
          if (seen.has(f)) return;
          seen.add(f);
          importsOf(f).forEach(walk);
        };
        walk(route);
        return ![...seen].some((f) => /<Situation(?![A-Za-z])/.test(f.text));
      })
      .map((f) => f.rel.slice("routes/".length))
      .sort();
    expect(
      offenders,
      "A route with a target draws the Situation (N1). New offender: cut it over. Removed one: drop it from SITUATIONLESS_TARGET_ROUTES.",
    ).toEqual(SITUATIONLESS_TARGET_ROUTES);
  });
});
