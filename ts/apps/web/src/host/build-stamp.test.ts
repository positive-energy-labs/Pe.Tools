import { execFileSync } from "node:child_process";
import { expect, test } from "vite-plus/test";
import { webBuildStamp } from "./build-stamp.ts";

test("the web module carries the shared build stamp: version dev and a real commit", () => {
  // The stamp is baked when vitest loads the config; HEAD may move before this runs, so check the
  // baked commit is a commit in this repo and that `build` is its prefix, not that it is HEAD now.
  const { version, build, commit } = webBuildStamp;
  expect(version).toBe("dev");
  expect(commit).toMatch(/^[0-9a-f]{40}$/);
  expect(build).toBe(commit.slice(0, 12));
  execFileSync("git", ["cat-file", "-e", `${commit}^{commit}`]);
});
