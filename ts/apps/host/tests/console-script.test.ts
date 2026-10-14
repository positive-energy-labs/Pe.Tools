import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "vite-plus/test";
import { consoleScript } from "../src/harness/providers.ts";

/** Runs the console script in real Windows PowerShell with Enter on stdin (decline the admin run). */
function run(command: string) {
  const path = join(mkdtempSync(join(tmpdir(), "pe-console-")), "console.ps1");
  writeFileSync(path, consoleScript(command), "utf8");
  return spawnSync("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", path], {
    input: "\n",
    encoding: "utf8",
  }).stdout;
}

test.runIf(process.platform === "win32")(
  "an untrusted mount point offers the admin re-run and shows the command",
  () => {
    const out = run(
      `throw 'The path cannot be traversed because it contains an untrusted mount point'`,
    );
    expect(out).toContain("RedirectionGuard");
    expect(out).toContain("  throw 'The path cannot be traversed");
  },
);

test.runIf(process.platform === "win32")("any other failure shows its own text only", () => {
  const out = run(`throw 'other failure'`);
  expect(out).toContain("other failure");
  expect(out).not.toContain("RedirectionGuard");
});
