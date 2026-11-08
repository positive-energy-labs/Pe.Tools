import { execFileSync } from "node:child_process";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import ts from "typescript";
import { routeDirectory } from "../../../packages/agent-contracts/src/generated/route-directory.ts";
import { files, identity, root, syntax, walk } from "./unification-2-census.ts";

export const kernelRouteBaselinePath = "ts/tests/repo-guards/src/kernel-route-names.baseline.json";
export interface KernelRouteBaseline {
  paths: string[];
  sites: { routeNames: string[] };
}
const directories = ["ts/packages/runtime/src", "ts/apps/host/src/reads"];
const host = "ts/apps/host/src", shell = "ts/apps/web/src/shell";
// Retain coverage of the existing contracts/adapters outside the requested directory scopes.
const required = [
  `${host}/pe-routes.ts`, `${host}/action-journal.ts`, `${host}/document-lifetime.ts`,
  `${host}/journal-snapshot.ts`, "ts/packages/mcps/src/shared/takeoff-action-client.ts",
  "ts/packages/agent-contracts/src/write-intent.ts",
];
const production = (file: string) => /\.tsx?$/.test(file) && !/(?:\.test[.-]|\.fixture[.-]|\/tests?\/)/.test(file);
const selected = (file: string) => production(file) && (
  required.includes(file) || directories.some(dir => file.startsWith(dir + "/")) ||
  file.startsWith(host + "/") && /^work-[^/]+\.ts$/.test(file.slice(host.length + 1)) ||
  file.startsWith(shell + "/") && /^(?:typed-|work-)[^/]+\.tsx?$/.test(file.slice(shell.length + 1))
);

export function kernelRouteInventory(requiredPaths: readonly string[] = []) {
  const discovered = [...required];
  for (const dir of directories) {
    const found = files(dir).filter(production); // Missing directories throw; an empty scan is not green.
    if (!found.length) throw Error(`No kernel sources found in ${dir}`);
    discovered.push(...found);
  }
  for (const [dir, prefix] of [[host, "work-"], [shell, "typed-"], [shell, "work-"]] as const) {
    const found = readdirSync(resolve(root, dir)).map(name => `${dir}/${name}`)
      .filter(file => file.slice(dir.length + 1).startsWith(prefix) && selected(file));
    if (!found.length) throw Error(`No kernel sources found in ${dir}/${prefix}*`);
    discovered.push(...found);
  }
  // The index still names a deleted/renamed tracked file. A filesystem-only walk would lose it.
  const tracked = execFileSync("git", ["ls-files", "-z", "--", ...directories, host, shell, ...required],
    { cwd: root, encoding: "utf8" }).split("\0").filter(file => file && selected(file));
  const paths = [...new Set([...discovered, ...tracked, ...requiredPaths])].sort();
  const names = routeDirectory.map(({ key }) => key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  const types = names.map(name => name.replace(/(^|-)([a-z])/g, (_, _dash, letter) => letter.toUpperCase()));
  const routeName = new RegExp(`(?:["'/](?:${names.join("|")})(?=[./"'-])|\\b(?:${types.join("|")})(?=[A-Z]|\\b))`);
  const details: { file: string; line: number; token: string; site: string }[] = [];
  for (const file of paths) {
    const text = readFileSync(resolve(root, file), "utf8"); // Every listed/scanned path must exist.
    const source = syntax(text, file), comments = new Set<number>();
    const take = (node: ts.Node, token: string, position: number, kind: string) => {
      if (!routeName.test(token)) return;
      const site = `${identity(node)}:${kind}:${token}`;
      details.push({ file, line: source.getLineAndCharacterOfPosition(position).line + 1, token, site });
    };
    walk(source, node => {
      if (ts.isStringLiteralLike(node) || ts.isTemplateHead(node) || ts.isTemplateMiddle(node) || ts.isTemplateTail(node)) {
        // Work's binding tag shares a word with navigation; its enum use is not a route reference.
        const binding = node.text === "open" && ts.isBinaryExpression(node.parent) &&
          ts.isPropertyAccessExpression(node.parent.left) && node.parent.left.name.text === "binding";
        if (!binding) take(node, JSON.stringify(node.text), node.getStart(source), ts.SyntaxKind[node.kind]);
      } else if (ts.isIdentifier(node)) {
        take(node, node.text, node.getStart(source), "Identifier");
      }
      for (const comment of [...(ts.getLeadingCommentRanges(text, node.getFullStart()) ?? []),
        ...(ts.getTrailingCommentRanges(text, node.getEnd()) ?? [])]) {
        if (comments.has(comment.pos)) continue;
        comments.add(comment.pos);
        take(node, text.slice(comment.pos, comment.end).replace(/\s+/g, " "), comment.pos, "Comment");
      }
    });
  }
  return { paths, sites: { routeNames: details.map(item => item.site).sort() }, details };
}

/** Every committed allowance set is a floor: identities and duplicate caps can only shrink. */
export function kernelRouteFloors(): KernelRouteBaseline[] {
  const commits = execFileSync("git", ["log", "--format=%H", "--", kernelRouteBaselinePath],
    { cwd: root, encoding: "utf8" }).trim().split(/\s+/).filter(Boolean);
  return commits.flatMap(commit => {
    const entry = execFileSync("git", ["ls-tree", commit, "--", kernelRouteBaselinePath], { cwd: root, encoding: "utf8" });
    return entry ? [JSON.parse(execFileSync("git", ["show", `${commit}:${kernelRouteBaselinePath}`],
      { cwd: root, encoding: "utf8" })) as KernelRouteBaseline] : [];
  });
}
