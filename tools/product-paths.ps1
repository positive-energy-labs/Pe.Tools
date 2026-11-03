# Mirrors ts/packages/host-contracts/src/service-identity.ts productRoot and
# dotnet/Pe.Shared.Product/ProductPathing.cs ResolveRuntimeRoot. Callers own directory creation.
function Resolve-ProductCanonicalPath {
    param([string]$Path)
    $full = [IO.Path]::GetFullPath($Path)
    $parent = [IO.Path]::GetDirectoryName($full)
    if (-not $parent) { return $full }
    $canonicalParent = Resolve-ProductCanonicalPath $parent
    $candidate = Join-Path $canonicalParent ([IO.Path]::GetFileName($full))
    $item = Get-Item -LiteralPath $candidate -Force -ErrorAction SilentlyContinue
    if ($item -and ($item.Attributes -band [IO.FileAttributes]::ReparsePoint)) {
        $target = @($item.Target)[0]
        if (-not $target) { throw "Cannot resolve state path link '$candidate'." }
        if (-not [IO.Path]::IsPathRooted($target)) { $target = Join-Path $canonicalParent $target }
        return Resolve-ProductCanonicalPath $target
    }
    return $candidate
}

function Resolve-ProductRuntimeRoot {
    param(
        [string]$ProductHomeOverride = $env:PE_TOOLS_PRODUCT_HOME,
        [string]$LocalAppData = $env:LOCALAPPDATA,
        [ValidateSet('dev', 'installed')][string]$Lane = 'installed',
        [string]$SourceRoot
    )
    if ([string]::IsNullOrWhiteSpace($LocalAppData)) {
        $LocalAppData = [Environment]::GetFolderPath('LocalApplicationData')
    }
    $installed = Join-Path $LocalAppData 'Positive Energy/Pe.Tools'
    if ($Lane -eq 'dev') {
        if ([string]::IsNullOrWhiteSpace($SourceRoot) -or
            -not (Test-Path -LiteralPath (Join-Path $SourceRoot '.git')) -or
            -not (Test-Path -LiteralPath (Join-Path $SourceRoot 'Pe.Tools.slnx') -PathType Leaf)) {
            throw 'A dev state root requires a Pe.Tools checkout.'
        }
        $root = Join-Path ([IO.Path]::GetFullPath($SourceRoot)) '.artifacts/pe-tools'
    } else { $root = $installed }
    if (-not [string]::IsNullOrWhiteSpace($ProductHomeOverride)) {
        $root = Join-Path ([IO.Path]::GetFullPath($ProductHomeOverride.Trim())) '.local-state'
    }
    if ($Lane -eq 'dev') {
        $canonicalInstalled = (Resolve-ProductCanonicalPath $installed).TrimEnd('\')
        $canonicalRoot = (Resolve-ProductCanonicalPath $root).TrimEnd('\')
        if ($canonicalRoot.Equals($canonicalInstalled, [StringComparison]::OrdinalIgnoreCase) -or
            $canonicalRoot.StartsWith($canonicalInstalled + '\', [StringComparison]::OrdinalIgnoreCase)) {
            throw "Dev host cannot use installed product state '$root'."
        }
    }
    return $root
}
