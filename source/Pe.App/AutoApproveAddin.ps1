param(
    [int]$TimeoutSeconds = 60,
    [string]$LogFile = "",
    [string]$ScriptDirectory = "",
    [switch]$DisableLogFile
)

# Allow disabling via environment variable
if ($env:PE_APP_DISABLE_AUTO_APPROVE -eq "true")
{
    exit 0
}

# Initialize logging
$script:LogFileEnabled = -not $DisableLogFile
$script:LogFilePath = $null

# Configuration
$script:PollingIntervalMs = 200

if ($script:LogFileEnabled)
{
    if ( [string]::IsNullOrEmpty($LogFile))
    {
        if (-not [string]::IsNullOrEmpty($ScriptDirectory) -and (Test-Path $ScriptDirectory))
        {
            $script:LogFilePath = Join-Path $ScriptDirectory "AutoApproveAddin.log"
        }
        else
        {
            $scriptPath = $MyInvocation.MyCommand.Path
            if (-not [string]::IsNullOrEmpty($scriptPath))
            {
                $scriptDir = Split-Path -Parent $scriptPath
                $script:LogFilePath = Join-Path $scriptDir "AutoApproveAddin.log"
            }
            else
            {
                $script:LogFilePath = "$env:TEMP\Pe.App_AutoApprove.log"
            }
        }
    }
    else
    {
        $script:LogFilePath = $LogFile
    }

    try
    {
        $logDir = Split-Path -Parent $script:LogFilePath
        if (-not (Test-Path $logDir))
        {
            New-Item -ItemType Directory -Path $logDir -Force | Out-Null
        }
    }
    catch
    {
        $script:LogFilePath = "$env:TEMP\Pe.App_AutoApprove.log"
    }
}

function Write-Log
{
    param([string]$Message)

    try
    {
        $timestamp = Get-Date -Format "yyyy-MM-dd HH:mm:ss"
        $logMessage = "[$timestamp] $Message"

        try
        {
            Write-Host $logMessage -ErrorAction SilentlyContinue
        }
        catch
        {
            # Silently fail if Write-Host fails
        }

        if ($script:LogFileEnabled -and $null -ne $script:LogFilePath)
        {
            try
            {
                Add-Content -Path $script:LogFilePath -Value $logMessage -Encoding UTF8 -ErrorAction Stop
            }
            catch
            {
                # Silently fail if we can't write to log file
            }
        }
    }
    catch
    {
        # Silently fail if logging completely fails - don't crash the program
    }
}

