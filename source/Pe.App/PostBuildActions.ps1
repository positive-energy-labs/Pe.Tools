param(
    [string]$ScriptDirectory
)

# This wrapper script launches the AutoApproveAddin.ps1 script in a separate process
# to prevent blocking the build process

$AutoApproveScript = Join-Path $ScriptDirectory "AutoApproveAddin.ps1"

if (Test-Path $AutoApproveScript)
{
    Write-Host "Launching auto-approval script in background..."
    $LogFile = Join-Path $ScriptDirectory "AutoApproveAddin.log"

    try
    {
        # Launch in a separate process with its own window
        # This prevents the build from hanging
        $psi = New-Object System.Diagnostics.ProcessStartInfo
        $psi.FileName = "powershell.exe"
        $psi.Arguments = "-ExecutionPolicy Bypass -WindowStyle Minimized -NoProfile -File `"$AutoApproveScript`" -TimeoutSeconds 60 -LogFile `"$LogFile`" -ScriptDirectory `"$ScriptDirectory`""
        $psi.WindowStyle = [System.Diagnostics.ProcessWindowStyle]::Minimized
        $psi.UseShellExecute = $true
        $psi.CreateNoWindow = $false

        $process = [System.Diagnostics.Process]::Start($psi)

        if ($null -ne $process)
        {
            Write-Host "Auto-approval script started (PID: $( $process.Id ))"
        }
        else
        {
            Write-Host "ERROR: Failed to start auto-approval script"
        }
    }
    catch
    {
        Write-Host "ERROR launching script: $( $_.Exception.Message )"
    }
}
else
{
    Write-Host "WARNING: Auto-approval script not found at: $AutoApproveScript"
}
