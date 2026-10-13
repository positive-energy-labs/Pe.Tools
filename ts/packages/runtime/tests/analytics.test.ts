import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "vite-plus/test";
import { readOrCreateInstallId } from "../src/analytics.ts";

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

    writeFileSync(path, JSON.stringify({ installId: "preexisting-id" }));
    expect(readOrCreateInstallId()).toBe("preexisting-id");

    const other = mkdtempSync(join(tmpdir(), "pe-install-id-"));
    mkdirSync(join(other, "Positive Energy", "Pe.Tools", "state"), { recursive: true });
    writeFileSync(join(other, "Positive Energy", "Pe.Tools", "state", "install.json"), "{}");
    process.env.LOCALAPPDATA = other;
    expect(readOrCreateInstallId()).toBe("unknown");
    rmSync(other, { recursive: true, force: true });
  } finally {
    if (previous === undefined) delete process.env.LOCALAPPDATA;
    else process.env.LOCALAPPDATA = previous;
    rmSync(dir, { recursive: true, force: true });
  }
});
