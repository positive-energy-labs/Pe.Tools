/**
 * D1, kernel crusade 2 (docs/features/routes/CONTRACTS.md): a route folder is closed. Rules and
 * scope are in `route-closure-census.ts`. The edges standing at f38543da are frozen in
 * `route-closure.baseline.json`; a new edge is red, and an edge that is gone must leave the list,
 * so it only shrinks. Slice 13 lands when the list is empty. C7's falsifier is this census with
 * the route set narrowed to `chat`.
 */
import { readFileSync } from "node:fs";
import { expect, test } from "vite-plus/test";
import { BASELINE, census, closureCensus, routeFolders } from "./route-closure-census.ts";

const frozen: string[] = JSON.parse(readFileSync(BASELINE, "utf8"));

test("no route folder gains an import of another route, a shared folder, or the host", () => {
  const actual = census();
  const added = actual.filter((edge) => !frozen.includes(edge));
  const gone = frozen.filter((edge) => !actual.includes(edge));
  expect(added, `route closure: new offenders (a route folder imports only itself, the kernel and packages):\n${added.join("\n")}`).toEqual([]);
  expect(gone, `route closure: these edges are gone; delete them from route-closure.baseline.json (\`node src/route-closure-census.ts --tighten\`):\n${gone.join("\n")}`).toEqual([]);
});

test("the census goes red on each planted offender and passes the clean shapes", () => {
  const routes = new Set(["fans", "ducts", "chat"]);
  expect(closureCensus({
    "fans/planted.ts": `import { systemCode } from "../ducts/identity";`,
    "navigation/planted.tsx": `import { ChatShell } from "#/chat/chat-shell";`,
    "fans/body.tsx": `import { callOp } from "#/host/client"; export const b = () => callOp("x");`,
    "ducts/load.ts": `export const l = () => fetch("/api");`,
    "chat/lazy.ts": `export const l = () => import("../fans/route");`,
    "fans/types.ts": `export type T = import("@/ducts/route").X;`,
  }, routes)).toEqual([
    "chat/lazy.ts -> fans/route",
    "ducts/load.ts uses fetch",
    "fans/body.tsx uses callOp",
    "fans/planted.ts -> ducts/identity",
    "fans/types.ts -> ducts/route",
    "navigation/planted.tsx -> chat/chat-shell",
  ]);
  expect(closureCensus({
    "fans/a.ts": `import { x } from "./b"; import { y } from "#/shell/owner"; import { z } from "@pe/kit";`,
    "fans/a.test.ts": `import { d } from "../ducts/identity";`,
    "fans/b.test-support.ts": `import { d } from "../ducts/identity";`,
    "design-system/s.tsx": `import { d } from "../ducts/identity";`,
    "fans/d.ts": `import { s } from "../design-system/open-examples";`,
    "shell/owner.ts": `export const call = () => fetch("/api");`,
  }, routes)).toEqual([]);
});

test("a product's web folder is a route folder, closed against web routes and other products", () => {
  const routes = new Set(["chat", "products/fans/web", "products/duct-systems/web"]);
  expect(closureCensus({
    "products/fans/web/a.ts": `import { x } from "../../duct-systems/web/x"; import { c } from "../../../apps/web/src/chat/c";`,
    "products/fans/web/b.ts": `import { a } from "./a"; import { d } from "../domain/d"; import { s } from "#/shell/owner";`,
    "navigation/planted.tsx": `import { r } from "../../../../products/fans/web/route";`,
    "chat/planted.ts": `export const l = () => callOp("x");`,
    "products/fans/web/load.ts": `export const l = () => fetch("/api");`,
  }, routes)).toEqual([
    "chat/planted.ts uses callOp",
    "navigation/planted.tsx -> products/fans/web/route",
    "products/fans/web/a.ts -> chat/c",
    "products/fans/web/a.ts -> products/duct-systems/web/x",
    "products/fans/web/load.ts uses fetch",
  ]);
});

test("the census sees every route folder and exempts only the design-system window", () => {
  const routes = routeFolders();
  for (const name of ["chat", "fans", "ducts", "open", "sessions", "settings"]) expect(routes).toContain(name);
  for (const name of ["design-system", "shell", "route", "navigation", "workbench", "routes"]) expect(routes).not.toContain(name);
});
