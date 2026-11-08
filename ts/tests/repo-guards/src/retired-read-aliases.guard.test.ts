import { expect, test } from "vite-plus/test";
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import forbidden from "./retired-read-aliases.forbidden.json";

test("retired read aliases have no remaining consumers or advertised capabilities", () => {
  const result = spawnSync("git", ["grep", "--untracked", "-n", "-F",
    ...[...forbidden.paths, ...forbidden.capabilities].flatMap(value => ["-e", value]),
    "--", ".", ":!ts/tests/repo-guards/src/retired-read-aliases.forbidden.json"],
    { cwd: resolve(import.meta.dirname, "../../../.."), encoding: "utf8" });
  expect(result.error).toBeUndefined();
  expect(result.status, result.stdout + result.stderr).toBe(1);
});
