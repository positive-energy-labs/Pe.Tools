$ErrorActionPreference = 'Stop'
# The crossing kit's dry run must plan every installed-lane check and touch nothing on the machine.
$kit = Join-Path $PSScriptRoot '../crossing-kit.ps1'
$work = Join-Path ([IO.Path]::GetTempPath()) ('crossing-kit-test-' + [Guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $work | Out-Null
try {
    $msi = Join-Path $work 'Pe.Tools-9.9.9.msi'
    $next = Join-Path $work 'Pe.Tools-9.9.10.msi'
    Set-Content -LiteralPath $msi -Value 'fixture'
    Set-Content -LiteralPath $next -Value 'fixture'
    . $kit -Installer $msi -Out (Join-Path $work 'out')

    foreach ($name in 'Start-Process', 'Invoke-RestMethod', 'Invoke-WebRequest', 'Stop-Process', 'Set-ItemProperty') {
        Set-Item -Path ('function:global:' + $name) -Value ([scriptblock]::Create("throw 'The dry run touched the machine: $name'"))
    }
    function global:Assert-Test([string]$Name, [bool]$Passed) {
        if (-not $Passed) { throw ('FAIL ' + $Name) }
        Write-Output ('PASS ' + $Name)
    }

    $report = Invoke-Crossing $msi $next (Join-Path $work 'out') $false
    Assert-Test 'dry run plans the install, the host and the four F1 checks in order' (($report.steps.id -join ',') -eq 'install,host-up,sign-in-console,paste-code,login-expired,quit-guard,update-reopen')
    Assert-Test 'a dry run runs nothing: every step is planned or left to a person' (@($report.steps | Where-Object { $_.outcome -notin 'planned', 'human' }).Count -eq 0)
    Assert-Test 'the dry run created no output folder' (-not (Test-Path (Join-Path $work 'out')))
    Assert-Test 'every human step says what to click and what to see' (@($report.steps | Where-Object { $_.mode -eq 'human' -and (@($_.instructions | Where-Object { $_ -like 'SEE*' }).Count -lt 1) }).Count -eq 0)
    Assert-Test 'the installer is hashed' ($report.sha256 -match '^[A-F0-9]{64}$')
    $without = Invoke-Crossing $msi $null (Join-Path $work 'out') $false
    Assert-Test 'without a next installer the update step says it is not run' (($without.steps | Where-Object id -eq 'update-reopen').instructions[0] -like 'Not run*')

    $refused = { param($Script) try { & $Script; $false } catch { $true } }
    Assert-Test 'a missing installer is refused' (& $refused { Invoke-Crossing (Join-Path $work 'absent.msi') $null (Join-Path $work 'out') $false })
    Set-Content -LiteralPath (Join-Path $work 'x.exe') -Value 'fixture'
    Assert-Test 'a non-MSI is refused' (& $refused { Invoke-Crossing (Join-Path $work 'x.exe') $null (Join-Path $work 'out') $false })
    function global:Test-ProductInstalled { $true }
    Assert-Test 'Execute refuses a machine that already has the product, before anything runs' (& $refused { Invoke-Crossing $msi $null (Join-Path $work 'out') $true })
} finally {
    Remove-Item -LiteralPath $work -Recurse -Force -ErrorAction SilentlyContinue
}
