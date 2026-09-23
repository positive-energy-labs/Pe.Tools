/**
 * A label that promises a chord (`read again (r)`) binds it. Plain fs walk, plain regex: every
 * `label="…(x)…"` or `label: "…(x)…"` under apps/web/src sits in a file that calls `useScopeKeys(`
 * with `hotkey: "X"`. Prose that is not a label is out of scope.
 */
import { execFileSync } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, it } from "vite-plus/test";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = execFileSync("git", ["rev-parse", "--show-toplevel"], {
  cwd: HERE,
  encoding: "utf8",
}).trim();
const WEB_SRC = resolve(REPO, "ts/apps/web/src");

const files = (dir: string): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory()
      ? files(join(dir, entry.name))
      : /\.tsx?$/.test(entry.name) && !/\.test\./.test(entry.name)
        ? [join(dir, entry.name)]
        : [],
  );

it("every chord a label promises is bound in its file by useScopeKeys", () => {
  const unbound = files(WEB_SRC).flatMap((file) => {
    const text = readFileSync(file, "utf8");
    const labels = text.matchAll(/label(?:=|:\s*)["'`]([^"'`]*)["'`]/g);
    return [...labels].flatMap(([, label]) =>
      [...label!.matchAll(/\(([a-z])\)/g)].flatMap(([, letter]) =>
        text.includes("useScopeKeys(") &&
        new RegExp(String.raw`hotkey:\s*"${letter}"`, "i").test(text)
          ? []
          : [`${file.slice(WEB_SRC.length + 1)}: "${label}" promises (${letter})`],
      ),
    );
  });
  expect(unbound).toEqual([]);
});
