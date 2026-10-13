import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "vite-plus/test";
import { readOrCreateInstallId, analyticsConfig } from "../src/analytics.ts";

/** install_id is one file per machine install, created once and honoured thereafter. */
test("install id is created once, stable on re-read, and a pre-existing file wins", () => {
  const previous = process.env.LOCALAPPDATA;
  const dir = mkdtempSync(join(tmpdir(), "pe-install-id-"));
  try {
    process.env.LOCALAPPDATA = dir;
    const path = join(dir, "Positive Energy", "Pe.Tools", "state", "install.json");

    const first = readOrCreateInstallId();
    expect(first).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(JSON.parse(readFileSync(path, "utf8"))).toEqual({ installId: first });
    expect(readOrCreateInstallId()).toBe(first);

    writeFileSync(path, JSON.stringify({ installId: "20000000-0000-4000-8000-000000000001" }));
    expect(readOrCreateInstallId()).toBe("20000000-0000-4000-8000-000000000001");

    const other = mkdtempSync(join(tmpdir(), "pe-install-id-"));
    mkdirSync(join(other, "Positive Energy", "Pe.Tools", "state"), { recursive: true });
    writeFileSync(join(other, "Positive Energy", "Pe.Tools", "state", "install.json"), "{}");
    process.env.LOCALAPPDATA = other;
    expect(readOrCreateInstallId()).toBeNull();
    rmSync(other, { recursive: true, force: true });
  } finally {
    if (previous === undefined) delete process.env.LOCALAPPDATA;
    else process.env.LOCALAPPDATA = previous;
    rmSync(dir, { recursive: true, force: true });
  }
});

test("lane selection disables dev even with an installed key; only explicit preferences opt in", () => {
  const previous = { local: process.env.LOCALAPPDATA, docs: process.env.PE_TOOLS_DOCUMENTS_ROOT };
  const dir = mkdtempSync(join(tmpdir(), "pe-key-policy-"));
  process.env.LOCALAPPDATA = dir;
  process.env.PE_TOOLS_DOCUMENTS_ROOT = join(dir, "docs");
  try {
    const root = join(dir, "Positive Energy", "Pe.Tools");
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
    if (previous.docs === undefined) delete process.env.PE_TOOLS_DOCUMENTS_ROOT;
    else process.env.PE_TOOLS_DOCUMENTS_ROOT = previous.docs;
    rmSync(dir, { recursive: true, force: true });
  }
});
