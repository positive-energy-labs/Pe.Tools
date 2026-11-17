# The historical Sandbox prerequisite is fixed, not the moving aka.ms "latest" download.
$GateVcRuntimeSha256 = '843068991daaa1f73ad9f6239bce4d0f6a07a51f18c37ea2a867e9beca71295c'
function Assert-GateVcRuntime([string]$Path) {
    if (!(Test-Path -LiteralPath $Path -PathType Leaf) -or (Get-FileHash -LiteralPath $Path -Algorithm SHA256).Hash -ne $GateVcRuntimeSha256) {
        throw "Pinned Microsoft VC++ x64 14.51.36247 installer missing or changed: $Path"
    }
}
function Get-GateVcRuntime {
    $path = Join-Path $env:USERPROFILE 'WindowsSandbox\InstallerTests\Input\VcRuntime\vc_redist.x64.exe'
    Assert-GateVcRuntime $path
    return @{ role = 'vcRuntime'; name = 'vc_redist.x64.exe'; path = $path; sha256 = $GateVcRuntimeSha256 }
}
function Install-GateVcRuntime([string]$InputDirectory, [string]$Output) {
    $path = Join-Path $InputDirectory 'vc_redist.x64.exe'
    Assert-GateVcRuntime $path
    Install $path ('/install /quiet /norestart /log "' + $Output + '\vcRuntime.log"') 'Mandatory VC++ x64 runtime'
}
