/**
 * THE WORKSTATION PATH GUARD. Seeds and specimens ship in the served web bundle, so a real
 * profile path (`C:\Users\<maker>\...`) in them leaks the workstation. Use `C:\Users\you\...`.
 * Scans web source always, and the built client bundle when one exists.
 */
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, it } from "vite-plus/test";

const WEB = resolve(dirname(fileURLToPath(import.meta.url)), "../../../apps/web");
// Spelled with a class so this file never matches itself; covers `\`, `\`, `/` and JSON-escaped forms.
const LEAK = /C:[/]+Users[/]+kait[p]\b/i;
const TEXT = /\.(?:[cm]?[jt]sx?|json|css|html|md|svg)$/;

function* walk(dir: string): Generator<string> {
  if (!existsSync(dir)) return;
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) yield* walk(path);
    else if (TEXT.test(name)) yield path;
  }
}

const leaks = (root: string) =>
  [...walk(root)].filter((file) => LEAK.test(readFileSync(file, "utf8")));

it("web source carries no workstation profile path", () => {
  expect(leaks(join(WEB, "src"))).toEqual([]);
});

it("the built web client bundle carries no workstation profile path", () => {
  expect(leaks(join(WEB, "dist", "client"))).toEqual([]);
});
