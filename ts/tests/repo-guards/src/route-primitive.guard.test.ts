import { execFileSync } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";
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

/**
 * Every place web production code can start a long-lived HTTP stream, by call site. The host is
 * HTTP/1.1, so a browser gives the origin 6 sockets for every tab at once; a second stream per tab
 * starves ordinary requests (2026-11-11, `host/connection-budget.test.ts`). The text
 * `new EventSource(` once was not enough: an exported wrapper around it had five callers.
 *
 * `transport` is `new EventSource(` inside `class PeReadings`, the one owner that may hold a
 * socket. `openers` is everything that starts a stream: a `PeReadings` built, an `EventSource`
 * built or named as a value anywhere else (an alias or a wrapper is an opener for every caller),
 * and a fetch body read as a stream.
 */
const streamOpeners = (files: Pick<Entry, "rel" | "text">[]) => {
  const transport: string[] = [];
  const openers: string[] = [];
  for (const file of files) {
    if (!/\.tsx?$/.test(file.rel)) continue;
    const source = ts.createSourceFile(file.rel, file.text, ts.ScriptTarget.Latest, true);
    const at = (node: ts.Node, what: string) =>
      `${file.rel}:${source.getLineAndCharacterOfPosition(node.getStart()).line + 1} ${what}`;
    const inside = (node: ts.Node, name: string): boolean =>
      !!node.parent &&
      ((ts.isClassDeclaration(node.parent) && node.parent.name?.text === name) ||
        inside(node.parent, name));
    const typed = (node: ts.Node): boolean =>
      !!node.parent && (ts.isTypeNode(node.parent) || typed(node.parent));
    const visit = (node: ts.Node): void => {
      if (ts.isIdentifier(node) && node.text === "EventSource" && !typed(node)) {
        const built = ts.isNewExpression(node.parent) && node.parent.expression === node;
        if (built && inside(node, "PeReadings")) transport.push(at(node, "new EventSource("));
        else openers.push(at(node, built ? "new EventSource(" : "EventSource named as a value"));
      }
      if (ts.isNewExpression(node) && node.expression.getText(source) === "PeReadings")
        openers.push(at(node, "new PeReadings("));
      if (ts.isPropertyAccessExpression(node) && node.name.text === "getReader")
        openers.push(at(node, "a body read as a stream"));
      if (ts.isStringLiteralLike(node) && node.text === "text/event-stream")
        openers.push(at(node, "text/event-stream"));
      ts.forEachChild(node, visit);
    };
    visit(source);
  }
  return { transport, openers };
};

describe("route primitive guard — one stream, one registry", () => {
  it("exactly one stream opener, by call site, and exactly one `AtomRegistry.make(` in apps/web/src production files", () => {
    // Test stand-ins (a fake stream, jsdom's missing constructor) open nothing in a browser.
    const { transport, openers } = streamOpeners(
      WEB_PROD_FILES.filter((f) => !/\.test[.-]|(?:^|\/)test-setup\.ts$/.test(f.rel)),
    );
    const registryHits = hits(WEB_PROD_FILES, /AtomRegistry\.make\(/g);
    expect(
      transport.length,
      `Expected exactly one \`new EventSource(\`, inside class PeReadings (fable law 5):\n${list(transport)}`,
    ).toBe(1);
    expect(
      openers,
      `Expected exactly one long-lived stream opener, the \`peReadings\` owner. A push is a Reading kind on its stream, never a second stream (the origin has 6 sockets):\n${list(openers)}`,
    ).toEqual([expect.stringMatching(/^host\/resource-stream\.ts:\d+ new PeReadings\($/)]);
    expect(
      registryHits.length,
      `Expected exactly one \`AtomRegistry.make(\` in apps/web/src production files (fable law 5):\n${list(registryHits)}`,
    ).toBe(1);
  });

  it("the count is by call site: a wrapper, an alias, a second owner and a streamed fetch are each an opener", () => {
    const owner = `class PeReadings { constructor(private connect = (url: string) => new EventSource(url)) {} }
export const peReadings = new PeReadings();`;
    const count = (extra: string) =>
      streamOpeners([
        { rel: "host/resource-stream.ts", text: owner },
        { rel: "extra.ts", text: extra },
      ]).openers.length;
    expect(count("type Source = Pick<EventSource, 'close'>; // new EventSource(")).toBe(1);
    // What slipped past the text count (2026-11-11): one `new EventSource(`, exported, five callers.
    expect(count("export const openEventSource = (url: string) => new EventSource(url);")).toBe(2);
    expect(count("const Stream = EventSource; new Stream('/x');")).toBe(2);
    expect(count("const tail = new PeReadings(() => '/pe/resources');")).toBe(2);
    expect(count("const reader = (await fetch('/x')).body!.getReader();")).toBe(2);
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
