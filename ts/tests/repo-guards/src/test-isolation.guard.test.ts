/**
 * THE TEST ISOLATION GUARD (test time only; path construction has its own guard). A test run must never resolve the owner's real product home
 * (Documents\Pe.Tools, %LOCALAPPDATA%\Positive Energy): waves D and K each had host fixtures
 * rewrite the owner's `.codex/config.toml` there. Every package that can reach the resolver (it
 * depends on `@pe/host-contracts`) registers the `ts/tests/isolated-home` global setup, which
 * gives the run a temp home and arms the tripwire in host-contracts `insideTestRoot`.
 */
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { expect, it } from "vite-plus/test";

const TS = resolve(import.meta.dirname, "../../..");
const SETUPS = ["tests/isolated-home/global-setup.ts", "tests/isolated-home/setup.ts"];

const packages = ["apps", "packages"].flatMap((group) =>
  readdirSync(join(TS, group)).map((name) => join(TS, group, name)),
);

it("every package that depends on host-contracts runs its tests in an isolated home", () => {
  const unguarded = packages.filter((dir) => {
    const manifest = join(dir, "package.json");
    if (!existsSync(manifest)) return false;
    const {
      dependencies = {},
      devDependencies = {},
      name,
    } = JSON.parse(readFileSync(manifest, "utf8")) as Record<
      string,
      Record<string, string> | string
    >;
    const reaches =
      name === "@pe/host-contracts" ||
      "@pe/host-contracts" in (dependencies as object) ||
      "@pe/host-contracts" in (devDependencies as object);
    const config = readFileSync(join(dir, "vite.config.ts"), "utf8");
    return reaches && !SETUPS.every((setup) => config.includes(setup));
  });
  expect(unguarded.map((dir) => dir.slice(TS.length + 1))).toEqual([]);
});

it("the setup files exist", () => {
  for (const setup of SETUPS) expect(existsSync(join(TS, setup))).toBe(true);
});
