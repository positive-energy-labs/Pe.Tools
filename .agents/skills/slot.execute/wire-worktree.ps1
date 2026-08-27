# Wire a fresh worktree's source/pe-tools node_modules as per-entry junctions to a healthy checkout.
#   wire-worktree.ps1 <worktree-root> [<source-root>=this checkout]
# Workspace links (@pe/* -> apps|packages of the SOURCE) are re-pointed at the worktree's own tree so
# tsc/vitest prove THIS tree. Proof: `tsc --noEmit` exit 0 from apps/web after editing a packages/* type.
param(
    [Parameter(Mandatory)][string]$Worktree,
    [string]$Source = (Split-Path -Parent (Split-Path -Parent (Split-Path -Parent $PSScriptRoot)))
)
$ErrorActionPreference = "Stop"
$srcPt = Join-Path (Resolve-Path $Source) "source\pe-tools"
$wtPt = Join-Path (Resolve-Path $Worktree) "source\pe-tools"
if (-not (Test-Path (Join-Path $srcPt "node_modules\.modules.yaml"))) { throw "source install is not whole: $srcPt" }

function Link-Entry([System.IO.FileSystemInfo]$entry, [string]$dest) {
    if (Test-Path -LiteralPath $dest) { return }
    $target = $entry.FullName
    if ($entry.LinkType) {
        $resolved = (Get-Item -LiteralPath $entry.FullName).Target | Select-Object -First 1
        if ($resolved -and $resolved.StartsWith($srcPt, [StringComparison]::OrdinalIgnoreCase) -and $resolved -notmatch '\\node_modules\\') {
            $target = $wtPt + $resolved.Substring($srcPt.Length)   # workspace link -> this worktree
        } elseif ($resolved) { $target = $resolved }
    }
    if ($entry.PSIsContainer -or $entry.LinkType) { New-Item -ItemType Junction -Path $dest -Target $target | Out-Null }
    else { Copy-Item -LiteralPath $entry.FullName -Destination $dest }
}

function Wire-Dir([string]$rel) {
    $from = Join-Path $srcPt "$rel\node_modules"; $to = Join-Path $wtPt "$rel\node_modules"
    if (-not (Test-Path $from)) { return }
    New-Item -ItemType Directory -Force $to | Out-Null
    foreach ($e in Get-ChildItem -LiteralPath $from -Force) {
        if ($e.Name.StartsWith("@") -and -not $e.LinkType) {
            $scope = Join-Path $to $e.Name; New-Item -ItemType Directory -Force $scope | Out-Null
            foreach ($c in Get-ChildItem -LiteralPath $e.FullName -Force) { Link-Entry $c (Join-Path $scope $c.Name) }
        } else { Link-Entry $e (Join-Path $to $e.Name) }
    }
}

Wire-Dir "."
foreach ($d in @(Get-ChildItem (Join-Path $srcPt "apps") -Directory) + @(Get-ChildItem (Join-Path $srcPt "packages") -Directory)) {
    Wire-Dir ($d.FullName.Substring($srcPt.Length + 1))
}
"wired $wtPt from $srcPt"
