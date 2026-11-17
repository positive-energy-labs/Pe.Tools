import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { expect, test } from "vite-plus/test";
import { module as ducts } from "@pe/duct-systems-web/route";
import { module as fans } from "../route.ts";

/*
 * Slice 8's Deletes column (routes MAP row 8; owner ruling 2026-11-11): /fans and /ducts declare
 * `picture` and the kernel draws the pane. Neither route mounts a `Picture`, and the borrowed body's
 * cross-imports are gone: 22 from `fans/picture.tsx` into web `ducts/`, and `FansDrawContext` back.
 */
const src = fileURLToPath(new URL("./", import.meta.url)).replaceAll("\\", "/");
const products = fileURLToPath(new URL("../../../", import.meta.url)).replaceAll("\\", "/").replace(/\/$/, "");
const files = (dir: string): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((entry) =>
    entry.name === "node_modules" ? [] : entry.isDirectory() ? files(`${dir}/${entry.name}`) : /\.tsx?$/.test(entry.name) ? [`${dir}/${entry.name}`] : []);
const productFiles = () => readdirSync(products).flatMap(product => files(`${products}/${product}/web`));
const imports = (file: string, text = readFileSync(file, "utf8")) => {
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const found: { from: string; names: string[] }[] = [];
  const visit = (node: ts.Node) => {
    if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)) {
      const named = node.importClause?.namedBindings;
      found.push({ from: node.moduleSpecifier.text, names: named && ts.isNamedImports(named) ? named.elements.map((e) => e.name.text) : [] });
    }
    if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword && ts.isStringLiteral(node.arguments[0]!))
      found.push({ from: node.arguments[0].text, names: [] });
    ts.forEachChild(node, visit);
  };
  visit(source);
  return found;
};

test("/fans and /ducts declare `picture`, and the pane each places is the kernel's", () => {
  expect(fans.spec.picture).toBeDefined();
  expect(fans.spec.panes["calc-picture"]).toMatchObject({ kernel: "picture", body: "fill" });
  expect(fans.data.picture).toEqual({ scope: "derived", marks: [] });
  expect(ducts.spec.picture).toBeDefined();
  expect(ducts.spec.panes["e-picture"]).toMatchObject({ kernel: "picture", body: "fill" });
  // One picture pane each: the kernel adds none beside the one the route placed.
  expect(Object.values(fans.spec.panes).filter((pane) => pane.kernel === "picture")).toHaveLength(1);
  expect(Object.values(ducts.spec.panes).filter((pane) => pane.kernel === "picture")).toHaveLength(1);
});

test("the borrowed body is gone: no route file mounts a Picture, and the picture's cross-imports are cut", () => {
  expect(productFiles()).toContain(`${products}/duct-systems/web/src/screen/screen.tsx`);
  const mountsPicture = (i: { from: string; names: string[] }) => /scene\/picture\/picture(?:\.tsx?)?$/.test(i.from) && i.names.includes("Picture");
  expect(imports("planted.tsx", 'import { Picture } from "@pe/web/scene/picture/picture";').some(mountsPicture)).toBe(true);
  // Only the kernel pane mounts the one `Picture`.
  const mounts = productFiles()
    .filter((file) => !/\.test\.|test-support|\.fixture\./.test(file))
    .filter((file) => imports(file).some(mountsPicture));
  expect(mounts).toEqual([]);
  // The /fans overlay reaches the duct walk through one module, where it reached 22.
  const borrowed = (from: string) => /^@pe\/(?:ducts|duct-systems)-web\//.test(from) || from.startsWith("./calc/") || /\/picture(?:\.tsx?)?$/.test(from);
  expect(["./calc/picture.tsx", "@pe/ducts-web/second-picture"].filter(borrowed)).toHaveLength(2);
  expect(imports(`${src}picture.tsx`).map((i) => i.from).filter(borrowed)).toEqual(["./calc/picture.tsx"]);
  // Nothing under ducts/ is typed by the /fans route.
  const back = productFiles().filter(file => !file.startsWith(src) || file.startsWith(`${src}calc/`)).filter((file) => imports(file).some((i) => i.names.includes("FansDrawContext")));
  expect(back).toEqual([]);
});
