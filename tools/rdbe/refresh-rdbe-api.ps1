[CmdletBinding()]
param(
    [string]$LockFile = "",
    [string]$Ref
)

$ErrorActionPreference = "Stop"

if ([string]::IsNullOrWhiteSpace($LockFile)) {
    $LockFile = Join-Path $PSScriptRoot "rdbe-api.lock.json"
}

function Get-RepositoryRoot {
    param([string]$ScriptRoot)

    return (Resolve-Path (Join-Path $ScriptRoot "..\..")).Path
}

function Get-PackageVersionFromName {
    param(
        [string]$PackageName,
        [string]$PackageId
    )

    $escapedId = [regex]::Escape($PackageId)
    $match = [regex]::Match($PackageName, "^$escapedId\.(?<version>.+)\.nupkg$")
    if (-not $match.Success) {
        throw "Could not determine package version from '$PackageName'."
    }

    return $match.Groups["version"].Value
}

function Set-PackageReferenceVersion {
    param(
        [string]$ProjectPath,
        [string]$PackageId,
        [string]$Version
    )

    [xml]$projectXml = Get-Content -Path $ProjectPath
    $packageReference = $projectXml.SelectSingleNode("//PackageReference[@Include='$PackageId']")
    if ($null -eq $packageReference) {
        throw "PackageReference '$PackageId' was not found in '$ProjectPath'."
    }

    if ($packageReference.Version) {
        $packageReference.Version = $Version
    } else {
        $versionAttribute = $projectXml.CreateAttribute("Version")
        $versionAttribute.Value = $Version
        [void]$packageReference.Attributes.Append($versionAttribute)
    }

    $settings = New-Object System.Xml.XmlWriterSettings
    $settings.Indent = $true
    $settings.IndentChars = "    "
    $settings.OmitXmlDeclaration = $true
    $settings.NewLineChars = "`r`n"
    $settings.NewLineHandling = [System.Xml.NewLineHandling]::Replace

    $writer = [System.Xml.XmlWriter]::Create($ProjectPath, $settings)
    try {
        $projectXml.Save($writer)
    } finally {
        $writer.Dispose()
    }
}

$repoRoot = Get-RepositoryRoot -ScriptRoot $PSScriptRoot
$feedDirectory = Join-Path $repoRoot ".nuget\local"
$cloneDirectory = Join-Path ([System.IO.Path]::GetTempPath()) ("pe-tools-rdbe-clone-" + [Guid]::NewGuid().ToString("N"))

try {
    $lock = Get-Content -Path $LockFile -Raw | ConvertFrom-Json
    if (-not [string]::IsNullOrWhiteSpace($Ref)) {
        $lock.ref = $Ref
    }

    New-Item -ItemType Directory -Path $feedDirectory -Force | Out-Null

    git clone --quiet $lock.repositoryUrl $cloneDirectory | Out-Null
    git -C $cloneDirectory checkout --quiet $lock.ref | Out-Null

    $resolvedCommit = (git -C $cloneDirectory rev-parse HEAD).Trim()
    $apiProjectPath = Join-Path $cloneDirectory $lock.projectPath
    if (-not (Test-Path $apiProjectPath)) {
        throw "Could not find API project at '$apiProjectPath'."
    }

    dotnet build $apiProjectPath -c Release /p:ContinuousIntegrationBuild=true | Out-Null

    $packageOutputDirectory = Join-Path $cloneDirectory "nugets"

    $package = Get-ChildItem -Path $packageOutputDirectory -Filter "$($lock.packageId).*.nupkg" |
        Where-Object { $_.Name -notlike "*.symbols.nupkg" } |
        Sort-Object LastWriteTimeUtc -Descending |
        Select-Object -First 1

    if ($null -eq $package) {
        throw "No package named '$($lock.packageId)' was produced."
    }

    $packageVersion = Get-PackageVersionFromName -PackageName $package.Name -PackageId $lock.packageId

    Get-ChildItem -Path $feedDirectory -Filter "$($lock.packageId).*.nupkg" -ErrorAction SilentlyContinue |
        Remove-Item -Force

    Copy-Item -Path $package.FullName -Destination (Join-Path $feedDirectory $package.Name) -Force

    $consumerProjectPath = Join-Path $repoRoot $lock.consumerProjectPath
    Set-PackageReferenceVersion -ProjectPath $consumerProjectPath -PackageId $lock.packageId -Version $packageVersion

    $lock.packageVersion = $packageVersion
    $lock.resolvedCommit = $resolvedCommit
    $lock | ConvertTo-Json | Set-Content -Path $LockFile

    Write-Host "Vendored $($lock.packageId) $packageVersion from $resolvedCommit"
    Write-Host "Package feed: $feedDirectory"
    Write-Host "Updated consumer project: $consumerProjectPath"
} finally {
    if (Test-Path $cloneDirectory) {
        Remove-Item -Path $cloneDirectory -Recurse -Force
    }
}
