$ErrorActionPreference = 'Stop'
$scratch = Join-Path $env:TEMP ('pe-sandbox-check-' + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory $scratch | Out-Null
try {
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
    $xml = [xml](Get-Content $wsb -Raw)
    $maps = @($xml.Configuration.MappedFolders.MappedFolder)
    if ($maps.Count -ne 2 -or $maps[0].ReadOnly -ne 'true' -or $maps[1].ReadOnly -ne 'false' -or $maps[0].SandboxFolder -ne 'C:\GateInput' -or $maps[1].SandboxFolder -ne 'C:\GateEvidence' -or $xml.Configuration.ClipboardRedirection -ne 'Disable') { throw 'Unsafe Sandbox mappings.' }
    'corrupt' | Set-Content $files[0].path
    $refused = $false
    try { & "$PSScriptRoot\Prepare.ps1" -Spec $spec -RunDirectory "$scratch\bad" | Out-Null } catch { $refused = $_.Exception.Message -like 'Input hash mismatch:*' }
    if (!$refused -or (Test-Path "$scratch\bad")) { throw 'Corrupt release must refuse before staging.' }
    'PASS: script syntax, exact mapping isolation, input hashes, corrupt-input refusal. No Sandbox or installer executed.'
} finally {
    $resolved = [IO.Path]::GetFullPath($scratch)
    $tempRoot = [IO.Path]::GetFullPath($env:TEMP).TrimEnd('\') + '\'
    if (!$resolved.StartsWith($tempRoot, [StringComparison]::OrdinalIgnoreCase)) { throw 'Cleanup escaped temporary directory.' }
    Remove-Item -LiteralPath $resolved -Recurse -Force
}
