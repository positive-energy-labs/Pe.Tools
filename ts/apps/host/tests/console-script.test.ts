import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "vite-plus/test";
import { consoleScript } from "../src/harness/providers.ts";

/** Runs the console script in real Windows PowerShell with Enter on stdin to close failures. */
function run(command: string, env: NodeJS.ProcessEnv = process.env) {
  const path = join(mkdtempSync(join(tmpdir(), "pe-console-")), "console.ps1");
  writeFileSync(path, consoleScript(command), "utf8");
  try {
    const result = spawnSync(
      "powershell.exe",
      ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", path],
      {
        input: "\n",
        env,
        encoding: "utf8",
      },
    );
    return {
      ...result,
      tail: existsSync(`${path}.log`) ? readFileSync(`${path}.log`, "utf8") : "",
    };
  } finally {
    rmSync(join(path, ".."), { recursive: true, force: true });
  }
}

test.runIf(process.platform === "win32")(
  "a native installer failure survives the child scope",
  () => {
    const result = run("& cmd.exe /c exit 17");
    expect(result.stdout).toContain("exited 17");
    expect(result.status).toBe(17);
    expect(result.tail).toContain("exited 17");
  },
);

test.runIf(process.platform === "win32")(
  "console output never persists an inherited credential",
  () => {
    const result = run(
      "Write-Output $env:PE_TEST_API_KEY; Write-Output 'https://endpoint.invalid?private-query-value'; throw 'failed'",
      { ...process.env, PE_TEST_API_KEY: "synthetic-secret-value" },
    );
    expect(result.tail).toContain("[redacted]");
    expect(result.tail).not.toContain("synthetic-secret-value");
    expect(result.tail).not.toContain("private-query-value");
    expect(result.tail).not.toContain("PE_TEST_API_KEY");
  },
);

test.runIf(process.platform === "win32")(
  "console failures retain a bounded, sanitized output tail and a nonzero exit",
  () => {
    const result = run(
      "Write-Host ('x' * 12000); Write-Output 'stdout'; [Console]::Error.WriteLine('stderr'); throw 'failure https://example.invalid/v1?token=secret-query'",
    );
    expect(result.status).toBe(1);
    expect(result.tail.length).toBeLessThanOrEqual(8192);
    expect(result.tail).toContain("stdout");
    expect(result.tail).toContain("stderr");
    expect(result.tail).toContain("failure");
    expect(result.tail).not.toContain("secret-query");
  },
);
