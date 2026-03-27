param(
    [string]$ScriptDirectory,
    [int]$RevitYear = 2025
)

$prepareScript = Join-Path $ScriptDirectory "PrepareRiderHotReload.ps1"
$autoApproveScript = Join-Path $ScriptDirectory "AutoApproveAddin.ps1"

# This script is a convenience wrapper for the `.Tests` build lane.
# It prepares Rider hot reload for changed runtime files and watches for
# unsigned add-in approval dialogs, but it does not itself prove that Revit is
# running the freshly-edited runtime code.
if (Test-Path $prepareScript)
{
    Write-Host "Running Rider hot reload prep..."

    try
    {
        & powershell.exe -ExecutionPolicy Bypass -WindowStyle Minimized -NoProfile -File $prepareScript
        Write-Host "Rider hot reload prep finished"
    }
    catch
    {
        Write-Host "ERROR running Rider hot reload prep: $($_.Exception.Message)"
    }
}
else
{
    Write-Host "WARNING: PrepareRiderHotReload.ps1 not found at: $prepareScript"
}

if (Test-Path $autoApproveScript)
{
    Write-Host "Running add-in auto-approval watcher..."

    try
    {
        & powershell.exe -ExecutionPolicy Bypass -WindowStyle Minimized -NoProfile -File $autoApproveScript -TimeoutSeconds 60 -RevitYear $RevitYear -ScriptDirectory $ScriptDirectory
        Write-Host "Add-in auto-approval watcher finished"
    }
    catch
    {
        Write-Host "ERROR running add-in auto-approval watcher: $($_.Exception.Message)"
    }
}
else
{
    Write-Host "WARNING: AutoApproveAddin.ps1 not found at: $autoApproveScript"
}
