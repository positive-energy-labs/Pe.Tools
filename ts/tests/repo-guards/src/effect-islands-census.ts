// ADR 0029 rule 2: every `// effect-edge: island, phase 5` marker is a fiber end phase 5 deletes.
// Counted per file, from real comment tokens (a string that contains the marker is not one), so
// the baseline can only shrink. The `pe/effect-edge` lint rule owns which markers are legal at all.
import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import ts from "typescript";

export const tsRoot = resolve(import.meta.dirname, "../../..");
export type Islands = { src: Record<string, number>; tests: Record<string, number> };

const SKIP = new Set(["node_modules", "dist", "dist-installed", ".artifacts", "bin", "obj"]);
const SOURCE = /\.(?:[cm]?[jt]sx?)$/;
const ISLAND = /^\s*effect-edge:\s*island, phase 5\s*$/;
export const isTestFile = (path: string) =>
  /(^|\/)tests?\//.test(path) || /\.(?:test|scenario\.test)\.[cm]?[jt]sx?$/.test(path);

function walk(dir: string): string[] {
  return readdirSync(resolve(tsRoot, dir), { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory()
      ? SKIP.has(entry.name)
        ? []
        : walk(`${dir}/${entry.name}`)
      : SOURCE.test(entry.name)
        ? [`${dir}/${entry.name}`]
        : [],
  );
}

/** The `//` comment bodies of one source text, as the compiler tokenizes it. */
export function lineComments(text: string, file = "probe.ts"): string[] {
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
  const seen = new Set<number>();
  const found: string[] = [];
  const take = (ranges: ts.CommentRange[] | undefined) => {
    for (const range of ranges ?? [])
      if (range.kind === ts.SyntaxKind.SingleLineCommentTrivia && !seen.has(range.pos)) {
        seen.add(range.pos);
        found.push(text.slice(range.pos + 2, range.end));
      }
  };
  const visit = (node: ts.Node) => {
    take(ts.getLeadingCommentRanges(text, node.getFullStart()));
    take(ts.getTrailingCommentRanges(text, node.getEnd()));
    for (const child of node.getChildren(source)) visit(child);
  };
  visit(source);
  return found;
}

export const islandCount = (text: string, file?: string) =>
  text.includes("effect-edge:") ? lineComments(text, file).filter((c) => ISLAND.test(c)).length : 0;

export function census(): Islands {
  const islands: Islands = { src: {}, tests: {} };
  for (const file of [...walk("apps"), ...walk("packages")].sort()) {
    const count = islandCount(readFileSync(resolve(tsRoot, file), "utf8"), file);
    if (count > 0) islands[isTestFile(file) ? "tests" : "src"][file] = count;
  }
  return islands;
}
