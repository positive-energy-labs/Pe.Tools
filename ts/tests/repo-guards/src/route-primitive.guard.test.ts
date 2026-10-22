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
const KIT_SRC = resolve(REPO, "ts/packages/kit/src");
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
const KIT_FILES = collect(KIT_SRC, /\.(?:tsx?|css)$/);
const WEB_PROD_FILES = WEB_FILES.filter((f) => !/\.test\.tsx?$/.test(f.rel));
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

// ── 7. no hand-written keymap ────────────────────────────────────────────────────────────────

// ── 8. one hotkey door ───────────────────────────────────────────────────────────────────────

describe("route primitive guard — one hotkey door", () => {
  it("only kit/keys.tsx names @tanstack/react-hotkeys; every other chord goes through useScopeKeys", () => {
    const offences = hits(
      [...WEB_FILES, ...KIT_FILES.filter((f) => f.rel !== "keys.tsx")],
      /@tanstack\/react-hotkeys/g,
    );
    expect(
      offences.length,
      `A hotkey bound outside the scope tree — import \`useScopeKeys\` from \`@pe/kit/keys\` instead (ledger 2026-09-22):
${list(offences)}`,
    ).toBe(0);
  });
});
