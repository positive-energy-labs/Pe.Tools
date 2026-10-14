import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import { expect, test } from "vite-plus/test";
import hostConfig from "../vite.config.ts";
import peaConfig from "../../pea/vite.config.ts";
import webConfig from "../../web/vite.config.ts";
import { receiptBuildDefines, receiptBuildStamp } from "../src/build-stamp.ts";
import { admitBuild } from "../src/receipt-export.ts";

const repo = resolve(import.meta.dirname, "../../../..");
const headNow = () =>
  execFileSync("git", ["rev-parse", "HEAD"], { cwd: repo, encoding: "utf8" }).trim();
// The stamps baked into the configs are read when this file loads; HEAD may move before a test
// runs, so those are checked as a real commit in this repo, never as "HEAD right now".
const isCommit = (commit: string) => {
  execFileSync("git", ["cat-file", "-e", `${commit}^{commit}`], { cwd: repo });
  return true;
};
const version = (await import(`${repo}/product.payloads.json`, { with: { type: "json" } })).default
  .version as string;
const baked = (defines: Record<string, string>, key: string) => JSON.parse(defines[key]!);

test("release stamps carry the product version and the current commit; dev carries `dev`", () => {
  // HEAD is read on both sides of the stamp so a commit landing mid-run cannot fail the test.
  const before = headNow();
  const release = receiptBuildStamp("release");
  const dev = receiptBuildStamp("dev");
  const after = headNow();
  for (const [stamp, stampVersion] of [
    [release, version],
    [dev, "dev"],
  ] as const) {
    expect(stamp).toEqual({
      version: stampVersion,
      build: stamp.commit.slice(0, 12),
      commit: stamp.commit,
    });
    expect([before, after]).toContain(stamp.commit);
  }
});

test("the built host and web carry the same stamp and the admission accepts it", () => {
  const web = (
    webConfig as (e: { mode: string; command: string }) => { define: Record<string, string> }
  )({
    mode: "production",
    command: "build",
  }).define;
  const host = (hostConfig as { pack: { define: Record<string, string> } }).pack.define;
  const pea = (peaConfig as { pack: { define: Record<string, string> } }).pack.define;
  const id = "00000000-0000-4000-8000-000000000001";
  // One source, read once per bundle: the host bundle's two defines are the same string.
  expect(host.__PE_HOST_RECEIPT_BUILD__).toBe(host.__PE_WEB_RECEIPT_BUILD__);
  for (const [component, defines, key] of [
    ["host", host, "__PE_HOST_RECEIPT_BUILD__"],
    ["web", host, "__PE_WEB_RECEIPT_BUILD__"],
    ["web", web, "__PE_WEB_RECEIPT_BUILD__"],
  ] as const) {
    const stamp = baked(defines, key);
    expect(stamp).toMatchObject({ version, build: stamp.commit.slice(0, 12) });
    expect(isCommit(stamp.commit)).toBe(true);
    expect(admitBuild(component, stamp, id, id)).toMatchObject(stamp);
  }
  expect(Object.keys(web)).not.toContain("__PE_HOST_RECEIPT_BUILD__");
  expect(JSON.parse(host.__PE_SOURCE_COMMIT__!)).toBe(
    baked(host, "__PE_HOST_RECEIPT_BUILD__").commit,
  );
  expect(pea.__PE_SOURCE_COMMIT__).toBe(host.__PE_SOURCE_COMMIT__);
});

test("admission refuses a missing or malformed stamp", () => {
  const id = "00000000-0000-4000-8000-000000000001";
  expect(admitBuild("host", null, id, id)).toBeNull();
  expect(admitBuild("host", { version: "dev", build: "x" }, id, id)).toBeNull();
  expect(receiptBuildDefines("dev").__PE_HOST_RECEIPT_BUILD__).toContain('"version":"dev"');
});
