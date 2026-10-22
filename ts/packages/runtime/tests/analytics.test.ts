import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "vite-plus/test";
import { analyticsConfig } from "../src/analytics.ts";

test("lane selection disables dev even with an installed key; only explicit preferences opt in", () => {
  const previous = { local: process.env.LOCALAPPDATA, home: process.env.PE_TOOLS_PRODUCT_HOME };
  const dir = mkdtempSync(join(tmpdir(), "pe-key-policy-"));
  process.env.LOCALAPPDATA = dir;
  process.env.PE_TOOLS_PRODUCT_HOME = join(dir, "docs", "Pe.Tools");
  try {
    // Under the override the machine-local root, and so the installed manifest, moves with it.
    const root = join(dir, "docs", "Pe.Tools", ".local-state");
    mkdirSync(root, { recursive: true });
    writeFileSync(
      join(root, "product.payloads.json"),
      JSON.stringify({ telemetry: { posthog: { apiKey: "installed-key" } } }),
    );
    expect(analyticsConfig("dev")).toBeNull();
    expect(analyticsConfig("installed")).toEqual({
      apiKey: "installed-key",
      host: "https://us.i.posthog.com",
    });
    mkdirSync(join(dir, "docs", "Pe.Tools"), { recursive: true });
    writeFileSync(
      join(dir, "docs", "Pe.Tools", "preferences.json"),
      JSON.stringify({
        posthog: { apiKey: "explicit-dev-key", host: "https://eu.i.posthog.com/" },
      }),
    );
    expect(analyticsConfig("dev")).toEqual({
      apiKey: "explicit-dev-key",
      host: "https://eu.i.posthog.com",
    });
    expect(analyticsConfig("installed")?.apiKey).toBe("installed-key");
  } finally {
    if (previous.local === undefined) delete process.env.LOCALAPPDATA;
    else process.env.LOCALAPPDATA = previous.local;
    if (previous.home === undefined) delete process.env.PE_TOOLS_PRODUCT_HOME;
    else process.env.PE_TOOLS_PRODUCT_HOME = previous.home;
    rmSync(dir, { recursive: true, force: true });
  }
});
