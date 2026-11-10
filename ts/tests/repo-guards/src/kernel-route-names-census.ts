import { execFileSync } from "node:child_process";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import ts from "typescript";
import { routeDirectory } from "../../../packages/agent-contracts/src/generated/route-directory.ts";
import { files, identity, resolveModule, root, syntax, walk } from "./unification-2-census.ts";

export const kernelRouteBaselinePath = "ts/tests/repo-guards/src/kernel-route-names.baseline.json";
export interface KernelRouteBaseline {
  paths: string[];
  sites: { routeNames: string[] };
}
const directories = ["ts/packages/runtime/src"];
const readRoot = "ts/apps/host/src/reads";
// Ownership is reviewed per file, never inferred from a generated-file glob.
export const readFileOwnership = {
  "evaluator.ts": { owner: "kernel", reason: "Tracked evaluation, Values and publications" },
  "events.ts": { owner: "kernel", reason: "Publication invalidation SSE transport" },
  "history-routes.ts": { owner: "kernel", reason: "Generic History HTTP admission and dispatch" },
  "history.ts": { owner: "kernel", reason: "Durable publication History and replay" },
  "inputs.ts": { owner: "kernel", reason: "Tracked native, Work, file and document inputs" },
  "invalidations.ts": { owner: "kernel", reason: "Shared input invalidation subscriptions" },
  "routes.ts": { owner: "kernel", reason: "Read registry and generic HTTP dispatcher" },
} as const satisfies Record<string, { owner: "kernel" | "route-owned" | "generated"; reason: string }>;
const ownership = new Map(Object.entries(readFileOwnership));
// Import ownership, not an occurrence allowance: the picture currency serves every caller/route.
const kernelHostServices = new Map([
  ["ts/apps/host/src/captures-route.ts", "Product-wide PictureCaptureStore and immutable image resource transport"],
]);
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
  file.startsWith(readRoot + "/") && ownership.get(file.slice(readRoot.length + 1))?.owner === "kernel" ||
  file.startsWith(host + "/") && /^work-[^/]+\.ts$/.test(file.slice(host.length + 1)) ||
  file.startsWith(shell + "/") && /^(?:typed-|work-)[^/]+\.tsx?$/.test(file.slice(shell.length + 1))
);

