import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import ts from "typescript";
import { expect, test } from "vite-plus/test";
import { files, root, syntax, walk } from "./unification-2-census.ts";

const sources = files("ts").filter((p) => p.includes("/src/") && /\.[cm]?tsx?$/.test(p) && !/(?:\/vendor\/|\/generated\/|\.generated\.|\.test\.)/.test(p));
export function silentCatches(text: string) {
  const found: string[] = [];
  const source = syntax(text);
  const silent = (body: ts.Node) => ts.isBlock(body)
    ? body.statements.length === 0 || body.statements.every((s) => ts.isReturnStatement(s) && (!s.expression || /^(?:null|undefined)$/.test(s.expression.getText(source))))
    : /^(?:null|undefined)$/.test(body.getText(source));
  walk(source, (n) => {
    if (ts.isCatchClause(n) && silent(n.block)) found.push(n.getText(source));
    if (ts.isCallExpression(n) && ts.isPropertyAccessExpression(n.expression) && n.expression.name.text === "catch")
      for (const arg of n.arguments)
        if ((ts.isArrowFunction(arg) || ts.isFunctionExpression(arg)) && silent(arg.body)) found.push(n.getText(source));
  });
  return found;
}
test("first-party src never silently swallows failures", () => {
  expect(sources.flatMap((p) => silentCatches(readFileSync(resolve(root, p), "utf8")).map((s) => `${p}: ${s}`))).toEqual([]);
});
test("every source TODO cites an existing ledger Owed item", () => {
  const missing: string[] = [];
  for (const p of sources) {
    const source = readFileSync(resolve(root, p), "utf8");
    const parsed = syntax(source, p);
    const comments = new Map<number, ts.CommentRange>();
    walk(parsed, (node) => {
      for (const range of [...(ts.getLeadingCommentRanges(source, node.pos) ?? []), ...(ts.getTrailingCommentRanges(source, node.end) ?? [])]) comments.set(range.pos, range);
    });
    for (const range of comments.values()) {
      const comment = source.slice(range.pos, range.end);
      if (!/\bTODO(?:\([^)]*\))?:/.test(comment)) continue;
      const link = comment.match(/docs\/features\/[\w-]+\/LEDGER\.md#([\w-]+)/);
      const ledger = link ? readFileSync(resolve(root, link[0]!.split("#")[0]!), "utf8").split("## Owed")[1] ?? "" : "";
      if (!link || !ledger.includes(`id="${link[1]}"`)) missing.push(`${p}: ${comment}`);
    }
  }
  expect(missing).toEqual([]);
});
test("silent-catch detector covers blocks and constant fallbacks", () => {
  expect(silentCatches(`try {} catch {} a.catch(() => {}); b.catch(() => null); c.catch(() => { return undefined; });`)).toHaveLength(4);
  expect(silentCatches(`a.catch(error => { console.error(error); }); try {} catch (error) { throw error; }`)).toEqual([]);
});

test("route actions cannot offer unscoped compute-all verbs", () => {
  const found: string[] = [];
  for (const p of sources.filter((p) => p.startsWith("ts/apps/web/src/"))) {
    const source = syntax(readFileSync(resolve(root, p), "utf8"), p);
    walk(source, (node) => {
      if ((ts.isStringLiteralLike(node) || ts.isJsxText(node)) && /\b(?:read|compute|calculate) (?:all|every) (?:system|model|document|network)/i.test(node.text)) found.push(`${p}: ${node.text}`);
      if (ts.isPropertyAssignment(node) && node.name.getText(source) === "readAll") found.push(`${p}: readAll action`);
    });
  }
  expect(found).toEqual([]);
});