try
{
    Write-Log "Auto-approval script started (Timeout: $TimeoutSeconds seconds)"

    # Load UI Automation assemblies
    Add-Type -AssemblyName UIAutomationClient
    Add-Type -AssemblyName UIAutomationTypes

    # Wait for Revit process to start
    $revitFound = $false
    $waitStart = Get-Date
    while (-not $revitFound -and ((Get-Date) - $waitStart).TotalSeconds -lt 30)
    {
        $revitProcesses = Get-Process -Name "Revit" -ErrorAction SilentlyContinue
        if ($null -ne $revitProcesses -and $revitProcesses.Count -gt 0)
        {
            $revitFound = $true
            Write-Log "Revit process found (PID: $( $revitProcesses[0].Id ))"
        }
        else
        {
            Start-Sleep -Seconds 1
        }
    }

    if (-not $revitFound)
    {
        Write-Log "WARNING: Revit process not found, but continuing anyway..."
    }

    # Function to click the "Always Load" button
    function Click-AlwaysLoadButton
    {
        param([System.Windows.Automation.AutomationElement]$Dialog)

        # Find button by AutomationId (works even if it's a Pane control type)
        $button = $Dialog.FindFirst(
                [System.Windows.Automation.TreeScope]::Descendants,
                (New-Object System.Windows.Automation.PropertyCondition(
                [System.Windows.Automation.AutomationElement]::AutomationIdProperty,
                "CommandButton_1001"
                ))
        )

        if ($null -eq $button)
        {
            return $false
        }

        try
        {
            $buttonHandle = $button.Current.NativeWindowHandle
            if ($buttonHandle -eq 0)
            {
                return $false
            }

            # Use PostMessage with BM_CLICK (this is what worked)
            Add-Type -TypeDefinition @"
                using System;
                using System.Runtime.InteropServices;
                public class PostMessageHelper {
                    [DllImport("user32.dll")]
                    public static extern bool PostMessage(IntPtr hWnd, uint Msg, IntPtr wParam, IntPtr lParam);
                    public const uint BM_CLICK = 0x00F5;
                }
"@
            if ( [PostMessageHelper]::PostMessage([IntPtr]$buttonHandle, [PostMessageHelper]::BM_CLICK, [IntPtr]::Zero, [IntPtr]::Zero))
            {
                Start-Sleep -Milliseconds 200
                return $true
            }
        }
        catch
        {
            Write-Log "ERROR: Failed to click button: $( $_.Exception.Message )"
        }

        return $false
    }

    # Function to check if dialog still exists
    function Test-DialogExists
    {
        param([int]$DialogHandle)

        try
        {
            $condition = New-Object System.Windows.Automation.PropertyCondition(
            [System.Windows.Automation.AutomationElement]::NameProperty,
            "Security - Unsigned Add-In"
            )

            $dialogs = [System.Windows.Automation.AutomationElement]::RootElement.FindAll(
                    [System.Windows.Automation.TreeScope]::Descendants,
                    $condition
            )

            if ($null -ne $dialogs -and $dialogs.Count -gt 0)
            {
                foreach ($dialog in $dialogs)
                {
                    if ($dialog.Current.NativeWindowHandle -eq $DialogHandle)
                    {
                        return $true
                    }
                }
            }
        }
        catch
        {
            return $true
        }

        return $false
    }

    # Main polling loop
    $startTime = Get-Date
    $timeout = (Get-Date).AddSeconds($TimeoutSeconds)
    $dialogsClicked = 0
    $clickedHandles = New-Object System.Collections.Generic.HashSet[int]
    $lastDialogTime = $null

    Write-Log "Polling for security dialogs..."

    while ((Get-Date) -lt $timeout)
    {
        try
        {
            $condition = New-Object System.Windows.Automation.PropertyCondition(
            [System.Windows.Automation.AutomationElement]::NameProperty,
            "Security - Unsigned Add-In"
            )

            $dialogs = [System.Windows.Automation.AutomationElement]::RootElement.FindAll(
                    [System.Windows.Automation.TreeScope]::Descendants,
                    $condition
            )

            if ($null -ne $dialogs -and $dialogs.Count -gt 0)
            {
                foreach ($dialog in $dialogs)
                {
                    $handle = $dialog.Current.NativeWindowHandle

                    if (-not $clickedHandles.Contains($handle))
                    {
                        if (Click-AlwaysLoadButton -Dialog $dialog)
                        {
                            Start-Sleep -Seconds 1

                            if (-not (Test-DialogExists -DialogHandle $handle))
                            {
                                $dialogsClicked++
                                $lastDialogTime = Get-Date
                                $elapsed = ((Get-Date) - $startTime).TotalSeconds
                                Write-Log "SUCCESS: Clicked 'Always Load' on dialog #$dialogsClicked (closed after $([math]::Round($elapsed, 2) )s)"
                                [void]$clickedHandles.Add($handle)
                            }
                        }
                    }
                }
            }

            # If we've clicked at least one dialog and haven't seen a new one in 0.5 seconds, exit early
            if ($dialogsClicked -gt 0 -and $null -ne $lastDialogTime)
            {
                $timeSinceLastDialog = ((Get-Date) - $lastDialogTime).TotalSeconds
                if ($timeSinceLastDialog -gt 0.5)
                {
                    Write-Log "No new dialogs for 0.5 seconds, exiting early"
                    break
                }
            }
        }
        catch
        {
            Write-Log "ERROR during polling: $( $_.Exception.Message )"
        }

        Start-Sleep -Milliseconds $script:PollingIntervalMs
    }

    # Final check
    $finalCheckCondition = New-Object System.Windows.Automation.PropertyCondition(
    [System.Windows.Automation.AutomationElement]::NameProperty,
    "Security - Unsigned Add-In"
    )
    $remainingDialogs = [System.Windows.Automation.AutomationElement]::RootElement.FindAll(
            [System.Windows.Automation.TreeScope]::Descendants,
            $finalCheckCondition
    )

    if ($null -ne $remainingDialogs -and $remainingDialogs.Count -gt 0)
    {
        Write-Log "ERROR: $( $remainingDialogs.Count ) security dialog(s) still exist!"
    }
    elseif ($dialogsClicked -gt 0)
    {
        Write-Log "SUCCESS: Handled $dialogsClicked security dialog(s)"
    }
    else
    {
        Write-Log "WARNING: No security dialogs found"
    }

    Write-Log "Script finished"

    # Launch auto-open document script
    if (-not [string]::IsNullOrEmpty($ScriptDirectory))
    {
        $AutoOpenScript = Join-Path $ScriptDirectory "AutoOpenDocument.ps1"
    }
    else
    {
        $scriptPath = $MyInvocation.MyCommand.Path
        if (-not [string]::IsNullOrEmpty($scriptPath))
        {
            $scriptDir = Split-Path -Parent $scriptPath
            $AutoOpenScript = Join-Path $scriptDir "AutoOpenDocument.ps1"
        }
    }

    if (-not [string]::IsNullOrEmpty($AutoOpenScript) -and (Test-Path $AutoOpenScript))
    {
        Write-Log "Launching auto-open document script..."

        try
        {
            $openLogFile = if ($script:LogFileEnabled -and $null -ne $script:LogFilePath)
            {
                Join-Path (Split-Path -Parent $script:LogFilePath) "AutoOpenDocument.log"
            }
            else
            {
                ""
            }

            $psi = New-Object System.Diagnostics.ProcessStartInfo
            $psi.FileName = "powershell.exe"
            $psi.Arguments = "-ExecutionPolicy Bypass -NoProfile -File `"$AutoOpenScript`" -TimeoutSeconds 30 -SearchPattern `"*template*`""

            if ($script:LogFileEnabled -and -not [string]::IsNullOrEmpty($openLogFile))
            {
                $psi.Arguments += " -LogFile `"`"$openLogFile`"`""
            }
            else
            {
                $psi.Arguments += " -DisableLogFile"
            }

            if (-not [string]::IsNullOrEmpty($ScriptDirectory))
            {
                $psi.Arguments += " -ScriptDirectory `"`"$ScriptDirectory`"`""
            }

            $psi.WindowStyle = [System.Diagnostics.ProcessWindowStyle]::Minimized
            $psi.UseShellExecute = $true
            $psi.CreateNoWindow = $false

            $openProcess = [System.Diagnostics.Process]::Start($psi)

            if ($null -ne $openProcess)
            {
                Write-Log "Auto-open document script started (PID: $( $openProcess.Id ))"
            }
            else
            {
                Write-Log "WARNING: Failed to start auto-open document script"
            }
        }
        catch
        {
            Write-Log "WARNING: Error launching auto-open script: $( $_.Exception.Message )"
        }
    }
    else
    {
        Write-Log "WARNING: Auto-open document script not found at: $AutoOpenScript"
    }
}
catch
{
    $errorMsg = "FATAL ERROR: $( $_.Exception.Message )"
    Write-Log $errorMsg
    exit 1
}
