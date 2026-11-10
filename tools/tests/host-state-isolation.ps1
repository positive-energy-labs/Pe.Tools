$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot '../product-paths.ps1')
# The PowerShell resolver asserts the same table as C# ProductPathing.StateRoot and TS stateRoot.
$table = Get-Content -LiteralPath (Join-Path $PSScriptRoot '../../ts/packages/host-contracts/tests/runtime-ownership.fixture.json') -Raw | ConvertFrom-Json
$failures = @()
foreach ($row in $table.stateRoots) {
    $previousShared = $env:PE_TOOLS_SHARED_ROOT
    $env:PE_TOOLS_SHARED_ROOT = $row.sharedRoot
    $refused = $null
    $actual = $null
    try {
        # A fixture user root is pure input; otherwise the resolver fences this machine's Documents user root.
        $user = if ($row.PSObject.Properties['userRoot']) { @{ UserRoot = $row.userRoot } } else { @{} }
        $actual = Resolve-ProductRuntimeRoot -Lane $row.lane -Root $row.ownerRoot -ProductHomeOverride $row.productHome @user
    } catch {
        $refused = $_.Exception.Message
    } finally {
        $env:PE_TOOLS_SHARED_ROOT = $previousShared
    }
    # Assert outside the try, so a resolver that stops refusing cannot be caught by its own failure message.
    try {
        if ($row.error) {
            if ($null -eq $refused) { throw "$($row.name) expected refusal '$($row.error)', received '$actual'" }
            if (-not $refused.Contains($row.error)) { throw "$($row.name) refused with '$refused'" }
        } elseif ($null -ne $refused) { throw "$($row.name) refused unexpectedly: $refused" }
        elseif ($actual -ne $row.stateRoot) { throw "$($row.name) expected '$($row.stateRoot)', received '$actual'" }
        Write-Output "PASS $($row.name)"
    } catch {
        $failures += $_.Exception.Message
        Write-Output "FAIL $($_.Exception.Message)"
    }
}
if ($failures.Count) { throw ($failures -join [Environment]::NewLine) }
$documents = [Environment]::GetFolderPath('MyDocuments')
foreach ($row in $table.contentHomes) {
    $expected = @($row.homes | ForEach-Object { $_.Replace('%DOCUMENTS%', $documents) }) -join '|'
    $actual = @(Resolve-ContentHomes -ProductHomeOverride $row.productHome -SharedRoot $row.sharedRoot) -join '|'
    if ($actual -ne $expected) { throw "$($row.name): homes expected '$expected', received '$actual'" }
    $firm = Resolve-SharedFirmDir -SharedRoot $row.sharedRoot
    $keys = Resolve-SharedKeysPath -SharedRoot $row.sharedRoot
    if ($firm -ne $row.firm -or $keys -ne $row.keys) { throw "$($row.name): shared settings expected '$($row.firm)' / '$($row.keys)', received '$firm' / '$keys'" }
    Write-Output "PASS $($row.name)"
}
# A caller that names no lane is refused rather than defaulted to installed.
foreach ($name in 'Lane', 'Root') {
    $parameter = (Get-Command Resolve-ProductRuntimeRoot).Parameters[$name]
    if (-not ($parameter.Attributes | Where-Object { $_ -is [Parameter] -and $_.Mandatory })) { throw "-$name has a default" }
}
Write-Output 'PASS lane and root are mandatory'
# Evaluate only the real tray's service-path assignment, never its process or IO body.
$previousHome = $env:PE_TOOLS_PRODUCT_HOME
try {
    $env:PE_TOOLS_PRODUCT_HOME = $null
    $checkoutRoot = 'C:\src\Pe.Tools'
    $tokens = $null
    $errors = $null
    $ast = [Management.Automation.Language.Parser]::ParseFile((Join-Path $PSScriptRoot '../dev-tray.ps1'), [ref]$tokens, [ref]$errors)
    if ($errors.Count) { throw $errors[0] }
    $assignment = $ast.Find({ param($node) $node -is [Management.Automation.Language.AssignmentStatementAst] -and $node.Left.Extent.Text -eq '$services' }, $true)
    Invoke-Expression $assignment.Extent.Text
    if ($services -ne 'C:\src\Pe.Tools\.artifacts\pe-tools\state\service') { throw "tray service receipts resolved to '$services'" }
    Write-Output 'PASS tray finds checkout service receipts'
} finally {
    $env:PE_TOOLS_PRODUCT_HOME = $previousHome
}
