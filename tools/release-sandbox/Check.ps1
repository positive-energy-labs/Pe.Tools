$ErrorActionPreference = 'Stop'
$scratch = Join-Path $env:TEMP ('pe-sandbox-check-' + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory $scratch | Out-Null
try {
    . "$PSScriptRoot\Boundary.ps1"
    foreach ($script in Get-ChildItem $PSScriptRoot -Filter '*.ps1') {
        $tokens = $null; $errors = $null
        [Management.Automation.Language.Parser]::ParseFile($script.FullName, [ref]$tokens, [ref]$errors) | Out-Null
        if ($errors.Count) { throw ($errors | Out-String) }
    }
    $files = @()
    foreach ($release in 'previous', 'candidate') {
        $role = $release + 'Msi'
        $path = Join-Path $scratch ($role + '.msi')
        $role | Set-Content $path
        $hash = (Get-FileHash $path).Hash
        $files += @{ role = $role; name = $role + '.msi'; path = $path; sha256 = $hash }
        $role = $release + 'Receipt'
        $path = Join-Path $scratch ($role + '.json')
        @{ version = $(if ($release -eq 'previous') { '1' } else { '2' }); sourceCommit = ('a' * 40); sha256 = $hash } | ConvertTo-Json | Set-Content $path
        $files += @{ role = $role; name = $role + '.json'; path = $path; sha256 = (Get-FileHash $path).Hash }
    }
    $spec = Join-Path $scratch 'spec.json'
    @{ previousVersion = '1'; candidateVersion = '2'; files = $files } | ConvertTo-Json -Depth 10 | Set-Content $spec
    $wsb = & "$PSScriptRoot\Prepare.ps1" -Spec $spec -RunDirectory "$scratch\run"
    $config = Get-Content $spec -Raw | ConvertFrom-Json
    $plan = [pscustomobject]@{ available = $true; current = '1'; latest = '2'; msi = @{ digest = 'sha256:' + $files[2].sha256.ToLowerInvariant(); size = 20 }; revits = @(); effects = @{ restartYears = @(); reopen = @() }; blockers = @() }
    AssertCandidate $plan $config 20
    $plan.latest = '3'
    $refused = $false
    try { AssertCandidate $plan $config 20 } catch { $refused = $true }
    if (!$refused) { throw 'Wrong published candidate accepted.' }
    $receipt = [pscustomobject]@{ state = 'ok'; legs = @(@{ name = 'install'; status = 'ok'; exitCode = 0 }, @{ name = 'done'; status = 'ok' }) }
    AssertTerminal $receipt
    $receipt.legs = @(@{ name = 'handoff'; status = 'ok' })
    $refused = $false
    try { AssertTerminal $receipt } catch { $refused = $true }
    if (!$refused) { throw 'Handoff accepted as terminal update.' }
    $xml = [xml](Get-Content $wsb -Raw)
    $maps = @($xml.Configuration.MappedFolders.MappedFolder)
    if ($maps.Count -ne 2 -or $maps[0].ReadOnly -ne 'true' -or $maps[1].ReadOnly -ne 'false' -or $maps[0].SandboxFolder -ne 'C:\GateInput' -or $maps[1].SandboxFolder -ne 'C:\GateEvidence' -or $xml.Configuration.ClipboardRedirection -ne 'Disable') { throw 'Unsafe Sandbox mappings.' }
    'corrupt' | Set-Content $files[0].path
    $refused = $false
    try { & "$PSScriptRoot\Prepare.ps1" -Spec $spec -RunDirectory "$scratch\bad" | Out-Null } catch { $refused = $_.Exception.Message -like 'Input hash mismatch:*' }
    if (!$refused -or (Test-Path "$scratch\bad")) { throw 'Corrupt release must refuse before staging.' }
    'PASS: script syntax, exact mapping isolation, input hashes, corrupt-input refusal, candidate binding, terminal receipt boundary. No Sandbox or installer executed.'
} finally {
    $resolved = [IO.Path]::GetFullPath($scratch)
    $tempRoot = [IO.Path]::GetFullPath($env:TEMP).TrimEnd('\') + '\'
    if (!$resolved.StartsWith($tempRoot, [StringComparison]::OrdinalIgnoreCase)) { throw 'Cleanup escaped temporary directory.' }
    Remove-Item -LiteralPath $resolved -Recurse -Force
}
