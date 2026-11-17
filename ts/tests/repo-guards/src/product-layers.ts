import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, posix, resolve } from "node:path";
import ts from "typescript";

const root = resolve(import.meta.dirname, "../../..");
export const productPackages = readdirSync(join(root, "products")).flatMap(product =>
  readdirSync(join(root, "products", product)).flatMap(layer => {
    const key = `products/${product}/${layer}`;
    const manifest = join(root, key, "package.json");
    if (!existsSync(manifest)) return [];
    const pkg: { name: string; exports: Record<string, string> } = JSON.parse(readFileSync(manifest, "utf8"));
    return [{ key, product, layer, ...pkg }];
  }));

/** Shared ducts allows same-layer and downward imports via exports; peers expose contracts only. */
export function productLayerViolations(sources: Record<string, string>): string[] {
  const found = new Set<string>();
  for (const [file, text] of Object.entries(sources)) {
    const from = productPackages.find(pkg => file.startsWith(pkg.key + "/"));
    if (!from) continue;
    const edge = (spec: string) => {
      const named = productPackages.find(pkg => spec === pkg.name || spec.startsWith(pkg.name + "/"));
      const path = spec.startsWith(".") ? posix.join(posix.dirname(file), spec) : null;
      const to = named ?? productPackages.find(pkg => path?.startsWith(pkg.key + "/"));
      if (!to) return;
      const subpath = named ? spec === named.name ? "." : "." + spec.slice(named.name.length) : null;
      const declared = subpath !== null && Object.hasOwn(to.exports, subpath);
      const downward = to.layer === "contract" || to.layer === from.layer ||
        (to.layer === "domain" && ["web", "host"].includes(from.layer));
      const forbidden = !downward || (from.product === "ducts" && to.product !== "ducts" && to.layer !== "contract");
      const crossProduct = from.product !== to.product;
      const allowed = to.layer === "contract" || (to.product === "ducts" && downward);
      if (forbidden || (named && !declared) || (crossProduct && (!allowed || !declared)))
        found.add(`${file} -> ${spec}`);
    };
    const ast = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
    const visit = (node: ts.Node) => {
      if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier && ts.isStringLiteralLike(node.moduleSpecifier))
        edge(node.moduleSpecifier.text);
      if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword && node.arguments[0] && ts.isStringLiteralLike(node.arguments[0]))
        edge(node.arguments[0].text);
      if (ts.isImportTypeNode(node) && ts.isLiteralTypeNode(node.argument) && ts.isStringLiteralLike(node.argument.literal))
        edge(node.argument.literal.text);
      ts.forEachChild(node, visit);
    };
    visit(ast);
  }
  return [...found].sort();
}

export function productSources(): Record<string, string> {
  const files = (dir: string, prefix = ""): string[] => readdirSync(join(dir, prefix), { withFileTypes: true }).flatMap(entry => {
    if (["node_modules", ".git"].includes(entry.name)) return [];
    const file = posix.join(prefix, entry.name);
    return entry.isDirectory() ? files(dir, file) : /\.[cm]?tsx?$/.test(file) ? [file] : [];
  });
  return Object.fromEntries(files(join(root, "products")).map(file =>
    [`products/${file}`, readFileSync(join(root, "products", file), "utf8")]));
}
