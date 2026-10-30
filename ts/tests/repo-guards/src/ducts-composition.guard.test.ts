import { readFileSync } from "node:fs";
import ts from "typescript";
import { expect, test } from "vite-plus/test";

test("Ducts content cannot silently introduce structural panes or replace a layout branch", () => {
  for (const name of ["proto/e/screen", "proto/e/picture", "sheet/mount", "sheet/picture"]) {
    const text = readFileSync(
      new URL(`../../../apps/web/src/ducts/${name}.tsx`, import.meta.url),
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
