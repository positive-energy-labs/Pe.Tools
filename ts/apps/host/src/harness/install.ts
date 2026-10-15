import type { HarnessId } from "@pe/agent-contracts";
import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";

/**
 * Full official package, including sandbox/code-mode helpers. No npm, admin, or junctions.
 * `codexPackage` is a physical directory, never an installer junction.
 */
export function installCommand(harness: HarnessId, codexPackage: string): string {
  if (harness === "claude")
    return String.raw`
$installer = Join-Path $env:TEMP ('pea-claude-' + [guid]::NewGuid() + '.ps1')
try {
  Invoke-WebRequest -UseBasicParsing -Uri 'https://claude.ai/install.ps1' -OutFile $installer -TimeoutSec 60
  & "$PSHOME\powershell.exe" -NoLogo -NoProfile -ExecutionPolicy Bypass -File $installer
  if ($LASTEXITCODE -ne 0) { throw "Claude Code installer exited $LASTEXITCODE" }
  Write-Host 'Pea finds Claude Code automatically. Return to Pea to sign in; no PATH edit is needed.'
} finally { Remove-Item -LiteralPath $installer -Force -ErrorAction SilentlyContinue }
`;
  // FOOTGUN: RedirectionGuard makes current\bin look absent on first install, then rejects
  // ResolveDirectory(current) on retry. Use the published package without the installer's links.
  return String.raw`
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
if (-not [Environment]::Is64BitOperatingSystem) { throw 'Codex requires 64-bit Windows.' }
$arch = if ($env:PROCESSOR_ARCHITEW6432) { $env:PROCESSOR_ARCHITEW6432 } else { $env:PROCESSOR_ARCHITECTURE }
$target = switch ($arch) { 'ARM64' { 'aarch64' } 'AMD64' { 'x86_64' } default { throw "Unsupported Windows architecture: $arch" } }
$destination = '${codexPackage.replaceAll("'", "''")}'
$parent = Split-Path -Parent $destination
New-Item -ItemType Directory -Force -Path $parent | Out-Null
$work = Join-Path $parent ('.install-' + [guid]::NewGuid())
$package = Join-Path $work 'package'
$backup = $destination + '.previous-' + [guid]::NewGuid()
New-Item -ItemType Directory -Path $package -Force | Out-Null
try {
  Write-Host 'Downloading Codex from OpenAI...'
  $release = Invoke-RestMethod -Uri 'https://api.github.com/repos/openai/codex/releases/latest' -TimeoutSec 60
  $name = "codex-package-$target-pc-windows-msvc.tar.gz"
  $asset = $release.assets | Where-Object { $_.name -eq $name } | Select-Object -First 1
  if (-not $asset -or $asset.digest -notmatch '^sha256:[0-9a-fA-F]{64}$') { throw 'OpenAI release has no verified Windows package.' }
  $url = [uri]$asset.browser_download_url
  if ($url.Scheme -ne 'https' -or $url.Host -ne 'github.com' -or -not $url.AbsolutePath.StartsWith('/openai/codex/releases/download/')) { throw 'Unexpected Codex release source.' }
  $archive = Join-Path $work 'codex.tar.gz'
  Invoke-WebRequest -UseBasicParsing -Uri $url.AbsoluteUri -OutFile $archive -TimeoutSec 300
  $sha = [Security.Cryptography.SHA256]::Create()
  $stream = [IO.File]::OpenRead($archive)
  try { $digest = [BitConverter]::ToString($sha.ComputeHash($stream)).Replace('-', '').ToLowerInvariant() }
  finally { $stream.Dispose(); $sha.Dispose() }
  if ('sha256:' + $digest -ne $asset.digest) { throw 'Codex download checksum mismatch. Nothing was installed.' }
  & "$env:SystemRoot\System32\tar.exe" -xzf $archive -C $package
  if ($LASTEXITCODE -ne 0) { throw "Codex extraction exited $LASTEXITCODE" }
  $version = & (Join-Path $package 'bin\codex.exe') --version
  if ($LASTEXITCODE -ne 0 -or $version -notmatch '^codex-cli ') { throw 'The downloaded Codex could not start.' }
  if (Test-Path -LiteralPath $destination) { Move-Item -LiteralPath $destination -Destination $backup }
  try { Move-Item -LiteralPath $package -Destination $destination }
  catch {
    if (Test-Path -LiteralPath $backup) { Move-Item -LiteralPath $backup -Destination $destination }
    throw
  }
  if (Test-Path -LiteralPath $backup) { Remove-Item -LiteralPath $backup -Recurse -Force }
  Write-Host "$version installed. Return to Pea to sign in."
} finally { Remove-Item -LiteralPath $work -Recurse -Force -ErrorAction SilentlyContinue }
`;
}

const versionParts = (name: string) => {
  const [core = "", pre] = name.split(/-(.*)/s);
  return { core: core.split(".").map((part) => Number.parseInt(part, 10) || 0), pre: pre ?? null };
};

/**
 * Codex's own standalone installer keeps each release as a physical folder beside a `current`
 * junction. The junction fails under RedirectionGuard; the highest release's exe does not.
 */
export function codexStandaloneRelease(home: string): string | null {
  const releases = join(home, ".codex", "packages", "standalone", "releases");
  let names: string[];
  try {
    names = readdirSync(releases);
  } catch {
    return null;
  }
  const best = names
    .filter((name) => existsSync(join(releases, name, "bin", "codex.exe")))
    .map((name) => ({ name, ...versionParts(name) }))
    .sort((a, b) => {
      for (let i = 0; i < Math.max(a.core.length, b.core.length); i++)
        if ((a.core[i] ?? 0) !== (b.core[i] ?? 0)) return (b.core[i] ?? 0) - (a.core[i] ?? 0);
      return a.pre === b.pre
        ? 0
        : a.pre === null
          ? -1
          : b.pre === null
            ? 1
            : b.pre.localeCompare(a.pre, "en", { numeric: true });
    })[0];
  return best ? join(releases, best.name, "bin", "codex.exe") : null;
}
