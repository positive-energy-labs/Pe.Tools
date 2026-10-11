$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
if ($env:USERNAME -ne 'WDAGUtilityAccount' -or !(Test-Path 'C:\GateInput\gate.json') -or !(Test-Path 'C:\GateEvidence')) { throw 'Windows Sandbox mapped gate inputs required.' }
$run = 'C:\GateEvidence'
Start-Transcript "$run\transcript.txt" | Out-Null
function Check($name, [bool]$passed, $detail) {
    @{ name = $name; passed = $passed; detail = $detail; observedAtUtc = [datetime]::UtcNow.ToString('o') } | ConvertTo-Json -Depth 10 -Compress | Add-Content "$run\checks.jsonl"
    if (!$passed) { throw $name }
}
try {
    Copy-Item C:\GateInput\source-spec.json "$run\source-spec.json"
    $config = Get-Content C:\GateInput\gate.json -Raw | ConvertFrom-Json
    foreach ($file in $config.files) {
        Check "input $($file.name)" ((Get-FileHash -LiteralPath "C:\GateInput\$($file.name)").Hash -eq $file.sha256) $file.sha256
    }
    Check 'No Revit process' (@(Get-Process Revit -ErrorAction SilentlyContinue).Count -eq 0) 'No Autodesk product is launched by this gate.'
    # TODO: connect SDK-supported candidate admission before any previous-release MSI executes.
    throw 'UNPROVEN: SDK update reads published GitHub latest only. Candidate admission and previous-release updater compatibility must be implemented in the SDK before this gate can install or update.'
} catch {
    $_.Exception.ToString() | Set-Content "$run\failure.txt"
    @{ state = 'UNPROVEN'; reason = $_.Exception.Message } | ConvertTo-Json | Set-Content "$run\result.json"
} finally {
    Stop-Transcript | Out-Null
    Get-ChildItem -LiteralPath $run -File | Where-Object Name -ne 'output-hashes.json' | Get-FileHash -Algorithm SHA256 | Select-Object Hash, Path | ConvertTo-Json | Set-Content "$run\output-hashes.json"
}
