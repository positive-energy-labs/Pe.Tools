import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import ts from "typescript";
import { expect, test } from "vite-plus/test";
import { files, root, syntax, walk } from "./unification-2-census.ts";

test("defaulted graph declarations do not copy kernel reading and placement defaults", () => {
  const copies: string[] = [];
  for (const file of files("ts/apps/web/src").filter((p) => p.endsWith("/graph.ts"))) {
    const source = syntax(readFileSync(resolve(root, file), "utf8"), file);
    walk(source, (node) => {
      if (!ts.isCallExpression(node) || node.expression.getText(source) !== "defineRouteGraph") return;
      const graph = node.arguments[0];
      if (!graph || !ts.isObjectLiteralExpression(graph)) throw Error(`${file}: declare the graph inline`);
      const properties = (n: ts.Node) => ts.isObjectLiteralExpression(n) ? n.properties.filter(ts.isPropertyAssignment) : [];
      for (const section of properties(graph)) {
        const noun = section.name.getText(source);
        for (const entry of properties(section.initializer))
          for (const property of properties(entry.initializer)) {
            const key = property.name.getText(source), value = property.initializer.getText(source);
            if (noun === "readings" && key === "kind" && value === '"use"' ||
                ["panes", "stages"].includes(noun) && key === "verbs" && value === "[]")
              copies.push(`${file}:${source.getLineAndCharacterOfPosition(property.getStart(source)).line + 1}: ${noun}.${entry.name.getText(source)}.${key}`);
          }
      }
    });
  }
  expect(copies).toEqual([]);
});
