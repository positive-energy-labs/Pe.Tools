/**
 * =============================================================================================
 * THE DOCS GUARD — the mechanical gate for the docs conventions.
 * =============================================================================================
 *
 * Sibling in spirit to design-guard.test.ts: the convention held by review in
 * .agents/skills/docs/SKILL.md now holds by assertion. Same runner (`vp test`), same posture —
 * no dependencies, plain regexes, no AST, no markdown parser.
 *
 * The corpus is `git ls-files` (shelled once, cached), so untracked scratch — worktree spikes,
 * half-written handoffs, agent temp files — never fails the guard. Only committed docs are
 * governed.
 *
 * ── CHECKS ──────────────────────────────────────────────────────────────────────────────────
 *  1. ledger shape      docs/features/<name>/LEDGER.md has exactly three H2s —
 *                       "Decided", "Tried & rejected", "Owed" — in that order and nothing else.
 *                       SKILL.md §Ledgers: "Ledgers never grow a fourth section."
 *  2. frozen dirs       docs/context/ and docs/rework/ are quarantined (SKILL.md §Frozen).
 *                       No ADDITIONS; the allowlist below is a snapshot that only shrinks.
 *  3. no banners        "A HISTORICAL/CLOSED banner on a tracked doc is a failing state, not an
 *                       archive method" — promotion and deletion happen in the same commit.
 *  4. authority registry  every path in SKILL.md's authority registry exists on disk. The list
 *                       is parsed, not hardcoded, so newly registered docs are checked too.
 *  5. no dangling links  relative .md links from docs/ + the root docs resolve to real files.
 *  6. root allowlist    the repo root carries exactly four .md files and no drive-by additions.
 *
 * TODO: greppable-ban from PRUNE-PROTOCOL (sdk-review-20260818): outside docs/adr/0007 and lines
 * carrying "dies when:", ban SDK mechanics restatements in skills/AGENTS/BUILD — exit-code table
 * rows and `pe-revit ... --flag` spellings outside cited fenced blocks. Spec shifted at beta.117
 * (SDK renamed AttachedRrd/FreshRevitProcess to plain words); re-scope before building.
 * =============================================================================================
 */
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, posix, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vite-plus/test";

// ── the corpus ───────────────────────────────────────────────────────────────────────────────

const HERE = dirname(fileURLToPath(import.meta.url)); // …/apps/web/src
const REPO = execFileSync("git", ["rev-parse", "--show-toplevel"], {
  cwd: HERE,
  encoding: "utf8",
}).trim();

/** Repo-relative POSIX paths of every tracked file. Shelled once; git already prints "/". */
const TRACKED: string[] = execFileSync("git", ["ls-files"], {
  cwd: REPO,
  encoding: "utf8",
  maxBuffer: 64 * 1024 * 1024,
})
  .split("\n")
  .map((l) => l.trim())
  .filter(Boolean);

/** Windows-safe absolute path for a repo-relative POSIX path. */
const abs = (rel: string): string => resolve(REPO, ...rel.split("/"));
const read = (rel: string): string => readFileSync(abs(rel), "utf8");

const MD = TRACKED.filter((p) => p.toLowerCase().endsWith(".md"));
const DOCS_MD = MD.filter((p) => p.startsWith("docs/"));
const ROOT_MD = MD.filter((p) => !p.includes("/"));

const list = (items: string[], cap = 40): string =>
  items
    .slice(0, cap)
    .map((s) => `  ${s}`)
    .join("\n") + (items.length > cap ? `\n  … +${items.length - cap} more` : "");

// ── 1. ledger shape ──────────────────────────────────────────────────────────────────────────

const LEDGER_SECTIONS = ["Decided", "Tried & rejected", "Owed"];

