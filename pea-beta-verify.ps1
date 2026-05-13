$ErrorActionPreference = "Stop"

$requiredSettingsKeys = @(
    "ApsWebClientId1",
    "ApsWebClientSecret1",
    "Bim360AccountId",
    "ParamServiceGroupId",
    "ParamServiceCollectionId"
)

$checks = New-Object System.Collections.Generic.List[object]

function Add-Check {
    param(
        [Parameter(Mandatory = $true)]
        [string] $Name,

        [Parameter(Mandatory = $true)]
        [bool] $Passed,

        [Parameter(Mandatory = $true)]
        [string] $Detail
    )

    $checks.Add([pscustomobject]@{
        Name = $Name
        Passed = $Passed
        Detail = $Detail
    }) | Out-Null
}

function Test-NonEmptyValue {
    param(
        [Parameter(Mandatory = $false)]
        [object] $Value
    )

    if ($null -eq $Value) {
        return $false
    }

    if ($Value -is [string]) {
        return -not [string]::IsNullOrWhiteSpace($Value)
    }

    return $true
}

$userOpenAiKey = [Environment]::GetEnvironmentVariable("OPENAI_API_KEY", "User")
Add-Check `
    -Name "OPENAI_API_KEY user environment variable" `
    -Passed (Test-NonEmptyValue $userOpenAiKey) `
    -Detail $(if (Test-NonEmptyValue $userOpenAiKey) { "Configured for the current Windows user." } else { "Missing or empty. Re-run pea-beta-bootstrap.ps1." })

$settingsPath = Join-Path ([Environment]::GetFolderPath("MyDocuments")) "Pe.Tools\settings\Global\settings.json"
$settingsFileExists = Test-Path -LiteralPath $settingsPath -PathType Leaf
Add-Check `
    -Name "Global settings file" `
    -Passed $settingsFileExists `
    -Detail $(if ($settingsFileExists) { $settingsPath } else { "Missing expected file: $settingsPath" })

$settings = $null
if ($settingsFileExists) {
    try {
        $settings = Get-Content -LiteralPath $settingsPath -Raw | ConvertFrom-Json
        Add-Check -Name "Global settings JSON" -Passed $true -Detail "settings.json parsed successfully."
    }
    catch {
        Add-Check -Name "Global settings JSON" -Passed $false -Detail $_.Exception.Message
    }
}

foreach ($key in $requiredSettingsKeys) {
    $value = $null
    if ($null -ne $settings) {
        $property = $settings.PSObject.Properties[$key]
        if ($null -ne $property) {
            $value = $property.Value
        }
    }

    Add-Check `
        -Name "Setting: $key" `
        -Passed (Test-NonEmptyValue $value) `
        -Detail $(if (Test-NonEmptyValue $value) { "Present and non-empty." } else { "Missing or empty in settings.json." })
}

$failedChecks = @($checks | Where-Object { -not $_.Passed })
$success = $failedChecks.Count -eq 0

Write-Host ""
Write-Host "Pe Agent beta bootstrap verification"
Write-Host "===================================="
Write-Host ""

foreach ($check in $checks) {
    $status = if ($check.Passed) { "PASS" } else { "FAIL" }
    $color = if ($check.Passed) { "Green" } else { "Red" }
    Write-Host ("[{0}] {1}" -f $status, $check.Name) -ForegroundColor $color
    Write-Host ("      {0}" -f $check.Detail)
}

Write-Host ""

if ($success) {
    $summary = "Pe Agent beta access looks configured correctly."
    Write-Host $summary -ForegroundColor Green
}
else {
    $summary = "Pe Agent beta access is not fully configured. Failed checks: $($failedChecks.Count)."
    Write-Host $summary -ForegroundColor Red
    Write-Host "Re-run pea-beta-bootstrap.ps1, then run this verifier again."
}

try {
    Add-Type -AssemblyName System.Windows.Forms
    $icon = if ($success) {
        [System.Windows.Forms.MessageBoxIcon]::Information
    }
    else {
        [System.Windows.Forms.MessageBoxIcon]::Error
    }

    [System.Windows.Forms.MessageBox]::Show(
        $summary,
        "Pe Agent beta verification",
        [System.Windows.Forms.MessageBoxButtons]::OK,
        $icon
    ) | Out-Null
}
catch {
    Write-Host "Could not show a Windows dialog: $($_.Exception.Message)" -ForegroundColor Yellow
}

Write-Host ""
Read-Host "Press Enter to close"
