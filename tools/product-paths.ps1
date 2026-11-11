# The PowerShell form of the product path rules (ADR 0035 rule 11; C# ProductPathing, TS product-paths.ts
# and service-identity.ts); all assert ts/packages/host-contracts/tests/runtime-ownership.fixture.json.
# Two content homes: the user root always (an isolated PE_TOOLS_PRODUCT_HOME, else <Documents>\Pe.Tools),
# then the optional PE_TOOLS_SHARED_ROOT. Callers own directory creation.
function Resolve-DocumentsUserRoot {
    return [IO.Path]::Combine([Environment]::GetFolderPath('MyDocuments'), 'Pe.Tools')
}

function Resolve-UserRoot {
    param([string]$ProductHomeOverride = $env:PE_TOOLS_PRODUCT_HOME)
    if ([string]::IsNullOrWhiteSpace($ProductHomeOverride)) { return Resolve-DocumentsUserRoot }
    return [IO.Path]::GetFullPath($ProductHomeOverride.Trim())
}

function Resolve-SharedRoot {
    param([string]$SharedRoot = $env:PE_TOOLS_SHARED_ROOT)
    if ([string]::IsNullOrWhiteSpace($SharedRoot)) { return $null }
    return [IO.Path]::GetFullPath($SharedRoot.Trim())
}

# The read order: user first, so an item in both homes resolves to the user's copy.
function Resolve-ContentHomes {
    param([string]$ProductHomeOverride = $env:PE_TOOLS_PRODUCT_HOME, [string]$SharedRoot = $env:PE_TOOLS_SHARED_ROOT)
    $shared = Resolve-SharedRoot -SharedRoot $SharedRoot
    $homes = @(Resolve-UserRoot -ProductHomeOverride $ProductHomeOverride)
    if ($shared) { $homes += $shared }
    return $homes
}

function Resolve-SharedFirmDir {
    param([string]$SharedRoot = $env:PE_TOOLS_SHARED_ROOT)
    $shared = Resolve-SharedRoot -SharedRoot $SharedRoot
    if ($shared) { return [IO.Path]::Combine($shared, 'Firm') }
    return $null
}

function Resolve-SharedKeysPath {
    param([string]$SharedRoot = $env:PE_TOOLS_SHARED_ROOT)
    $shared = Resolve-SharedRoot -SharedRoot $SharedRoot
    if ($shared) { return [IO.Path]::Combine($shared, 'keys.json') }
    return $null
}

# The caller names its lane and owner root (a checkout, or the SDK install root); nothing defaults.
function Resolve-ProductRuntimeRoot {
    param(
        [Parameter(Mandatory)][ValidateSet('dev', 'installed')][string]$Lane,
        [Parameter(Mandatory)][string]$Root,
        [string]$ProductHomeOverride = $env:PE_TOOLS_PRODUCT_HOME,
        [string]$SharedRoot = $env:PE_TOOLS_SHARED_ROOT,
        [string]$UserRoot = (Resolve-DocumentsUserRoot)
    )
    if (-not [IO.Path]::IsPathRooted($Root)) { throw "A $Lane runtime needs an absolute owner root." }
    if ($Lane -eq 'installed' -and -not [string]::IsNullOrWhiteSpace($ProductHomeOverride)) {
        throw 'An installed runtime does not run under PE_TOOLS_PRODUCT_HOME.'
    }
    $overridden = -not [string]::IsNullOrWhiteSpace($ProductHomeOverride)
    $stateOwner = [IO.Path]::GetFullPath($(if ($overridden) { $ProductHomeOverride.Trim() } else { $Root }))
    # Combine, not Join-Path: pure string work, like C# and TS, even for a drive that is not mounted.
    $stateRoot = if ($overridden) { [IO.Path]::Combine($stateOwner, '.local-state') }
        elseif ($Lane -eq 'dev') { [IO.Path]::Combine($stateOwner, '.artifacts', 'pe-tools') } else { $Root }
    # An override's .local-state sits in its own home by design (an isolated run); only the default user root is a share.
    $fences = @(@($SharedRoot, 'PE_TOOLS_SHARED_ROOT'), @($(if ($overridden) { $null } else { $UserRoot }), 'the user content root'))
    foreach ($fence in $fences) {
        if ([string]::IsNullOrWhiteSpace($fence[0])) { continue }
        $fenceRoot = [IO.Path]::GetFullPath($fence[0].Trim())
        $prefix = $fenceRoot.TrimEnd([char[]]@('\', '/')) + [IO.Path]::DirectorySeparatorChar
        if (([IO.Path]::GetFullPath($stateRoot).TrimEnd([char[]]@('\', '/')) + [IO.Path]::DirectorySeparatorChar).StartsWith($prefix, [StringComparison]::OrdinalIgnoreCase)) {
            throw "Machine state root '$stateRoot' cannot be at or under $($fence[1]) '$fenceRoot'."
        }
    }
    return $stateRoot
}
