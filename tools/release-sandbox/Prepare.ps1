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
foreach ($role in 'previousMsi', 'candidateMsi', 'previousReceipt', 'candidateReceipt', 'previousZip', 'previousZipReceipt', 'candidateZip', 'candidateZipReceipt', 'sdkPackage') {
    if (@($files | Where-Object role -eq $role).Count -ne 1) { throw "Require exactly one $role" }
}
$names = @{}
foreach ($file in $files) {
    if ($file.role -notin 'previousMsi', 'candidateMsi', 'previousReceipt', 'candidateReceipt', 'previousZip', 'previousZipReceipt', 'candidateZip', 'candidateZipReceipt', 'sdkPackage', 'previousIdentity', 'vcRuntime', 'dotnetRuntime', 'recoveryZip') { throw "Unsupported input role: $($file.role)" }
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
    $zip = @($files | Where-Object role -eq ($release + 'Zip'))[0]
    $zipReceiptFile = @($files | Where-Object role -eq ($release + 'ZipReceipt'))[0]
    $zipReceipt = Get-Content -LiteralPath $zipReceiptFile.path -Raw | ConvertFrom-Json
    if ($zipReceipt.productKind -ne 'InstallZip' -or $zipReceipt.releaseVersion -ne $receipt.releaseVersion -or $zipReceipt.sourceRevision -ne $receipt.sourceRevision -or $zipReceipt.sha256 -ne $zip.sha256) { throw "Original $release archive receipt does not match final installer source/version/hash." }
    if ($release -eq 'candidate') { $candidateSource = $receipt.sourceRevision }
}
if ($config.expectedSdkVersion -notmatch '^0\.1\.0-beta\.[0-9]+$') { throw 'Expected SDK package version required' }
$config | Add-Member -NotePropertyName sourceRevision -NotePropertyValue $candidateSource -Force
New-Item -ItemType Directory -Path "$run\input", "$run\evidence" | Out-Null
Copy-Item -LiteralPath $specPath -Destination "$run\input\source-spec.json"
foreach ($file in $files) { Copy-Item -LiteralPath $file.path -Destination "$run\input\$($file.name)" }
$scripts = @()
foreach ($name in 'Guest.ps1', 'Observe.ps1', 'Boundary.ps1', 'Evidence.ps1', 'AutomaticBoundary.ps1', 'Automatic.ps1', 'UpdateReceipt.ps1', 'CompareSdkClosure.ps1', 'InstalledClosure.ps1', 'ReadInstalledMcp.ps1', 'CaptureDesktop.ps1', 'Windows.cs') {
    Copy-Item -LiteralPath "$PSScriptRoot\$name" -Destination "$run\input\$name"
    $scripts += @{ name = $name; sha256 = (Get-FileHash -LiteralPath "$run\input\$name").Hash }
}
$config | Add-Member -NotePropertyName scripts -NotePropertyValue $scripts -Force
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

