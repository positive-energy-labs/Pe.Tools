$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot '../product-paths.ps1')
$fixture = Join-Path ([IO.Path]::GetTempPath()) ('pe-isofix-' + [Guid]::NewGuid().ToString('N'))
$previousHome = $env:PE_TOOLS_PRODUCT_HOME
$previousLocal = $env:LOCALAPPDATA
function Assert-Equal($Actual, $Expected, $Name) {
    if ($Actual -ne $Expected) { throw "$Name expected '$Expected', received '$Actual'" }
    Write-Output "PASS $Name"
}
function Assert-Refused([scriptblock]$Action, $Name) {
    try { & $Action } catch {
        if ($_.Exception.Message -notlike '*installed product state*') { throw }
        Write-Output "PASS $Name"
        return
    }
    throw "$Name did not refuse installed product state"
}
try {
    $checkoutRoot = Join-Path $fixture 'checkout'
    New-Item -ItemType Directory -Path $checkoutRoot -Force | Out-Null
    Set-Content -LiteralPath (Join-Path $checkoutRoot '.git') -Value 'gitdir: fixture'
    Set-Content -LiteralPath (Join-Path $checkoutRoot 'Pe.Tools.slnx') -Value ''
    $env:LOCALAPPDATA = Join-Path $fixture 'Users/owner/AppData/Local'
    $env:PE_TOOLS_PRODUCT_HOME = $null
    $installed = Join-Path $env:LOCALAPPDATA 'Positive Energy/Pe.Tools'
    $expected = Join-Path $checkoutRoot '.artifacts/pe-tools'
    Assert-Equal (Resolve-ProductRuntimeRoot -Lane dev -SourceRoot $checkoutRoot) $expected 'dev checkout root'
    Assert-Equal (Resolve-ProductRuntimeRoot -Lane installed) $installed 'installed root'
    # Evaluate only the real tray's service-path assignment, never its process or IO body.
    $tokens = $null
    $errors = $null
    $ast = [Management.Automation.Language.Parser]::ParseFile((Join-Path $PSScriptRoot '../dev-tray.ps1'), [ref]$tokens, [ref]$errors)
    if ($errors.Count) { throw $errors[0] }
    $assignment = $ast.Find({ param($node) $node -is [Management.Automation.Language.AssignmentStatementAst] -and $node.Left.Extent.Text -eq '$services' }, $true)
    Invoke-Expression $assignment.Extent.Text
    Assert-Equal $services (Join-Path $expected 'state/service') 'tray finds checkout service receipts'
    $env:PE_TOOLS_PRODUCT_HOME = Join-Path $fixture 'home'
    Assert-Equal (Resolve-ProductRuntimeRoot -Lane dev -SourceRoot $checkoutRoot) (Join-Path $env:PE_TOOLS_PRODUCT_HOME '.local-state') 'dev override'
    $env:PE_TOOLS_PRODUCT_HOME = $installed
    Assert-Refused { Resolve-ProductRuntimeRoot -Lane dev -SourceRoot $checkoutRoot } 'installed descendant'
    $env:PE_TOOLS_PRODUCT_HOME = Join-Path $fixture 'linked-home'
    New-Item -ItemType Directory -Path $env:PE_TOOLS_PRODUCT_HOME, $installed -Force | Out-Null
    New-Item -ItemType Junction -Path (Join-Path $env:PE_TOOLS_PRODUCT_HOME '.local-state') -Target $installed | Out-Null
    Assert-Refused { Resolve-ProductRuntimeRoot -Lane dev -SourceRoot $checkoutRoot } 'installed junction'
} finally {
    $env:PE_TOOLS_PRODUCT_HOME = $previousHome
    $env:LOCALAPPDATA = $previousLocal
    # Remove the junction first; never recursively traverse its target during fixture cleanup.
    $link = Join-Path $fixture 'linked-home/.local-state'
    if (Test-Path -LiteralPath $link) { [IO.Directory]::Delete($link) }
    $resolvedFixture = [IO.Path]::GetFullPath($fixture)
    if (-not $resolvedFixture.StartsWith([IO.Path]::GetTempPath(), [StringComparison]::OrdinalIgnoreCase)) { throw 'Fixture escaped temp' }
    Remove-Item -LiteralPath $resolvedFixture -Recurse -Force
}
