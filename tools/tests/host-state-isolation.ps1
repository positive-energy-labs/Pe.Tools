$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot '../product-paths.ps1')
# The PowerShell resolver asserts the same table as C# ProductPathing.StateRoot and TS stateRoot.
$table = Get-Content -LiteralPath (Join-Path $PSScriptRoot '../../ts/packages/host-contracts/tests/runtime-ownership.fixture.json') -Raw | ConvertFrom-Json
foreach ($row in $table.stateRoots) {
    try {
        $actual = Resolve-ProductRuntimeRoot -Lane $row.lane -Root $row.ownerRoot -ProductHomeOverride $row.productHome
        if ($row.error) { throw "$($row.name) expected refusal '$($row.error)', received '$actual'" }
        if ($actual -ne $row.stateRoot) { throw "$($row.name) expected '$($row.stateRoot)', received '$actual'" }
    } catch {
        if (-not $row.error -or $_.Exception.Message -notlike "*$($row.error)*") { throw }
    }
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
