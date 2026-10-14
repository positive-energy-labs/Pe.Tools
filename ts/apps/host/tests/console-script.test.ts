import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "vite-plus/test";
import { consoleScript } from "../src/harness/providers.ts";

/** Runs the console script in real Windows PowerShell with Enter on stdin to close failures. */
function run(command: string) {
  const path = join(mkdtempSync(join(tmpdir(), "pe-console-")), "console.ps1");
  writeFileSync(path, consoleScript(command), "utf8");
  try {
    return spawnSync(
      "powershell.exe",
      ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", path],
      {
        input: "\n",
        encoding: "utf8",
      },
    ).stdout;
  } finally {
    rmSync(join(path, ".."), { recursive: true, force: true });
  }
}

test.runIf(process.platform === "win32")(
  "a failed install stays visible without offering an unproved elevated retry",
  () => {
    const out = run(
      `throw 'The path cannot be traversed because it contains an untrusted mount point'`,
    );
    expect(out).toContain("untrusted mount point");
    expect(out).not.toContain("[A]");
    expect(consoleScript("throw 'failure'")).not.toContain("RunAs");
  },
);

test.runIf(process.platform === "win32")("any other failure shows its own text only", () => {
  const out = run(`throw 'other failure'`);
  expect(out).toContain("other failure");
  expect(out).not.toContain("RedirectionGuard");
});

test.runIf(process.platform === "win32")(
  "a native installer failure survives the child scope",
  () => {
    expect(run("& cmd.exe /c exit 17")).toContain("exited 17");
  },
);

test.runIf(process.platform === "win32")(
  "installer StrictMode cannot break the console's success path",
  () => {
    const out = run("Set-StrictMode -Version Latest; Write-Host 'installed'");
    expect(out).toContain("installed");
    expect(out).not.toContain("cannot be retrieved");
    expect(out).not.toContain("Press Enter");
  },
);
