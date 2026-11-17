import { readFileSync } from "node:fs";
import ts from "typescript";
import { expect, test } from "vite-plus/test";

test("Ducts content cannot silently introduce structural panes or replace a layout branch", () => {
  // The fan sheet's bodies are /fans' own (`fans/mount`); its walk is ducts content the /fans overlay hands the kernel's picture pane.
  for (const name of ["duct-systems/web/src/screen/screen", "duct-systems/web/src/screen/picture", "fans/web/src/calc/picture", "fans/web/src/mount", "fans/web/src/picture"]) {
    const text = readFileSync(
      new URL(`../../../products/${name}.tsx`, import.meta.url),
      "utf8",
    );
    const source = ts.createSourceFile(
      `${name}.tsx`,
      text,
      ts.ScriptTarget.Latest,
      true,
      ts.ScriptKind.TSX,
    );
    const structures: string[] = [];
    let layouts = 0;
    const visit = (node: ts.Node) => {
      if (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) {
        const tag = node.tagName.getText(source);
        if (["Pane", "PaneSplit", "Halves"].includes(tag)) structures.push(tag);
        if (tag === "TeachingLayoutView") layouts++;
      }
      ts.forEachChild(node, visit);
    };
    visit(source);
    expect(structures, name).toEqual([]);
    expect(layouts, name).toBe(0);
  }
});
