import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import ts from "typescript";
import { expect, test } from "vite-plus/test";
import { files, root, syntax, walk } from "./unification-2-census.ts";

/** Each `route({...})` declaration in a route module, with its `core` and each pane's `read`. */
export function paneReadCopies(
  file: string,
  text: string,
): { declarations: number; copies: string[] } {
  const source = syntax(text, file);
  const copies: string[] = [];
  let declarations = 0;
  const property = (object: ts.ObjectLiteralExpression, name: string) =>
    object.properties.find(
      (p): p is ts.PropertyAssignment =>
        ts.isPropertyAssignment(p) && p.name.getText(source) === name,
    );
  walk(source, (node) => {
    if (!ts.isCallExpression(node) || node.expression.getText(source) !== "route") return;
    const spec = node.arguments[0];
    if (!spec || !ts.isObjectLiteralExpression(spec))
      throw Error(`${file}: declare the route inline`);
    declarations++;
    const core = property(spec, "core")?.initializer.getText(source);
    const panes = property(spec, "panes")?.initializer;
    if (!core || !panes || !ts.isObjectLiteralExpression(panes)) return;
    for (const pane of panes.properties)
      if (ts.isPropertyAssignment(pane) && ts.isObjectLiteralExpression(pane.initializer)) {
        const read = property(pane.initializer, "read");
        if (read?.initializer.getText(source) === core)
          copies.push(
            `${file}:${source.getLineAndCharacterOfPosition(read.getStart(source)).line + 1}: panes.${pane.name.getText(source)}.read`,
          );
      }
  });
  return { declarations, copies };
}

// route/defaults.ts `route()` gives every pane `read: spec.core`; a pane that writes it again is a
// copied default. Retargeted from the deleted `*/graph.ts` declarations (none since 6ecbc716).
test("route modules do not copy the kernel's pane read default", () => {
  const modules = [...files("ts/apps/web/src"), ...files("ts/products")].filter((p) =>
    /^ts\/(?:apps\/web\/src\/[^/]+|products\/[^/]+\/web(?:\/routes\/[^/]+)?)\/route\.ts$/.test(p),
  );
  const results = modules.map((file) =>
    paneReadCopies(file, readFileSync(resolve(root, file), "utf8")),
  );
  // Never vacuous: the old guard read a file shape that stopped existing and stayed green.
  // 13 since Rooms and Takeoffs declare through `screen()`, which has no pane read to copy.
  expect(results.filter((r) => r.declarations).length).toBeGreaterThanOrEqual(13);
  expect(results.flatMap((r) => r.copies)).toEqual([]);
});

test("a pane that restates core is red; one that names another read is not", () => {
  const text = `export const module = route({ core: reads.sheet, panes: {
    a: { draw: A, read: reads.sheet }, b: { draw: B, read: reads.other }, c: { draw: C } } });`;
  expect(paneReadCopies("x/route.ts", text)).toEqual({
    declarations: 1,
    copies: ["x/route.ts:2: panes.a.read"],
  });
});
