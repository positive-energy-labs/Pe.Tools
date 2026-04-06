param(
    [int]$TimeoutSeconds = 60,
    [int]$RevitYear = 2025,
    [int]$EstablishedProcessThresholdSeconds = 20,
    [string]$LogFile = "",
    [string]$ScriptDirectory = "",
    [switch]$DisableLogFile
)

if ($env:PE_REVITTEST_DISABLE_AUTO_APPROVE -eq "true")
{
    exit 0
}

# This watcher is only for newly-launched or restarted Revit sessions that may
# show unsigned add-in approval dialogs. Established matching-year Revit
# sessions are skipped on purpose so the `.Tests` build lane does not interfere
# with an already-running debug loop.
$script:LogFileEnabled = -not $DisableLogFile
$script:LogFilePath = $null
$script:PollingIntervalMs = 200

if ($script:LogFileEnabled)
{
    if ([string]::IsNullOrEmpty($LogFile))
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
                $script:LogFilePath = "$env:TEMP\Pe.Tools.RevitTest_AutoApprove.log"
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
        $script:LogFilePath = "$env:TEMP\Pe.Tools.RevitTest_AutoApprove.log"
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
        }

        if ($script:LogFileEnabled -and $null -ne $script:LogFilePath)
        {
            try
            {
                Add-Content -Path $script:LogFilePath -Value $logMessage -Encoding UTF8 -ErrorAction Stop
            }
            catch
            {
            }
        }
    }
    catch
    {
    }
}

function Test-EstablishedSameYearRevitAlreadyRunning
{
    param(
        [int]$TargetYear,
        [int]$ThresholdSeconds
    )

    $matchingProcesses = Get-Process -Name "Revit" -ErrorAction SilentlyContinue |
        Where-Object { $_.MainWindowTitle -match [regex]::Escape([string]$TargetYear) }

    foreach ($process in $matchingProcesses)
    {
        try
        {
            $ageSeconds = ((Get-Date) - $process.StartTime).TotalSeconds
            if ($ageSeconds -ge $ThresholdSeconds)
            {
                Write-Log "Detected established Revit $TargetYear process (PID: $($process.Id), AgeSeconds: $([math]::Round($ageSeconds, 1))). Skipping auto-approval watcher."
                return $true
            }
        }
        catch
        {
            Write-Log "WARNING: Could not inspect Revit process $($process.Id): $($_.Exception.Message)"
        }
    }

    return $false
}

try
{
    Write-Log "Auto-approval script started (Timeout: $TimeoutSeconds seconds)"

    if (Test-EstablishedSameYearRevitAlreadyRunning -TargetYear $RevitYear -ThresholdSeconds $EstablishedProcessThresholdSeconds)
    {
        exit 0
    }

    Add-Type -AssemblyName UIAutomationClient
    Add-Type -AssemblyName UIAutomationTypes

    $revitFound = $false
    $waitStart = Get-Date
    while (-not $revitFound -and ((Get-Date) - $waitStart).TotalSeconds -lt 30)
    {
        $revitProcesses = Get-Process -Name "Revit" -ErrorAction SilentlyContinue
        if ($null -ne $revitProcesses -and $revitProcesses.Count -gt 0)
        {
            $revitFound = $true
            Write-Log "Revit process found (PID: $($revitProcesses[0].Id))"
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

    function Click-AlwaysLoadButton
    {
        param([System.Windows.Automation.AutomationElement]$Dialog)

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

            Add-Type -TypeDefinition @"
                using System;
                using System.Runtime.InteropServices;
                public class PostMessageHelper {
                    [DllImport("user32.dll")]
                    public static extern bool PostMessage(IntPtr hWnd, uint Msg, IntPtr wParam, IntPtr lParam);
                    public const uint BM_CLICK = 0x00F5;
                }
"@
            if ([PostMessageHelper]::PostMessage([IntPtr]$buttonHandle, [PostMessageHelper]::BM_CLICK, [IntPtr]::Zero, [IntPtr]::Zero))
            {
                Start-Sleep -Milliseconds 200
                return $true
            }
        }
        catch
        {
            Write-Log "ERROR: Failed to click button: $($_.Exception.Message)"
        }

        return $false
    }

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
                                Write-Log "SUCCESS: Clicked 'Always Load' on dialog #$dialogsClicked (closed after $([math]::Round($elapsed, 2))s)"
                                [void]$clickedHandles.Add($handle)
                            }
                        }
                    }
                }
            }

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
            Write-Log "ERROR during polling: $($_.Exception.Message)"
        }

        Start-Sleep -Milliseconds $script:PollingIntervalMs
    }

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
        Write-Log "ERROR: $($remainingDialogs.Count) security dialog(s) still exist!"
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
}
catch
{
    $errorMsg = "FATAL ERROR: $($_.Exception.Message)"
    Write-Log $errorMsg
    exit 1
}