describe("docs guard — ledger shape", () => {
  it("every docs/features/<name>/LEDGER.md has exactly the three canon H2s, in order", () => {
    const ledgers = DOCS_MD.filter((p) => /^docs\/features\/[^/]+\/LEDGER\.md$/.test(p));
    expect(ledgers.length, "no LEDGER.md found — the corpus query is wrong").toBeGreaterThan(0);

    const offences: string[] = [];
    for (const rel of ledgers) {
      const text = read(rel);
      // H2s only, ignoring anything inside fenced code blocks (SKILL.md-style examples).
      const body = text.replace(/^```[\s\S]*?^```/gm, "");
      const found = [...body.matchAll(/^##[ \t]+(.+?)[ \t]*$/gm)].map((m) => m[1]);
      if (JSON.stringify(found) !== JSON.stringify(LEDGER_SECTIONS)) {
        offences.push(`${rel}\n      has: [${found.join(" | ")}]`);
      }
    }
    expect(
      offences.length,
      `Ledgers off the canon shape — exactly [${LEDGER_SECTIONS.join(" | ")}], in that order, no fourth section (docs SKILL.md §Ledgers):\n${list(offences)}`,
    ).toBe(0);
  });
});

// ── 2. frozen dirs ───────────────────────────────────────────────────────────────────────────

/**
 * docs/context/ and docs/rework/ were swept to zero and deleted on 2026-08-17 (every surviving
 * fact folded into a ledger, grounding doc, ADR, or code comment — git history has the long
 * forms). The allowlist is permanently empty: this check now exists so the dirs STAY dead.
 * Never add a line (docs SKILL.md §Frozen).
 */
const FROZEN_ALLOWLIST: readonly string[] = [];

describe("docs guard — frozen dirs", () => {
  it("docs/context/ and docs/rework/ take no new .md (quarantined; the allowlist only shrinks)", () => {
    const allowed = new Set(FROZEN_ALLOWLIST);
    const added = DOCS_MD.filter(
      (p) => (p.startsWith("docs/context/") || p.startsWith("docs/rework/")) && !allowed.has(p),
    );
    expect(
      added.length,
      `New files in a FROZEN dir — docs/context/ and docs/rework/ are quarantined (docs SKILL.md §Frozen). New writing goes to a ledger, an ADR, a handoff, or code:\n${list(added)}`,
    ).toBe(0);
  });
});

// ── 3. no banners ────────────────────────────────────────────────────────────────────────────

const BANNER = /^(> )?\*{0,2}(HISTORICAL|CLOSED|STALE|DEPRECATED)\b/m;

describe("docs guard — no archive banners", () => {
  it("no tracked doc under docs/ opens with a HISTORICAL/CLOSED/STALE/DEPRECATED banner", () => {
    const offences: string[] = [];
    for (const rel of DOCS_MD) {
      const head = read(rel).split("\n").slice(0, 10).join("\n");
      const m = head.match(BANNER);
      if (m) offences.push(`${rel}  ${JSON.stringify(m[0])}`);
    }
    expect(
      offences.length,
      `Archive banners found. A banner is a FAILING STATE, not an archive method (docs SKILL.md §Ledgers): promote what is still true into the owning ledger/ADR/code and DELETE the file in the same commit — git history is the archive:\n${list(offences)}`,
    ).toBe(0);
  });
});

// ── 4. authority registry ────────────────────────────────────────────────────────────────────

const SKILL_REL = ".agents/skills/slot.docs/SKILL.md";

/** Parse the bullet list under "Current registry:" — additions are picked up automatically. */
const registryPaths = (): string[] => {
  const text = read(SKILL_REL);
  const start = text.indexOf("Current registry:");
  expect(start, `"Current registry:" heading not found in ${SKILL_REL}`).toBeGreaterThan(-1);
  const rest = text.slice(start).split("\n").slice(1);
  const out: string[] = [];
  for (const line of rest) {
    if (!line.trimStart().startsWith("- ")) break; // list ends at the first non-bullet line
    for (const m of line.matchAll(/`([^`]+\.md)`/g)) out.push(m[1]);
  }
  return out;
};

describe("docs guard — authority registry", () => {
  it("every path in the docs SKILL.md authority registry exists on disk", () => {
    const paths = registryPaths();
    expect(paths.length, `authority registry parsed empty from ${SKILL_REL}`).toBeGreaterThan(0);
    const missing = paths.filter((p) => !existsSync(abs(p)));
    expect(
      missing.length,
      `Authority registry points at files that do not exist. Either restore the doc or delete its registry line in ${SKILL_REL}:\n${list(missing)}`,
    ).toBe(0);
  });
});

// ── 5. no dangling relative .md links ────────────────────────────────────────────────────────

const ROOT_DOCS = ["AGENTS.md", "CLAUDE.md", "Readme.md"].filter((p) => TRACKED.includes(p));

describe("docs guard — links resolve", () => {
  it("every relative .md link from docs/ and the root docs points at a real file", () => {
    const tracked = new Set(TRACKED);
    const offences: string[] = [];
    for (const rel of [...DOCS_MD, ...ROOT_DOCS]) {
      const text = read(rel);
      for (const m of text.matchAll(/\[[^\]\n]*\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g)) {
        const raw = m[1];
        if (/^(?:[a-z][a-z0-9+.-]*:|\/\/|#)/i.test(raw)) continue; // http(s), mailto, anchor-only
        const target = raw.split("#")[0];
        if (!target || !target.toLowerCase().endsWith(".md")) continue;
        if (target.startsWith(".artifacts/") || target.includes("/.artifacts/")) continue;
        const resolved = posix.normalize(posix.join(posix.dirname(rel), decodeURI(target)));
        if (resolved.startsWith("..")) continue; // outside the repo — not ours to police
        if (!tracked.has(resolved) && !existsSync(join(REPO, ...resolved.split("/")))) {
          offences.push(`${rel} → ${raw}`);
        }
      }
    }
    expect(
      offences.length,
      `Dangling relative .md links — the target was moved or deleted without updating the referrer:\n${list(offences)}`,
    ).toBe(0);
  });
});

// ── 6. root allowlist ────────────────────────────────────────────────────────────────────────

/** The repo root is not a docs home. Four files, all of them entry points. */
const ROOT_ALLOWLIST = new Set(["AGENTS.md", "CLAUDE.md", "Readme.md", "TASTE.md"]);

describe("docs guard — repo root", () => {
  it("only AGENTS.md / CLAUDE.md / Readme.md / CONTEXT.md live at the repo root", () => {
    const strays = ROOT_MD.filter((p) => !ROOT_ALLOWLIST.has(p));
    expect(
      strays.length,
      `Stray root-level .md. The root carries exactly [${[...ROOT_ALLOWLIST].join(", ")}]; everything else belongs in a ledger, an ADR, a skill, or nowhere:\n${list(strays)}`,
    ).toBe(0);
  });
});
