# Run inside the still-open guest: powershell -NoProfile -ExecutionPolicy Bypass -File C:\In\collect.ps1
[CmdletBinding()]
param(
    [string]$LocalAppDataRoot = $env:LOCALAPPDATA,
    [string]$OutputRoot = 'C:\Out\collected'
)
$ErrorActionPreference = 'Stop'
# Explicit roots permit fixture verification without reading the developer's product state.
if (!($PSBoundParameters.ContainsKey('LocalAppDataRoot') -and $PSBoundParameters.ContainsKey('OutputRoot')) -and
    ($env:USERNAME -ne 'WDAGUtilityAccount' -or !(Test-Path -LiteralPath 'C:\In') -or !(Test-Path -LiteralPath 'C:\Out'))) {
    throw 'Run the default collection inside Windows Sandbox, from C:\In\collect.ps1.'
}
$productRoot = Join-Path $LocalAppDataRoot 'Positive Energy\Pe.Tools'
$sdkRoot = Join-Path $LocalAppDataRoot 'Pe.Revit.Sdk'
if (!(Test-Path -LiteralPath (Join-Path $productRoot 'product.payloads.json') -PathType Leaf)) {
    throw "Installed product manifest is missing: $productRoot"
}
$collection = Join-Path $OutputRoot (([DateTime]::UtcNow.ToString('yyyyMMddTHHmmssfffZ')) + '-' + [Guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $collection -Force | Out-Null
$entries = New-Object 'System.Collections.Generic.List[object]'
function Copy-Evidence([string]$Source, [string]$Relative) {
    if (!(Test-Path -LiteralPath $Source)) {
        $entries.Add([pscustomobject]@{ source = $Source; relative = $Relative; status = 'missing' })
        return
    }
    try {
        $item = Get-Item -LiteralPath $Source -Force
        if ($item.Attributes -band [IO.FileAttributes]::ReparsePoint) {
            $entries.Add([pscustomobject]@{ source = $Source; relative = $Relative; status = 'skipped-reparse' })
            return
        }
        $destination = Join-Path $collection $Relative
        if ($item.PSIsContainer) {
            New-Item -ItemType Directory -Path $destination -Force | Out-Null
            foreach ($child in Get-ChildItem -LiteralPath $Source -Force) {
                Copy-Evidence $child.FullName (Join-Path $Relative $child.Name)
            }
        } else {
            New-Item -ItemType Directory -Path (Split-Path -Parent $destination) -Force | Out-Null
            Copy-Item -LiteralPath $Source -Destination $destination
            $entries.Add([pscustomobject]@{
                source = $Source; relative = $Relative; status = 'copied'
                sourceLengthBeforeCopy = $item.Length; sourceLastWriteUtc = $item.LastWriteTimeUtc.ToString('o')
                copiedLength = (Get-Item -LiteralPath $destination).Length
                sha256 = (Get-FileHash -LiteralPath $destination -Algorithm SHA256).Hash
                capturedAtUtc = [DateTime]::UtcNow.ToString('o')
            })
        }
    } catch {
        $entries.Add([pscustomobject]@{ source = $Source; relative = $Relative; status = 'error'; detail = $_.Exception.Message })
    }
}
Copy-Evidence (Join-Path $productRoot 'product.payloads.json') 'product\product.payloads.json'
Copy-Evidence (Join-Path $productRoot 'state') 'product\state'
Copy-Evidence (Join-Path $productRoot 'logs') 'product\logs'
Copy-Evidence (Join-Path $sdkRoot 'sessions\updates') 'sdk\sessions\updates'
Copy-Evidence (Join-Path $sdkRoot 'sessions\receipts\_update') 'sdk\sessions\receipts\_update'
Copy-Evidence (Join-Path $sdkRoot 'sessions\services') 'sdk\sessions\services'
Copy-Evidence (Join-Path $sdkRoot 'logs') 'sdk\logs'
Copy-Evidence 'C:\Out\setup.log' 'sandbox\setup.log'
Copy-Evidence 'C:\Out\install-0.7.24.log' 'sandbox\install-0.7.24.log'
# Collection is read-only at the sources. Live logs and receipts can change between copied files.
# State and logs can contain credentials or document paths; keep this evidence local.
$processes = @(Get-Process -Name 'Pe.Host', 'Pe.Host.Tray', 'pe-revit', 'msiexec' -ErrorAction SilentlyContinue | ForEach-Object {
    try { [pscustomobject]@{ pid = $_.Id; name = $_.ProcessName; path = $_.Path; startUtc = $_.StartTime.ToUniversalTime().ToString('o') } }
    catch { [pscustomobject]@{ pid = $_.Id; name = $_.ProcessName; error = $_.Exception.Message } }
})
$startup = @()
foreach ($key in 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Run', 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Explorer\StartupApproved\Run') {
    $value = Get-ItemProperty -LiteralPath $key -Name 'Pe.Tools' -ErrorAction SilentlyContinue
    $startup += [pscustomobject]@{ key = $key; value = if ($value) { $value.'Pe.Tools' } else { $null } }
}
$executables = @(foreach ($relative in 'bin\host\Pe.Host.exe', 'bin\host\tray\Pe.Host.Tray.exe', 'shims\pe-revit.exe') {
    $path = Join-Path $productRoot $relative
    try {
        $item = Get-Item -LiteralPath $path
        [pscustomobject]@{ path = $path; length = $item.Length; sha256 = (Get-FileHash -LiteralPath $path).Hash; fileVersion = $item.VersionInfo.FileVersion }
    } catch { [pscustomobject]@{ path = $path; error = $_.Exception.Message } }
})
$errors = @($entries | Where-Object status -eq 'error')
[pscustomobject]@{
    collectedAtUtc = [DateTime]::UtcNow.ToString('o'); productRoot = $productRoot; sdkRoot = $sdkRoot
    collection = $collection; nonAtomic = $true; entries = @($entries.ToArray()); processes = $processes; startup = $startup; executables = $executables
    errorCount = $errors.Count
} | ConvertTo-Json -Depth 12 | Set-Content -LiteralPath (Join-Path $collection 'collection.json') -Encoding UTF8
"Collected evidence: $collection (copy errors: $($errors.Count))"
if ($errors.Count) { throw 'Collection is incomplete. Read collection.json for failed paths.' }
