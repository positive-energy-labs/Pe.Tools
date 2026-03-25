param(
    [string]$ScriptDirectory
)

$prepareScript = Join-Path $ScriptDirectory "PrepareRiderHotReload.ps1"

if (Test-Path $prepareScript)
{
    Write-Host "Launching Rider hot reload prep in background..."

    try
    {
        $psi = New-Object System.Diagnostics.ProcessStartInfo
        $psi.FileName = "powershell.exe"
        $psi.Arguments = "-ExecutionPolicy Bypass -WindowStyle Minimized -NoProfile -File `"$prepareScript`""
        $psi.WindowStyle = [System.Diagnostics.ProcessWindowStyle]::Minimized
        $psi.UseShellExecute = $true
        $psi.CreateNoWindow = $false

        $process = [System.Diagnostics.Process]::Start($psi)

        if ($null -ne $process)
        {
            Write-Host "Rider hot reload prep started (PID: $($process.Id))"
        }
        else
        {
            Write-Host "ERROR: Failed to start Rider hot reload prep"
        }
    }
    catch
    {
        Write-Host "ERROR launching Rider hot reload prep: $($_.Exception.Message)"
    }
}
else
{
    Write-Host "WARNING: PrepareRiderHotReload.ps1 not found at: $prepareScript"
}
