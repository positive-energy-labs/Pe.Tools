import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "vite-plus/test";
import { checkoutRootFrom, discoverHostBaseUrl } from "../src/shared/host-config.ts";

function fakeCheckout(): string {
  const root = mkdtempSync(join(tmpdir(), "pe-host-config-"));
  mkdirSync(join(root, ".git"));
  writeFileSync(join(root, "Pe.Tools.slnx"), "");
  mkdirSync(join(root, "source", "deep"), { recursive: true });
  return root;
}

test("checkoutRootFrom walks up to the .git + Pe.Tools.slnx root", () => {
  const root = fakeCheckout();
  expect(checkoutRootFrom(join(root, "source", "deep"))).toBe(root);
  expect(checkoutRootFrom(root)).toBe(root);
});

test("checkoutRootFrom returns null outside any checkout", () => {
  expect(checkoutRootFrom(mkdtempSync(join(tmpdir(), "pe-not-a-checkout-")))).toBeNull();
});

test("a URL --host value passes through untouched", () => {
  expect(discoverHostBaseUrl("http://127.0.0.1:9999")).toBe("http://127.0.0.1:9999");
  expect(discoverHostBaseUrl("https://example.test")).toBe("https://example.test");
});

test("an unrecognized lane token is a hard error, never a guess", () => {
  expect(() => discoverHostBaseUrl("not-a-url-or-lane")).toThrowError(/neither a URL/);
});

test("a worktree-path token outside a checkout is a hard error", () => {
  const stray = mkdtempSync(join(tmpdir(), "pe-stray-"));
  expect(() => discoverHostBaseUrl(stray)).toThrowError(/neither a URL/);
});

test("the installed token resolves without a running dev host", () => {
  // No service file in the redirected product root: falls back to the installed default URL.
  const previous = process.env.LOCALAPPDATA;
  process.env.LOCALAPPDATA = mkdtempSync(join(tmpdir(), "pe-appbase-"));
  try {
    expect(discoverHostBaseUrl("installed")).toMatch(/^http:\/\/127\.0\.0\.1:\d+/);
  } finally {
    process.env.LOCALAPPDATA = previous;
  }
});
