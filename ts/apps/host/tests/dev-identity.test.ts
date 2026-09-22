import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { expect, test } from "vite-plus/test";

test("foreign checkout spawn plumbing fails before claiming a host or starting Vite", () => {
  const state = mkdtempSync(join(tmpdir(), "pe-dev-identity-"));
  try {
    const result = spawnSync(
      process.execPath,
      ["--import", "jiti/register", "src/dev.ts", "--take-over-host"],
      {
        cwd: resolve(import.meta.dirname, ".."),
        env: {
          ...process.env,
          LOCALAPPDATA: state,
          PE_LANE: "dev",
          PE_TOOLS_SOURCE_ROOT: join(state, "foreign-checkout"),
          PE_TOOLS_HOST_SERVICE_NAME: undefined,
          WATCH_REPORT_DEPENDENCIES: undefined,
        },
        encoding: "utf8",
        windowsHide: true,
        timeout: 60_000,
      },
    );
    expect(result.error).toBeUndefined();
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("Dev host source identity does not match this checkout");
    expect(result.stdout).not.toContain("service claim");
    expect(result.stdout).not.toContain("Browser:");
  } finally {
    rmSync(state, { recursive: true, force: true });
  }
}, 65_000);
