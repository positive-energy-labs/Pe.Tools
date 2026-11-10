# The PowerShell form of the one state-root rule (C# ProductPathing.StateRoot, TS stateRoot); all three
# assert ts/packages/host-contracts/tests/runtime-ownership.fixture.json. The caller names its lane and
# owner root (a checkout, or the SDK install root); nothing defaults. Callers own directory creation.
function Resolve-ProductContentRoot {
    param(
        [string]$ProductHomeOverride = $env:PE_TOOLS_PRODUCT_HOME,
        [string]$SharedRoot = $env:PE_TOOLS_SHARED_ROOT
    )
    $content = if ([string]::IsNullOrWhiteSpace($ProductHomeOverride)) { $SharedRoot } else { $ProductHomeOverride }
    if ([string]::IsNullOrWhiteSpace($content)) { throw 'Set PE_TOOLS_SHARED_ROOT to the shared content mount.' }
    return [IO.Path]::GetFullPath($content.Trim())
}

function Resolve-ProductRuntimeRoot {
    param(
        [Parameter(Mandatory)][ValidateSet('dev', 'installed')][string]$Lane,
        [Parameter(Mandatory)][string]$Root,
        [string]$ProductHomeOverride = $env:PE_TOOLS_PRODUCT_HOME,
        [string]$SharedRoot = $env:PE_TOOLS_SHARED_ROOT
    )
    if (-not [IO.Path]::IsPathRooted($Root)) { throw "A $Lane runtime needs an absolute owner root." }
    if ($Lane -eq 'installed' -and -not [string]::IsNullOrWhiteSpace($ProductHomeOverride)) {
        throw 'An installed runtime does not run under PE_TOOLS_PRODUCT_HOME.'
    }
    $stateOwner = [IO.Path]::GetFullPath($(if ([string]::IsNullOrWhiteSpace($ProductHomeOverride)) { $Root } else { $ProductHomeOverride.Trim() }))
    # Combine, not Join-Path: pure string work, like C# and TS, even for a drive that is not mounted.
    $stateRoot = if (-not [string]::IsNullOrWhiteSpace($ProductHomeOverride)) { [IO.Path]::Combine($stateOwner, '.local-state') }
        elseif ($Lane -eq 'dev') { [IO.Path]::Combine($stateOwner, '.artifacts', 'pe-tools') } else { $Root }
    if (-not [string]::IsNullOrWhiteSpace($SharedRoot)) {
        $shared = [IO.Path]::GetFullPath($SharedRoot.Trim())
        $sharedPrefix = $shared.TrimEnd([char[]]@('\', '/')) + [IO.Path]::DirectorySeparatorChar
        if (([IO.Path]::GetFullPath($stateRoot).TrimEnd([char[]]@('\', '/')) + [IO.Path]::DirectorySeparatorChar).StartsWith($sharedPrefix, [StringComparison]::OrdinalIgnoreCase)) {
            throw "Machine state root '$stateRoot' cannot be at or under PE_TOOLS_SHARED_ROOT '$shared'."
        }
    }
    return $stateRoot
}
