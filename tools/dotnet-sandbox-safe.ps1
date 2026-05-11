<#
.SYNOPSIS
Runs dotnet with a repaired Windows process environment for sandboxed agent shells.

.DESCRIPTION
Some sandbox launchers can omit core Windows environment variables such as
ProgramFiles(x86), APPDATA, and LOCALAPPDATA. NuGet/MSBuild may then fail during
restore with "Value cannot be null. (Parameter 'path1')", and long-lived dotnet
build servers can keep the bad environment after the original shell exits.

This script is an escape hatch, not the normal build surface. Ordinary
`dotnet build` should stay the default. Use this when the repo guard reports an
unsafe Windows dotnet environment or when a sandboxed shell has already poisoned
build servers.
#>
$DotNetArguments = [string[]] $args

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

function Set-EnvIfMissing {
    param(
        [Parameter(Mandatory = $true)] [string] $Name,
        [Parameter(Mandatory = $true)] [string] $Value
    )

    if ([string]::IsNullOrWhiteSpace([Environment]::GetEnvironmentVariable($Name, 'Process'))) {
        [Environment]::SetEnvironmentVariable($Name, $Value, 'Process')
    }
}

$isWindowsProcess = [System.Runtime.InteropServices.RuntimeInformation]::IsOSPlatform([System.Runtime.InteropServices.OSPlatform]::Windows)
if (-not $isWindowsProcess) {
    & dotnet @DotNetArguments
    exit $LASTEXITCODE
}

$userProfile = [Environment]::GetEnvironmentVariable('USERPROFILE', 'Process')
if ([string]::IsNullOrWhiteSpace($userProfile)) {
    $userProfile = [Environment]::GetFolderPath([Environment+SpecialFolder]::UserProfile)
}

# These are the conventional Windows locations NuGet/MSBuild expects. Repairing
# only the child process keeps the fix local to this command and avoids mutating
# machine/user environment state from an agent.
Set-EnvIfMissing 'ProgramFiles' 'C:\Program Files'
Set-EnvIfMissing 'ProgramFiles(x86)' 'C:\Program Files (x86)'
Set-EnvIfMissing 'ProgramW6432' 'C:\Program Files'
Set-EnvIfMissing 'ProgramData' 'C:\ProgramData'
Set-EnvIfMissing 'ALLUSERSPROFILE' 'C:\ProgramData'
Set-EnvIfMissing 'USERPROFILE' $userProfile
Set-EnvIfMissing 'HOMEDRIVE' 'C:'
Set-EnvIfMissing 'HOMEPATH' ($userProfile -replace '^[A-Za-z]:', '')
Set-EnvIfMissing 'APPDATA' (Join-Path $userProfile 'AppData\Roaming')
Set-EnvIfMissing 'LOCALAPPDATA' (Join-Path $userProfile 'AppData\Local')
Set-EnvIfMissing 'TEMP' (Join-Path $userProfile 'AppData\Local\Temp')
Set-EnvIfMissing 'TMP' (Join-Path $userProfile 'AppData\Local\Temp')
Set-EnvIfMissing 'SystemRoot' 'C:\Windows'
Set-EnvIfMissing 'windir' 'C:\Windows'
Set-EnvIfMissing 'ComSpec' 'C:\Windows\System32\cmd.exe'
Set-EnvIfMissing 'PROCESSOR_ARCHITECTURE' 'AMD64'

# Kill any poisoned long-lived servers before starting fresh with this repaired
# process environment. Then pass --disable-build-servers when the dotnet command
# supports it so this one-off recovery run does not create another bad server.
& dotnet build-server shutdown | Out-Host
if ($LASTEXITCODE -ne 0) {
    exit $LASTEXITCODE
}

$command = if ($DotNetArguments.Count -gt 0) { $DotNetArguments[0] } else { $null }
$supportsDisableBuildServers = $command -in @('build', 'clean', 'msbuild', 'pack', 'publish', 'restore', 'test')
$hasDisableBuildServers = $DotNetArguments -contains '--disable-build-servers'

if ($supportsDisableBuildServers -and -not $hasDisableBuildServers) {
    & dotnet @DotNetArguments --disable-build-servers
} else {
    & dotnet @DotNetArguments
}

exit $LASTEXITCODE
