/**
 * THE LINE BUDGET — no route file exceeds 600 lines (design-system ledger, 2026-09-22). Plain fs
 * walk: every top-level `apps/web/src/route/*.ts|tsx` that is not a test. A file over budget splits
 * along its own sections into files named for the responsibility; it never gains an allowance
 * here without a ledger Owed line to split it.
 */
import { execFileSync } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, it } from "vite-plus/test";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = execFileSync("git", ["rev-parse", "--show-toplevel"], {
  cwd: HERE,
  encoding: "utf8",
}).trim();
const ROUTE = resolve(REPO, "ts/apps/web/src/route");
const BUDGET = 600;

/** Out of crusade-measured's scope; split owed in docs/features/design-system/LEDGER.md. */
const LINE_BUDGET_ALLOW: Readonly<Record<string, number>> = { "spec-editor.tsx": 717 };

const linesOf = (text: string) => text.split("\n").length - (text.endsWith("\n") ? 1 : 0);

it(`every route/*.ts|tsx is at most ${BUDGET} lines, or its allowance`, () => {
  const over = readdirSync(ROUTE, { withFileTypes: true })
    .filter((entry) => entry.isFile() && /\.tsx?$/.test(entry.name) && !/\.test\./.test(entry.name))
    .flatMap((entry) => {
      const lines = linesOf(readFileSync(join(ROUTE, entry.name), "utf8"));
      const budget = LINE_BUDGET_ALLOW[entry.name] ?? BUDGET;
      return lines > budget ? [`route/${entry.name}: ${lines} > ${budget}`] : [];
    });
  expect(over, over.join("\n")).toEqual([]);
});
