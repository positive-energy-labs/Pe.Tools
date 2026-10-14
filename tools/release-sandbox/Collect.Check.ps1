$ErrorActionPreference = 'Stop'
$root = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot ('..\..\.artifacts\runs\deterministic-20261014-collector\fixture-' + [Guid]::NewGuid().ToString('N'))))
$local = Join-Path $root 'local'
$out = Join-Path $root 'out'
$product = Join-Path $local 'Positive Energy\Pe.Tools'
$files = @{
    'Positive Energy\Pe.Tools\product.payloads.json' = '{"version":"0.7.25"}'
    'Positive Energy\Pe.Tools\state\host-update.json' = '{"requestId":"fixture"}'
    'Positive Energy\Pe.Tools\state\nested\state.json' = '{}'
    'Positive Energy\Pe.Tools\logs\host.log' = 'host fixture'
    'Pe.Revit.Sdk\sessions\updates\stub.msi.log' = 'MSI fixture'
    'Pe.Revit.Sdk\sessions\receipts\_update\receipt.json' = '{"state":"ok"}'
}
foreach ($relative in $files.Keys) {
    $target = Join-Path $local $relative
    New-Item -ItemType Directory -Path (Split-Path -Parent $target) -Force | Out-Null
    [IO.File]::WriteAllText($target, $files[$relative])
}
$collector = Join-Path $PSScriptRoot 'Collect.ps1'
& $collector -LocalAppDataRoot $local -OutputRoot $out
$first = @(Get-ChildItem -LiteralPath $out -Directory)
$summary = Get-Content -LiteralPath (Join-Path $first[0].FullName 'collection.json') -Raw | ConvertFrom-Json
if ($summary.errorCount -ne 0) { throw 'Fixture reported copy errors.' }
foreach ($relative in $files.Keys) {
    $source = Join-Path $local $relative
    $entry = @($summary.entries | Where-Object source -eq $source)
    if ($entry.Count -ne 1 -or $entry[0].status -ne 'copied') { throw "Missing evidence: $relative" }
    $copy = Join-Path $first[0].FullName $entry[0].relative
    if ((Get-FileHash -LiteralPath $source).Hash -ne (Get-FileHash -LiteralPath $copy).Hash) { throw "Changed bytes: $relative" }
}
if (!@($summary.entries | Where-Object status -eq 'missing').Count) { throw 'Missing optional directories were not reported.' }
& $collector -LocalAppDataRoot $local -OutputRoot $out
if (@(Get-ChildItem -LiteralPath $out -Directory).Count -ne 2) { throw 'Second collection overwrote the first.' }
$lockedPath = Join-Path $product 'logs\locked.log'
[IO.File]::WriteAllText($lockedPath, 'locked fixture')
$locked = [IO.File]::Open($lockedPath, [IO.FileMode]::Open, [IO.FileAccess]::ReadWrite, [IO.FileShare]::None)
try {
    try { & $collector -LocalAppDataRoot $local -OutputRoot $out; throw 'Locked source was accepted.' }
    catch { if ($_.Exception.Message -notlike 'Collection is incomplete*') { throw } }
    $partial = @(Get-ChildItem -LiteralPath $out -Directory | Sort-Object Name)[-1]
    $report = Get-Content -LiteralPath (Join-Path $partial.FullName 'collection.json') -Raw | ConvertFrom-Json
    if ($report.errorCount -ne 1 -or !@($report.entries | Where-Object { $_.source -eq $lockedPath -and $_.status -eq 'error' }).Count) {
        throw 'Locked-source error was not retained in collection.json.'
    }
    if (@($report.entries | Where-Object status -eq 'copied').Count -lt $files.Count) { throw 'One locked file stopped other copies.' }
} finally { $locked.Dispose() }
try { & $collector -LocalAppDataRoot (Join-Path $root 'absent') -OutputRoot $out; throw 'Missing manifest was accepted.' }
catch { if ($_.Exception.Message -notlike 'Installed product manifest is missing:*') { throw } }
try { & $collector; throw 'Developer default was accepted.' }
catch { if ($_.Exception.Message -notlike 'Run the default collection inside Windows Sandbox*') { throw } }
'PASS: six exact copies, nested state, missing-path records, repeat preservation, locked-file partial report, absent-manifest refusal, developer-default refusal.'
