import { execFileSync } from "node:child_process";
import { expect, test } from "vite-plus/test";
import { webBuildStamp } from "./build-stamp.ts";

test("the web module carries the shared build stamp: version dev and the current commit", () => {
  const commit = execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();
  expect(webBuildStamp).toEqual({ version: "dev", build: commit.slice(0, 12), commit });
});
