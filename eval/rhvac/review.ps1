param(
    [Parameter(Mandatory)]
    [string] $SnapshotManifest,
    [Parameter(Mandatory)]
    [string] $OutputDirectory,
    [string] $ProjectDirectory = "$PSScriptRoot/project-a",
    [string] $InkDirectory,
    [ValidateRange(1, 100)]
    [int] $ExpectedLevelCount = 5,
    [string] $Label = "takeoff-review"
)

$ErrorActionPreference = "Stop"
$destination = [IO.Path]::GetFullPath($OutputDirectory)
if (Test-Path -LiteralPath $destination) {
    throw "Output directory already exists: $destination"
}
$parent = Split-Path -Parent $destination
[IO.Directory]::CreateDirectory($parent) | Out-Null
$staging = Join-Path $parent ".partial-$([IO.Path]::GetFileName($destination))-$PID"
if (Test-Path -LiteralPath $staging) {
    throw "Staging directory already exists: $staging"
}
[IO.Directory]::CreateDirectory($staging) | Out-Null

try {
    $auditDirectory = Join-Path $staging "audit"
    dotnet run --project "$PSScriptRoot/review/Pe.Takeoff.Review.csproj" -- `
        --manifest $SnapshotManifest --out $auditDirectory --expected-level-count $ExpectedLevelCount
    $auditExit = $LASTEXITCODE
    if ($auditExit -notin 0, 2) {
        throw "Editability audit failed operationally with exit code $auditExit"
    }

    $structureDirectory = Join-Path $staging "structure"
    $scoreArgs = @(
        "$PSScriptRoot/score-takeoff.py",
        "--project", $ProjectDirectory,
        "--takeoff-dir", $auditDirectory,
        "--takeoff-label", "../audit",
        "--out-dir", $structureDirectory,
        "--review-gate",
        "--quiet"
    )
    if ($InkDirectory) { $scoreArgs += "--ink-dir", $InkDirectory }
    python @scoreArgs
    $structureExit = $LASTEXITCODE
    if ($structureExit -notin 0, 2) {
        throw "Structure diagnostics failed operationally with exit code $structureExit"
    }

    $bundleDirectory = Join-Path $staging "bundle"
    $reviewArgs = @(
        "$PSScriptRoot/review-takeoff.py",
        "--variant", "Candidate=$auditDirectory",
        "--audit", "Candidate=$auditDirectory",
        "--provenance", "Candidate=$auditDirectory/summary.json",
        "--out-dir", $bundleDirectory,
        "--expected-level-count", $ExpectedLevelCount,
        "--ink-manifest", $SnapshotManifest,
        "--label", $Label
    )
    if ($InkDirectory) { $reviewArgs += "--ink-dir", $InkDirectory }
    python @reviewArgs
    if ($LASTEXITCODE -ne 0) { throw "Review rendering failed with exit code $LASTEXITCODE" }
    python "$PSScriptRoot/review-takeoff.py" --verify "$bundleDirectory/manifest.json"
    if ($LASTEXITCODE -ne 0) { throw "Review verification failed with exit code $LASTEXITCODE" }
    Copy-Item -LiteralPath $SnapshotManifest -Destination (Join-Path $staging "input-manifest.json")
    python "$PSScriptRoot/review-takeoff.py" --seal-root $staging
    if ($LASTEXITCODE -ne 0) { throw "Review sealing failed with exit code $LASTEXITCODE" }
    python "$PSScriptRoot/review-takeoff.py" --verify "$staging/review-manifest.json"
    if ($LASTEXITCODE -ne 0) { throw "Complete review verification failed with exit code $LASTEXITCODE" }

    Move-Item -LiteralPath $staging -Destination $destination
    Write-Host "Review bundle: $destination"
    exit $(if ($auditExit -eq 0 -and $structureExit -eq 0) { 0 } else { 2 })
}
finally {
    if (Test-Path -LiteralPath $staging) {
        Remove-Item -LiteralPath $staging -Recurse -Force
    }
}
