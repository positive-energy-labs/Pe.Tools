import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "vite-plus/test";

const root = fileURLToPath(new URL("../../../../", import.meta.url));
// Production only. Test-home isolation is a separate guard owned by wave I.
const testScripts = new Set([
  "tools/release-sandbox/Check.ps1",
  "tools/release-sandbox/CheckAutomatic.ps1",
]);
const files = execFileSync("git", ["ls-files", "--cached", "--others", "--exclude-standard"], {
  cwd: root,
  encoding: "utf8",
})
  .trim()
  .split(/\r?\n/)
  .filter(
    (file) =>
      (/^ts\/(apps|packages)\/[^/]+\/(src|scripts)\/.*\.[cm]?[jt]sx?$/.test(file) ||
        /^dotnet\/[^/]+\/.*\.(cs|ps1)$/.test(file) ||
        /^tools\/.*\.ps1$/.test(file)) &&
      !/(?:\.Tests\/|\/tests\/|\.(?:test|spec)\.)/i.test(file) &&
      !testScripts.has(file),
  );

// Match the root read, even if a later line constructs the path. Exceptions are exact lines,
// not whole-file exemptions: a second use in an otherwise permitted consumer must be reviewed.
const rootRead =
  /\b(?:LOCALAPPDATA|APPDATA|USERPROFILE)\b|SpecialFolder(?:\.|\]::)(?:LocalApplicationData|ApplicationData|UserProfile|MyDocuments)|\b(?:homedir|tmpdir|GetTempPath|GetTempFileName)\s*\(/;
const shellRootRead =
  /(?:\benv(?:\.|\[\s*["'])|\$env:|GetEnvironmentVariable\s*\(\s*["'])(?:LOCALAPPDATA|APPDATA|USERPROFILE|TEMP|TMP)\b|GetFolderPath\s*\(\s*["'](?:LocalApplicationData|ApplicationData|UserProfile|MyDocuments)\b/i;
const resolvers = new Set([
  "ts/packages/host-contracts/src/product-paths.ts",
  "ts/packages/host-contracts/src/service-identity.ts",
  "dotnet/Pe.Shared.Product/ProductPathing.cs",
  "tools/product-paths.ps1",
]);
const allowed: Record<string, { line: string; reason: string }[]> = {
  "ts/apps/host/src/foreign-addins.ts": [
    {
      line: 'user: join(env.APPDATA ?? "", "Autodesk", "Revit", "Addins"),',
      reason: "Reads Autodesk's per-user Revit Addins folder to count stale add-in manifests.",
    },
  ],
  "ts/apps/host/src/harness/adapter.ts": [
    {
      line: "const home = env.USERPROFILE ?? homedir();",
      reason: "Locates the third-party Claude and Codex installs, which own their own folders.",
    },
    {
      line: 'const local = env.LOCALAPPDATA ?? join(home, "AppData", "Local");',
      reason:
        "Locates OpenAI's official Codex install; the Pea-owned package resolves through productRoot.",
    },
  ],
  "ts/apps/host/src/harness/install.ts": [
    {
      line: "$installer = Join-Path $env:TEMP ('pea-claude-' + [guid]::NewGuid() + '.ps1')",
      reason:
        "Downloads Anthropic's installer script to a throwaway OS temp file; not product data.",
    },
  ],
  "ts/apps/host/src/harness/user-shell.ts": [
    {
      line: 'join(process.env.CODEX_HOME?.trim() || join(homedir(), ".codex"), "config.toml");',
      reason: "Reads the harness-owned Codex configuration.",
    },
  ],
  "ts/packages/mcps/src/shared/read-image.ts": [
    {
      line: "? path.join(os.homedir(), requested.slice(2))",
      reason: "Expands a user-supplied image address, not product storage.",
    },
  ],
  "ts/packages/host-contracts/src/vendor/pe-revit-cli.ts": [
    {
      line: "localAppData: string | undefined = process.env.LOCALAPPDATA,",
      reason: "SDK-owned installed executable discovery; not a mutable product-data root.",
    },
  ],
  "dotnet/Pe.Host.Tray/PwaLauncher.cs": [
    {
      line: 'internal static string StandardProfileRoot => Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "Microsoft", "Edge", "User Data");',
      reason: "Edge owns its standard profile; Pe.Tools app profiles use ProductRuntimeLayout.",
    },
  ],
  "dotnet/Pe.Dev.Cli/Commands/OpsCatalogCommand.cs": [
    {
      line: '?? Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.UserProfile), ".nuget", "packages");',
      reason: "Reads the NuGet package cache.",
    },
  ],
  "dotnet/Pe.Revit.Scripting/References/ScriptReferenceResolver.cs": [
    {
      line: "Environment.GetFolderPath(Environment.SpecialFolder.UserProfile),",
      reason: "Reads the NuGet package cache.",
    },
  ],
  "dotnet/Pe.Revit.Global/Ui/ShortcutsService.cs": [
    {
      line: "var appData = Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData);",
      reason: "Reads Autodesk Revit KeyboardShortcuts.xml.",
    },
  ],
  "dotnet/Pe.Revit.Global/Services/Host/RevitJournalOps.cs": [
    {
      line: '"Revit normally records a journal under %LOCALAPPDATA%\\\\Autodesk\\\\Revit\\\\<version>\\\\Journals; check the session.")]);',
      reason: "Diagnostic describing Autodesk-owned journals, no path construction.",
    },
  ],
  "tools/dotnet-sandbox-safe.ps1": [
    {
      line: "$userProfile = [Environment]::GetEnvironmentVariable('USERPROFILE', 'Process')",
      reason: "Repairs missing OS environment for MSBuild/NuGet; no product data.",
    },
    {
      line: "$userProfile = [Environment]::GetFolderPath([Environment+SpecialFolder]::UserProfile)",
      reason: "Repairs missing OS environment for MSBuild/NuGet; no product data.",
    },
    { line: "Set-EnvIfMissing 'USERPROFILE' $userProfile", reason: "Repairs the OS environment." },
    {
      line: "Set-EnvIfMissing 'APPDATA' (Join-Path $userProfile 'AppData\\Roaming')",
      reason: "Repairs the OS environment.",
    },
    {
      line: "Set-EnvIfMissing 'LOCALAPPDATA' (Join-Path $userProfile 'AppData\\Local')",
      reason: "Repairs the OS environment.",
    },
  ],
  "tools/release-sandbox/Collect.ps1": [
    {
      line: "[string]$LocalAppDataRoot = $env:LOCALAPPDATA,",
      reason:
        "Sandbox guest evidence collector; copies the installed product's files out, writes none.",
    },
  ],
  "tools/release-sandbox/Automatic.ps1": [
    {
      line: "$planDirectory=Join-Path $env:LOCALAPPDATA 'Pe.Revit.Sdk\\sessions\\updates'",
      reason: "SDK-owned update registry.",
    },
    {
      line: "$directory=Join-Path $env:LOCALAPPDATA 'Pe.Revit.Sdk\\sessions\\receipts\\_update'",
      reason: "SDK-owned update receipts.",
    },
  ],
  "tools/release-sandbox/Guest.ps1": [
    {
      line: "$work=Join-Path $env:TEMP ('Pe.Revit.Sdk\\update\\'+$requestId);Copy-Item $work \"$run\\sdk-work\" -Recurse",
      reason: "Collects SDK-owned update work as release evidence.",
    },
    {
      line: "$root=Join-Path $env:LOCALAPPDATA 'Positive Energy\\Pe.Tools';$manifest=Join-Path $root 'product.payloads.json';$cli=Join-Path $root 'shims\\pe-revit.exe'",
      reason:
        "Windows Sandbox MSI acceptance locates the real installed binary, not an override home.",
    },
  ],
  "tools/release-sandbox/ReadInstalledMcp.ps1": [
    {
      line: "if ($env:USERNAME -ne 'WDAGUtilityAccount' -or $Output -notlike 'C:\\GateEvidence\\*' -or $InstallRoot -ne (Join-Path $env:LOCALAPPDATA 'Positive Energy\\Pe.Tools')) { throw 'Canonical owned Sandbox install and evidence only.' }",
      reason: "Refuses anything except the actual MSI root in an owned Windows Sandbox guest.",
    },
  ],
};

test("production product data uses the one environment resolver, including scratch", () => {
  const violations: string[] = [];
  for (const file of files) {
    if (resolvers.has(file)) continue;
    const source = readFileSync(resolve(root, file), "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, (comment) => comment.replace(/[^\n]/g, " "))
      .replace(/<#[\s\S]*?#>/g, (comment) => comment.replace(/[^\n]/g, " "));
    source.split(/\r?\n/).forEach((line, index) => {
      const code = line.trim();
      if (/^(?:\/\/|#)/.test(code) || !(rootRead.test(code) || shellRootRead.test(code))) return;
      if (allowed[file]?.some((entry) => entry.line === code && entry.reason.length > 0)) return;
      violations.push(`${file}:${index + 1}: ${code}`);
    });
  }
  expect(
    violations,
    "Route Pe.Tools-owned data through productRoot/product-paths or ProductRuntimeLayout. Add only a reasoned non-product exception.",
  ).toEqual([]);
});
