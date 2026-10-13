import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import { expect, test } from "vite-plus/test";
import hostConfig from "../vite.config.ts";
import webConfig from "../../web/vite.config.ts";
import { receiptBuildDefines, receiptBuildStamp } from "../src/build-stamp.ts";
import { admitBuild } from "../src/receipt-export.ts";

const repo = resolve(import.meta.dirname, "../../../..");
const head = execFileSync("git", ["rev-parse", "HEAD"], { cwd: repo, encoding: "utf8" }).trim();
const version = (await import(`${repo}/product.payloads.json`, { with: { type: "json" } })).default
  .version as string;
const baked = (defines: Record<string, string>, key: string) => JSON.parse(defines[key]!);

test("release stamps carry the product version and the current commit; dev carries `dev`", () => {
  expect(receiptBuildStamp("release")).toEqual({ version, build: head.slice(0, 12), commit: head });
  expect(receiptBuildStamp("dev")).toEqual({ version: "dev", build: head.slice(0, 12), commit: head });
});

test("the built host and web carry the same stamp and the admission accepts it", () => {
  const web = (webConfig as (e: { mode: string; command: string }) => { define: Record<string, string> })({
    mode: "production",
    command: "build",
  }).define;
  const host = (hostConfig as { pack: { define: Record<string, string> } }).pack.define;
  const id = "00000000-0000-4000-8000-000000000001";
  for (const [component, defines, key] of [
    ["host", host, "__PE_HOST_RECEIPT_BUILD__"],
    ["web", host, "__PE_WEB_RECEIPT_BUILD__"],
    ["web", web, "__PE_WEB_RECEIPT_BUILD__"],
  ] as const) {
    const stamp = baked(defines, key);
    expect(stamp).toEqual(receiptBuildStamp("release"));
    expect(admitBuild(component, stamp, id, id)).toMatchObject(stamp);
  }
  expect(Object.keys(web)).not.toContain("__PE_HOST_RECEIPT_BUILD__");
});

test("admission refuses a missing or malformed stamp", () => {
  const id = "00000000-0000-4000-8000-000000000001";
  expect(admitBuild("host", null, id, id)).toBeNull();
  expect(admitBuild("host", { version: "dev", build: "x" }, id, id)).toBeNull();
  expect(receiptBuildDefines("dev").__PE_HOST_RECEIPT_BUILD__).toContain('"version":"dev"');
});
