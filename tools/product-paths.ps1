# PowerShell's one product runtime resolver, mirroring ProductPathing and productRoot.
# Resolution is pure. Callers create only the directories their operation needs.
function Resolve-ProductRuntimeRoot {
    param(
        [string]$ProductHomeOverride = $env:PE_TOOLS_PRODUCT_HOME,
        [string]$LocalAppData = $env:LOCALAPPDATA
    )
    if (-not [string]::IsNullOrWhiteSpace($ProductHomeOverride)) {
        return Join-Path ([IO.Path]::GetFullPath($ProductHomeOverride.Trim())) '.local-state'
    }
    if ([string]::IsNullOrWhiteSpace($LocalAppData)) {
        $LocalAppData = [Environment]::GetFolderPath('LocalApplicationData')
    }
    return Join-Path $LocalAppData 'Positive Energy/Pe.Tools'
}
