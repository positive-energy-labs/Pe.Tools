function Read-GateEvidenceHash([string]$Path) {
    $ErrorActionPreference = 'Stop'
    $before=Get-Item -LiteralPath $Path
    $length=$before.Length;$writeUtc=$before.LastWriteTimeUtc
    $stream=[IO.File]::Open($Path,[IO.FileMode]::Open,[IO.FileAccess]::Read,[IO.FileShare]::ReadWrite)
    $sha=[Security.Cryptography.SHA256]::Create()
    try {$hash=[BitConverter]::ToString($sha.ComputeHash($stream)).Replace('-','')} finally {$stream.Dispose();$sha.Dispose()}
    $after=Get-Item -LiteralPath $Path
    if ($after.Length -ne $length -or $after.LastWriteTimeUtc -ne $writeUtc) {throw ('Evidence changed during controlled hash: '+$Path)}
    return @{Path=$Path;Hash=$hash;Length=$length;LastWriteUtc=$writeUtc.ToString('o');stableDuringRead=$true;shareMode='ReadWrite'}
}
function Complete-GateEvidence([string]$Run,[scriptblock]$Cleanup,$SuccessResult=$null,[scriptblock]$Hasher={param($path) Read-GateEvidenceHash $path}) {
    $ErrorActionPreference = 'Stop'
    $phase='cleanup';$pending=Join-Path (Split-Path $Run) ('pending-result-'+[guid]::NewGuid().ToString('N')+'.json')
    try {
        & $Cleanup
        $phase='hash-collection'
        $hashes=@(Get-ChildItem $Run -File -Recurse | Where-Object {$_.FullName -ne (Join-Path $Run 'result.json') -and $_.FullName -ne (Join-Path $Run 'output-hashes.json')} | ForEach-Object {& $Hasher $_.FullName})
        if ($null -ne $SuccessResult) {
            $SuccessResult | ConvertTo-Json -Depth 15 | Set-Content $pending -Encoding UTF8
            $resultHash=& $Hasher $pending;$resultHash.Path=Join-Path $Run 'result.json';$hashes+=$resultHash
        } elseif (Test-Path "$Run\result.json") {$hashes+= & $Hasher "$Run\result.json"}
        $hashes | ConvertTo-Json -Depth 5 | Set-Content "$Run\output-hashes.json" -Encoding UTF8
        if ($null -ne $SuccessResult) {Copy-Item -LiteralPath $pending -Destination "$Run\result.json"}
    } catch {
        $_.Exception.ToString() | Set-Content "$Run\finalization-failure.txt"
        @{state='UNPROVEN';reason=('Gate evidence finalization failed: '+$_.Exception.Message);cleanupFailed=($phase -eq 'cleanup');collectionFailed=($phase -eq 'hash-collection');selfUpdate='Direct MSI is admission only'} | ConvertTo-Json | Set-Content "$Run\result.json"
        throw
    } finally {if (Test-Path $pending) {Remove-Item -LiteralPath $pending}}
}

