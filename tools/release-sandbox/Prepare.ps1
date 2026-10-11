param(
    [Parameter(Mandatory)][string]$Spec,
    [Parameter(Mandatory)][string]$RunDirectory
)
$ErrorActionPreference = 'Stop'
# Preparation never launches Sandbox or executes an installer on the host.
$specPath = (Resolve-Path -LiteralPath $Spec).Path
$config = Get-Content -LiteralPath $specPath -Raw | ConvertFrom-Json
$run = [IO.Path]::GetFullPath($RunDirectory)
if (Test-Path -LiteralPath $run) { throw 'Use a new run directory; failed evidence is retained.' }
foreach ($name in 'previousVersion', 'candidateVersion') {
    if ([string]::IsNullOrWhiteSpace($config.$name)) { throw "Missing $name" }
}
if ($config.previousVersion -eq $config.candidateVersion) { throw 'The releases must differ.' }
$files = @($config.files)
foreach ($role in 'previousMsi', 'candidateMsi', 'previousReceipt', 'candidateReceipt') {
    if (@($files | Where-Object role -eq $role).Count -ne 1) { throw "Require exactly one $role" }
}
$names = @{}
foreach ($file in $files) {
    if ($file.role -notin 'previousMsi', 'candidateMsi', 'previousReceipt', 'candidateReceipt', 'vcRuntime', 'dotnetRuntime', 'recoveryZip') { throw "Unsupported input role: $($file.role)" }
    if (@($files | Where-Object role -eq $file.role).Count -ne 1) { throw "Duplicate input role: $($file.role)" }
    if ($file.name -notmatch '^[a-zA-Z0-9][a-zA-Z0-9._-]*$' -or $names.ContainsKey($file.name)) { throw 'Invalid or duplicate staged filename.' }
    $names[$file.name] = $true
    if ($file.sha256 -notmatch '^[a-fA-F0-9]{64}$') { throw "Invalid hash: $($file.name)" }
    $source = (Resolve-Path -LiteralPath $file.path).Path
    if ((Get-Item -LiteralPath $source).PSIsContainer) { throw 'Only explicit files can be staged.' }
    if ((Get-FileHash -LiteralPath $source -Algorithm SHA256).Hash -ne $file.sha256) { throw "Input hash mismatch: $source" }
}
foreach ($release in 'previous', 'candidate') {
    $msi = @($files | Where-Object role -eq ($release + 'Msi'))[0]
    if ([IO.Path]::GetExtension($msi.name) -ne '.msi') { throw 'Final distributables must be MSI files.' }
    $receiptFile = @($files | Where-Object role -eq ($release + 'Receipt'))[0]
    $receipt = Get-Content -LiteralPath $receiptFile.path -Raw | ConvertFrom-Json
    if ($receipt.releaseVersion -ne $config.($release + 'Version') -or $receipt.productKind -ne 'Msi' -or $receipt.sha256 -ne $msi.sha256 -or $receipt.sourceRevision -notmatch '^[a-fA-F0-9]{40}$') { throw "SDK installer receipt does not bind $release version, source revision and final MSI hash." }
}
New-Item -ItemType Directory -Path "$run\input", "$run\evidence" | Out-Null
Copy-Item -LiteralPath $specPath -Destination "$run\input\source-spec.json"
foreach ($file in $files) { Copy-Item -LiteralPath $file.path -Destination "$run\input\$($file.name)" }
Copy-Item -LiteralPath "$PSScriptRoot\Guest.ps1" -Destination "$run\input\Guest.ps1"
Copy-Item -LiteralPath "$PSScriptRoot\Observe.ps1" -Destination "$run\input\Observe.ps1"
Copy-Item -LiteralPath "$PSScriptRoot\Boundary.ps1" -Destination "$run\input\Boundary.ps1"
Copy-Item -LiteralPath "$PSScriptRoot\Windows.cs" -Destination "$run\input\Windows.cs"
$config | ConvertTo-Json -Depth 10 | Set-Content -LiteralPath "$run\input\gate.json" -Encoding UTF8
$inputPath = [Security.SecurityElement]::Escape("$run\input")
$outputPath = [Security.SecurityElement]::Escape("$run\evidence")
@"
<Configuration>
  <MemoryInMB>6144</MemoryInMB>
  <Networking>Enable</Networking>
  <AudioInput>Disable</AudioInput>
  <VideoInput>Disable</VideoInput>
  <PrinterRedirection>Disable</PrinterRedirection>
  <ClipboardRedirection>Disable</ClipboardRedirection>
  <MappedFolders>
    <MappedFolder><HostFolder>$inputPath</HostFolder><SandboxFolder>C:\GateInput</SandboxFolder><ReadOnly>true</ReadOnly></MappedFolder>
    <MappedFolder><HostFolder>$outputPath</HostFolder><SandboxFolder>C:\GateEvidence</SandboxFolder><ReadOnly>false</ReadOnly></MappedFolder>
  </MappedFolders>
  <LogonCommand><Command>powershell.exe -NoProfile -ExecutionPolicy Bypass -File C:\GateInput\Guest.ps1</Command></LogonCommand>
</Configuration>
"@ | Set-Content -LiteralPath "$run\acceptance.wsb" -Encoding UTF8
Get-ChildItem -LiteralPath "$run\input" -File | Get-FileHash -Algorithm SHA256 | Select-Object Hash, Path | ConvertTo-Json | Set-Content "$run\input-hashes.json"
Write-Output "$run\acceptance.wsb"
