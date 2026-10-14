import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "vite-plus/test";
import { codexPackagePath, installCommand } from "../src/harness/install.ts";

test.runIf(process.platform === "win32")(
  "Codex package installs with RedirectionGuard; a bad digest preserves the previous install",
  () => {
    const root = mkdtempSync(join(tmpdir(), "pe-install-"));
    const env = {
      ...process.env,
      USERPROFILE: join(root, "home"),
      LOCALAPPDATA: join(root, "local"),
      PSModuleAnalysisCachePath: join(root, "module-cache"),
    };
    const script = join(root, "test.ps1");
    mkdirSync(env.USERPROFILE);
    mkdirSync(env.LOCALAPPDATA);
    const quote = (text: string) => `'${text.replaceAll("'", "''")}'`;
    writeFileSync(
      script,
      String.raw`
$ErrorActionPreference = 'Stop'
$root = ${quote(root)}
New-Item -ItemType Directory -Force "$root\fixture\bin" | Out-Null
Add-Type -TypeDefinition 'public class Cli { public static void Main() { System.Console.WriteLine("codex-cli fixture"); } }' -OutputType ConsoleApplication -OutputAssembly "$root\fixture\bin\codex.exe"
& "$env:SystemRoot\System32\tar.exe" -czf "$root\fixture.tar.gz" -C "$root\fixture" .
$fixtureDigest = 'sha256:' + (Get-FileHash "$root\fixture.tar.gz").Hash.ToLowerInvariant()
function Invoke-RestMethod { @{ assets = @('x86_64', 'aarch64' | ForEach-Object { @{ name = "codex-package-$_-pc-windows-msvc.tar.gz"; digest = $fixtureDigest; browser_download_url = 'https://github.com/openai/codex/releases/download/test/package.tar.gz' } }) } }
function Invoke-WebRequest { param($Uri, $OutFile, [switch]$UseBasicParsing, $TimeoutSec); Copy-Item "$root\fixture.tar.gz" $OutFile }
Add-Type 'using System; using System.Runtime.InteropServices; public class Guard { [DllImport("kernel32.dll",SetLastError=true)] public static extern bool SetProcessMitigationPolicy(int p, ref uint f, UIntPtr s); }'
[uint32]$flags=1
if (-not [Guard]::SetProcessMitigationPolicy(16,[ref]$flags,[UIntPtr]::new(4))) { throw 'Guard setup failed' }
& { ${installCommand("codex")} }
$fixtureDigest = 'sha256:' + ('0' * 64)
try { & { ${installCommand("codex")} }; throw 'bad digest accepted' }
catch { if ("$_" -notmatch 'checksum mismatch') { throw }; Write-Output 'BAD_DIGEST_REFUSED' }
& ${quote(join(codexPackagePath(env), "bin", "codex.exe"))} --version
`,
      "utf8",
    );
    try {
      const result = spawnSync(
        "powershell.exe",
        ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", script],
        { env, encoding: "utf8", timeout: 20_000, windowsHide: true },
      );
      expect(result.status, result.stdout + result.stderr).toBe(0);
      expect(result.stdout).toContain("BAD_DIGEST_REFUSED");
      expect(result.stdout.trim().endsWith("codex-cli fixture")).toBe(true);
      expect(readFileSync(join(codexPackagePath(env), "bin", "codex.exe")).length).toBeGreaterThan(
        0,
      );
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  },
  30_000,
);