export function kernelRouteInventory(requiredPaths: readonly string[] = []) {
  const tracked = execFileSync("git", ["ls-files", "-z", "--", ...directories, readRoot, host, shell, ...required],
    { cwd: root, encoding: "utf8" }).split("\0").filter(Boolean);
  const readPaths = [...new Set([...files(readRoot), ...tracked.filter(file => file.startsWith(readRoot + "/")),
    ...Object.keys(readFileOwnership).map(name => `${readRoot}/${name}`)])].sort();
  for (const file of readPaths) {
    if (!ownership.has(file.slice(readRoot.length + 1))) throw Error(`Unclassified read file: ${file}`);
    readFileSync(resolve(root, file)); // Reviewed exclusions must exist too; a rename requires review.
  }
  for (const file of requiredPaths)
    if (!selected(file)) throw Error(`Non-kernel path enrolled in kernel baseline: ${file}`);
  const discovered = [...required, ...readPaths.filter(selected)];
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
  // The index still names deleted tracked files; the enrolled manifest also survives committed renames.
  const paths = [...new Set([...discovered, ...tracked.filter(selected), ...requiredPaths])].sort();
  const names = routeDirectory.map(({ key }) => key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  const types = names.map(name => name.replace(/(^|-)([a-z])/g, (_, _dash, letter) => letter.toUpperCase()));
  const constants = routeDirectory.map(({ key }) => key.replaceAll("-", "_").toUpperCase());
  const upperSnake = new RegExp(`\\b(?:${constants.join("|")})(?:_[A-Z0-9_]+)?\\b`);
  const routeName = new RegExp(`(?:["'/](?:${names.join("|")})(?=[./"'-])|\\b(?:${types.join("|")})(?=[A-Z]|\\b)|${upperSnake.source})`);
  const literalName = new RegExp(`(?:["'/](?:${names.join("|")})(?=[./"'?#]|$))`);
  const importName = new RegExp(`(?:["'/](?:${names.join("|")})(?=[./"'-]|$))`);
  const requestType = new RegExp(`\\b(?:${types.join("|")})(?=[A-Z]|\\b)`);
  // Open is also an imperative; Pods is also the product content noun. Their route ids/types
  // still count, but those unqualified prose words alone do not identify a UI route.
  const proseRoute = new RegExp(`\\b(?:${types.filter(name => !["Open", "Pods"].includes(name)).join("|")})(?=[A-Z]|\\b)`);
  type Site = { file: string; line: number; token: string; site: string };
  const details: Site[] = [], falsePositives: (Site & { reason: string })[] = [];
  for (const file of paths) {
    const text = readFileSync(resolve(root, file), "utf8"); // Every listed/scanned path must exist.
    const source = syntax(text, file), comments = new Set<number>(), queryKeys = new Set<string>(), workRegisters = new Set<string>();
    walk(source, node => {
      if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer && ts.isObjectLiteralExpression(node.initializer)) {
        const fields = new Map(node.initializer.properties.flatMap(property =>
          ts.isPropertyAssignment(property) && ts.isIdentifier(property.name) && ts.isStringLiteral(property.initializer)
            ? [[property.name.text, property.initializer.text] as const] : []));
        // The symbol names the generic open-Work register protocol, not the Open UI route.
        if (fields.get("targetKey") === "open-work" && fields.get("route") === "register" &&
          node.name.text === `${fields.get("targetKey")!.split("-")[0]!.toUpperCase()}_${fields.get("route")!.toUpperCase()}`)
          workRegisters.add(node.name.text);
      }
      if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer &&
        ts.isArrowFunction(node.initializer) && node.initializer.parameters.length === 1) {
        const parameter = node.initializer.parameters[0]!.name;
        if (!ts.isIdentifier(parameter)) return;
        let query = false;
        walk(node.initializer.body, child => {
          if (ts.isCallExpression(child) && ts.isPropertyAccessExpression(child.expression) &&
            child.expression.name.text === "get" && ts.isPropertyAccessExpression(child.expression.expression) &&
            child.expression.expression.name.text === "searchParams" && child.arguments.length === 1 &&
            ts.isIdentifier(child.arguments[0]!) && child.arguments[0]!.text === parameter.text) query = true;
        });
        if (query) queryKeys.add(node.name.text);
      }
    });
    const take = (node: ts.Node, token: string, position: number, kind: string, real: boolean, reason: string) => {
      if (!routeName.test(token)) return;
      const site = `${identity(node)}:${kind}:${token}`;
      const found = { file, line: source.getLineAndCharacterOfPosition(position).line + 1, token, site };
      if (real) details.push(found);
      else falsePositives.push({ ...found, reason });
    };
    walk(source, node => {
      if (ts.isStringLiteralLike(node) || ts.isTemplateHead(node) || ts.isTemplateMiddle(node) || ts.isTemplateTail(node)) {
        const parent = node.parent;
        const module = ts.isImportDeclaration(parent) || ts.isExportDeclaration(parent) || ts.isExternalModuleReference(parent) ||
          ts.isCallExpression(parent) && (parent.expression.kind === ts.SyntaxKind.ImportKeyword ||
            ts.isIdentifier(parent.expression) && parent.expression.text === "require") ||
          ts.isLiteralTypeNode(parent) && ts.isImportTypeNode(parent.parent);
        const token = JSON.stringify(node.text);
        // Prose is not a type name. Web entry filenames are not navigation route ids.
        const value = JSON.stringify(node.text.replace(/[^/]+\.(?:html|css|js|mjs|png|jpe?g|svg)(?=[?#]|$)/, "__asset__"));
        let real = (module ? importName : literalName).test(module ? token : value) || !module && (proseRoute.test(node.text) || upperSnake.test(node.text));
        let reason = "Prose/asset filename is not a route identifier or request type";
        let role = node as ts.Node;
        while (ts.isAsExpression(role.parent) || ts.isSatisfiesExpression(role.parent) || ts.isParenthesizedExpression(role.parent)) role = role.parent;
        const owner = role.parent;
        const tag = ts.isPropertyAssignment(owner) ? owner.name.getText(source) :
          ts.isBinaryExpression(owner) && ts.isPropertyAccessExpression(owner.left) ? owner.left.name.text : "";
        const readModule = file.startsWith(readRoot + "/") ? file.slice(readRoot.length + 1) : "";
        const ownService = ownership.get(readModule)?.owner === "kernel" &&
          ts.isCallExpression(parent) && ts.isIdentifier(parent.expression) && parent.expression.text === "read" &&
          parent.arguments[0] === node && node.text.startsWith(readModule.replace(/\.ts$/, "") + ".");
        const kernelImport = module ? kernelHostServices.get(resolveModule(file, node.text) ?? "") : undefined;
        if (kernelImport) {
          real = false; reason = `Imported kernel service: ${kernelImport}`;
        } else if (ownService) {
          real = false; reason = "Generic read declaration uses its reviewed kernel module service namespace";
        } else if (node.text === "open" && tag === "binding" || ["open", "captures"].includes(node.text) && tag === "kind") {
          real = false; reason = "Generic Work/document/resource discriminator";
        } else if (node.text === "open" && ts.isLiteralTypeNode(parent) && ts.isIndexedAccessTypeNode(parent.parent)) {
          real = false; reason = "UseSource.open method selector";
        } else if (ts.isCallExpression(parent) && ts.isIdentifier(parent.expression) && queryKeys.has(parent.expression.text)) {
          real = false; reason = "URLSearchParams key lookup, not a route selection";
        } else if (node.text === "open" && ts.isBinaryExpression(parent) && ts.isIdentifier(parent.left) && parent.left.text === "instance") {
          for (let scope: ts.Node | undefined = parent; scope; scope = scope.parent) {
            if (!ts.isIfStatement(scope)) continue;
            let views = false;
            walk(scope.expression, child => { if (ts.isStringLiteral(child) && child.text === "route-view") views = true; });
            if (views) { real = false; reason = "Generic views channel open verb"; break; }
          }
        }
        take(node, token, node.getStart(source), ts.SyntaxKind[node.kind], real, reason);
      } else if (ts.isIdentifier(node)) {
        take(node, node.text, node.getStart(source), "Identifier", (requestType.test(node.text) || upperSnake.test(node.text)) && !workRegisters.has(node.text),
          workRegisters.has(node.text) ? "Generic open-Work register protocol symbol" : "Identifier is not a route request type");
      }
      for (const comment of [...(ts.getLeadingCommentRanges(text, node.getFullStart()) ?? []),
        ...(ts.getTrailingCommentRanges(text, node.getEnd()) ?? [])]) {
        if (comments.has(comment.pos)) continue;
        comments.add(comment.pos);
        const prose = text.slice(comment.pos, comment.end).replace(/\s+/g, " ");
        take(node, prose, comment.pos, "Comment", proseRoute.test(prose) || upperSnake.test(prose),
          "Generic prose word does not identify a UI route or request type");
      }
    });
  }
  return { paths, sites: { routeNames: details.map(item => item.site).sort() }, details, falsePositives, readFiles: readPaths.map(file => ({ file, ...ownership.get(file.slice(readRoot.length + 1))! })) };
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
