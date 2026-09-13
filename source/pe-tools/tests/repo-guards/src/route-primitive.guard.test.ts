/**
 * =============================================================================================
 * THE ROUTE PRIMITIVE GUARD — mechanical proof for route-primitive-fable.html §8.
 * =============================================================================================
 *
 * Lives (once promoted) at source/pe-tools/tests/repo-guards/route-primitive.guard.test.ts —
 * same runner (`vp test`) and posture as design-guard.test.ts / docs-guard.test.ts: plain fs
 * walks, plain regexes, no AST, no new dependency. Written ahead of the cutover it proves;
 * several `it`s are EXPECTED RED until the fold named in guards/README.md lands.
 *
 * One `it` per row of fable §8:
 *  1. no fixture lane leak        no fixture*.ts(x)/fixtures.ts file, no "fixture" literal
 *                                 outside *.test.*, under apps/web/src.
 *  2. dead importers              nothing imports targeting/model, targeting/actions,
 *                                 host/route-target, host/target, state/route-store,
 *                                 targeting/flow, targeting/kit (fold-2-paper.md disposal list).
 *  3. no react-query               no @tanstack/react-query in a package.json or an import.
 *  4. one manifest per route      every routes/*.tsx (excluding __root.tsx, -*.test.tsx,
 *                                 design-system_*) exports exactly one `export const manifest`.
 *  5. one stream, one registry    exactly one `new EventSource(` and one `AtomRegistry.make(`
 *                                 in apps/web/src production files.
 *  6. dead-word grep              exported Scope/World/Verb/Feed/Lane/Bound/Multi/Stage/Slot
 *                                 identifiers (or PascalCase prefixes) in apps/web/src and
 *                                 packages/agent-contracts/src. Allowlist is empty by ruling.
 *  7. no hand-written keymap      no `Alt+${` / `Ctrl+${` / `Mod+${` / `Cmd+${` template
 *                                 outside route/keys.tsx.
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

const WEB_SRC = resolve(REPO, "source/pe-tools/apps/web/src");
const AGENT_CONTRACTS_SRC = resolve(REPO, "source/pe-tools/packages/agent-contracts/src");
const PE_TOOLS_ROOT = resolve(REPO, "source/pe-tools");

type Entry = { rel: string; abs: string; text: string };

/** Walk `dir`, returning every file matching `match`, `rel` relative to `dir`. */
const collect = (dir: string, match: RegExp, skipDirs = new Set(["node_modules", "dist", ".turbo"])): Entry[] => {
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
  it("no fixture*.ts(x)/fixtures.ts file and no \"fixture\" literal outside *.test.* under apps/web/src", () => {
    const fixtureFiles = WEB_FILES.filter((f) => /(^|\/)fixtures?\.tsx?$/i.test(f.rel) || /(^|\/)fixture[^/]*\.tsx?$/i.test(f.rel));
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
];

describe("route primitive guard — dead importers", () => {
  it("nothing imports targeting/model, targeting/actions, host/route-target, host/target, state/route-store, targeting/flow, targeting/kit", () => {
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
    const pkgOffences = PACKAGE_JSONS.filter((f) => f.text.includes("@tanstack/react-query")).map((f) => f.rel);
    const importOffences = hits(WEB_FILES, /["']@tanstack\/react-query["']/g);
    const offences = [...pkgOffences, ...importOffences];
    expect(
      offences.length,
      `@tanstack/react-query still referenced — the dependency is gone (fable law 5):\n${list(offences)}`,
    ).toBe(0);
  });
});

// ── 4. one manifest per route ────────────────────────────────────────────────────────────────

describe("route primitive guard — one manifest per route", () => {
  it("every routes/*.tsx (excluding __root.tsx, -*.test.tsx, design-system_*) exports exactly one `export const manifest`", () => {
    const routeFiles = WEB_FILES.filter(
      (f) =>
        /^routes\/[^/]+\.tsx$/.test(f.rel) &&
        f.rel !== "routes/__root.tsx" &&
        !/^routes\/-.*\.test\.tsx$/.test(f.rel) &&
        !f.rel.startsWith("routes/design-system_"),
    );
    expect(routeFiles.length, "no route files found — the corpus query is wrong").toBeGreaterThan(0);

    const offences: string[] = [];
    for (const f of routeFiles) {
      const count = [...f.text.matchAll(/export const manifest\b/g)].length;
      if (count !== 1) offences.push(`${f.rel} (found ${count})`);
    }
    expect(
      offences.length,
      `Route files must export exactly one \`export const manifest\` (fable §3, fold-2-paper.md naming ruling):\n${list(offences)}`,
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

/** Ruling: this allowlist stays empty. Do not add a line without a ledger entry. */
const DEAD_WORD_ALLOWLIST: readonly string[] = [];

const DEAD_WORDS = ["Scope", "World", "Verb", "Feed", "Lane", "Bound", "Multi", "Stage", "Slot"];

describe("route primitive guard — dead-word grep", () => {
  it("no exported Scope/World/Verb/Feed/Lane/Bound/Multi/Stage/Slot identifier (or PascalCase prefix) in apps/web/src or packages/agent-contracts/src", () => {
    const allowed = new Set(DEAD_WORD_ALLOWLIST);
    const wordAlt = DEAD_WORDS.join("|");
    const re = new RegExp(`export\\s+(?:type|interface|const|function|class)\\s+(?:[A-Z][a-z0-9]+)*(${wordAlt})(?=[A-Z0-9_]|\\b)[A-Za-z0-9_]*`, "g");
    const offences: string[] = [];
    for (const f of [...WEB_FILES, ...AGENT_CONTRACTS_FILES]) {
      if (/\.test\.tsx?$/.test(f.rel)) continue;
      for (const m of f.text.matchAll(re)) {
        const symbol = m[0].split(/\s+/).pop() ?? "";
        const loc = `${f.rel}:${lineOf(f.text, m.index ?? 0)}`;
        if (allowed.has(`${loc} ${symbol}`)) continue;
        offences.push(`${loc} export ${symbol}`);
      }
    }
    expect(
      offences.length,
      `Dead-word export found — fable §8 dead-word grep, allowlist is empty by ruling:\n${list(offences)}`,
    ).toBe(0);
  });
});

// ── 7. no hand-written keymap ────────────────────────────────────────────────────────────────

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
