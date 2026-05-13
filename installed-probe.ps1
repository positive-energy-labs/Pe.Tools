$ErrorActionPreference = "Stop"

$productNamePatterns = @("*Pe.Tools*", "*Pe Tools*")
$productCodePatterns = @("*DA2F1078*")

function Test-MatchesAnyPattern {
    param(
        [AllowNull()]
        [string] $Value,

        [string[]] $Patterns
    )

    if ([string]::IsNullOrWhiteSpace($Value)) {
        return $false
    }

    foreach ($pattern in $Patterns) {
        if ($Value -like $pattern) {
            return $true
        }
    }

    return $false
}

function Convert-MsiPackedGuid {
    param([string] $PackedGuid)

    if ($PackedGuid.Length -ne 32) {
        return $PackedGuid
    }

    $chars = $PackedGuid.ToCharArray()
    [Array]::Reverse($chars, 0, 8)
    [Array]::Reverse($chars, 8, 4)
    [Array]::Reverse($chars, 12, 4)

    foreach ($index in 16, 18, 20, 22, 24, 26, 28, 30) {
        [Array]::Reverse($chars, $index, 2)
    }

    $value = -join $chars
    return "{0}-{1}-{2}-{3}-{4}" -f `
        $value.Substring(0, 8),
        $value.Substring(8, 4),
        $value.Substring(12, 4),
        $value.Substring(16, 4),
        $value.Substring(20, 12)
}

function Convert-MsiVersion {
    param($Version)

    if ($null -eq $Version -or $Version -eq "") {
        return $Version
    }

    try {
        $number = [int] $Version
        $major = ($number -shr 24) -band 0xFF
        $minor = ($number -shr 16) -band 0xFF
        $build = $number -band 0xFFFF
        return "$major.$minor.$build"
    } catch {
        return $Version
    }
}

function Get-UninstallEntries {
    $roots = @(
        "HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\*",
        "HKLM:\Software\Microsoft\Windows\CurrentVersion\Uninstall\*",
        "HKLM:\Software\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall\*"
    )

    Get-ItemProperty $roots -ErrorAction SilentlyContinue |
        Where-Object {
            (Test-MatchesAnyPattern $_.DisplayName $productNamePatterns) -or
            (Test-MatchesAnyPattern $_.PSChildName $productCodePatterns)
        } |
        ForEach-Object {
            [pscustomobject]@{
                Source = "Uninstall"
                Name = $_.DisplayName
                Version = $_.DisplayVersion
                ProductCode = $_.PSChildName
                InstallLocation = $_.InstallLocation
                LocalPackage = $null
                UninstallString = $_.UninstallString
                ModifyPath = $_.ModifyPath
                WindowsInstaller = $_.WindowsInstaller
            }
        }
}

function Get-PerUserMsiEntries {
    $root = "HKCU:\Software\Microsoft\Installer\Products"
    if (-not (Test-Path $root)) {
        return
    }

    Get-ChildItem $root -ErrorAction SilentlyContinue |
        ForEach-Object {
            $props = Get-ItemProperty $_.PSPath -ErrorAction SilentlyContinue
            if ($null -eq $props) {
                return
            }

            $productCode = Convert-MsiPackedGuid $_.PSChildName
            if (
                (Test-MatchesAnyPattern $props.ProductName $productNamePatterns) -or
                (Test-MatchesAnyPattern $productCode $productCodePatterns)
            ) {
                [pscustomobject]@{
                Source = "HKCU MSI"
                Name = $props.ProductName
                Version = Convert-MsiVersion $props.Version
                    ProductCode = $productCode
                    InstallLocation = $null
                    LocalPackage = $props.LocalPackage
                    UninstallString = $null
                    ModifyPath = $null
                    WindowsInstaller = $true
                }
            }
        }
}

function Get-InstallRoots {
    $roots = @(
        "$env:LOCALAPPDATA\Positive Energy\Pe.Tools",
        "$env:APPDATA\Autodesk\Revit\Addins\2023\Pe.App",
        "$env:APPDATA\Autodesk\Revit\Addins\2024\Pe.App",
        "$env:APPDATA\Autodesk\Revit\Addins\2025\Pe.App",
        "$env:APPDATA\Autodesk\Revit\Addins\2026\Pe.App"
    )

    foreach ($root in $roots) {
        [pscustomobject]@{
            Path = $root
            Exists = Test-Path -LiteralPath $root
        }
    }
}

"=== Registered Products ==="
$entries = @(Get-UninstallEntries) + @(Get-PerUserMsiEntries)
if ($entries.Count -eq 0) {
    "No matching Pe.Tools registrations found."
} else {
    $entries |
        Sort-Object Source, Name, ProductCode -Unique |
        Format-Table Source, Name, Version, ProductCode, LocalPackage -AutoSize
}

""
"=== Install Roots ==="
Get-InstallRoots | Format-Table Path, Exists -AutoSize
