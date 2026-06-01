param(
    [string]$RiderInstallRoot = "",
    [string]$Version = "0.1.0"
)

$ErrorActionPreference = "Stop"
$RepoRoot = Resolve-Path (Join-Path $PSScriptRoot "..\..")
$Classes = Join-Path $RepoRoot ".artifacts\tmp\Pe.RiderBridge.classes"
$StageRoot = Join-Path $RepoRoot ".artifacts\tmp\Pe.RiderBridge.package"
$Stage = Join-Path $StageRoot "Pe.RiderBridge"
$Packages = Join-Path $RepoRoot ".artifacts\packages\rider"
$Source = Join-Path $PSScriptRoot "src\main\java\pe\tools\riderbridge\PeRiderBridgeHttpHandler.java"
$Resources = Join-Path $PSScriptRoot "src\main\resources\META-INF"

if ([string]::IsNullOrWhiteSpace($RiderInstallRoot)) {
    $RiderInstallRoot = Get-ChildItem "C:\Program Files\JetBrains" -Directory -Filter "JetBrains Rider*" |
        Sort-Object Name -Descending |
        Select-Object -First 1 -ExpandProperty FullName
}

if ([string]::IsNullOrWhiteSpace($RiderInstallRoot) -or -not (Test-Path $RiderInstallRoot)) {
    throw "Could not resolve Rider install root. Pass -RiderInstallRoot explicitly."
}

$Javac = Join-Path $RiderInstallRoot "jbr\bin\javac.exe"
if (-not (Test-Path $Javac)) {
    throw "Could not find javac.exe under '$RiderInstallRoot'."
}

$JarCandidates = @(
    (Join-Path $RiderInstallRoot "jbr\bin\jar.exe"),
    "C:\Program Files\CSView\jre\bin\jar.exe"
)
$Jar = $JarCandidates | Where-Object { Test-Path $_ } | Select-Object -First 1
if ([string]::IsNullOrWhiteSpace($Jar)) {
    throw "Could not find jar.exe."
}

Remove-Item $Classes -Recurse -Force -ErrorAction SilentlyContinue
New-Item -ItemType Directory -Force $Classes | Out-Null
& $Javac -cp (Join-Path $RiderInstallRoot "lib\*") -d $Classes $Source
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
Copy-Item $Resources (Join-Path $Classes "META-INF") -Recurse -Force

Remove-Item $StageRoot -Recurse -Force -ErrorAction SilentlyContinue
New-Item -ItemType Directory -Force (Join-Path $Stage "lib") | Out-Null
$PluginJar = Join-Path $Stage "lib\Pe.RiderBridge.jar"
& $Jar cf $PluginJar -C $Classes .
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

New-Item -ItemType Directory -Force $Packages | Out-Null
$PluginZip = Join-Path $Packages "Pe.RiderBridge.$Version.zip"
$SingleJar = Join-Path $Packages "Pe.RiderBridge.$Version.jar"
Remove-Item $PluginZip, $SingleJar -Force -ErrorAction SilentlyContinue
Copy-Item $PluginJar $SingleJar -Force

Add-Type -AssemblyName System.IO.Compression
Add-Type -AssemblyName System.IO.Compression.FileSystem
$archive = [System.IO.Compression.ZipFile]::Open($PluginZip, [System.IO.Compression.ZipArchiveMode]::Create)
try {
    [void]$archive.CreateEntry("Pe.RiderBridge/")
    [void]$archive.CreateEntry("Pe.RiderBridge/lib/")
    $entry = $archive.CreateEntry("Pe.RiderBridge/lib/Pe.RiderBridge.jar", [System.IO.Compression.CompressionLevel]::Optimal)
    $entryStream = $entry.Open()
    try {
        $fileStream = [System.IO.File]::OpenRead($PluginJar)
        try { $fileStream.CopyTo($entryStream) } finally { $fileStream.Dispose() }
    } finally { $entryStream.Dispose() }
} finally {
    $archive.Dispose()
}

Get-Item $PluginZip, $SingleJar | Select-Object FullName, Length
