function CompareSdkClosure([string]$Package,[string]$ShimRoot,[string]$ExpectedVersion,[string]$Output) {
    $ErrorActionPreference='Stop'
    Add-Type -AssemblyName System.IO.Compression.FileSystem
    $archive=[IO.Compression.ZipFile]::OpenRead($Package);$rows=@()
    try {
        $nuspec=$archive.GetEntry('Pe.Revit.Cli.nuspec');if (!$nuspec) {throw 'Original CLI package metadata missing'}
        $reader=New-Object IO.StreamReader($nuspec.Open());try {$metadata=[xml]$reader.ReadToEnd()} finally {$reader.Dispose()}
        $version=$metadata.SelectSingleNode('//*[local-name()="metadata"]/*[local-name()="version"]').InnerText
        if ($version -ne $ExpectedVersion) {throw 'Original CLI package version mismatch'}
        foreach ($entry in $archive.Entries) {
            $prefix='tools/net8.0/any/'
            # NuGet tool metadata is absent from SDK installs; the required-runtime list below remains the runtime contract.
            if (!$entry.FullName.StartsWith($prefix,[StringComparison]::Ordinal) -or $entry.FullName.EndsWith('/') -or $entry.FullName.EndsWith('.pdb',[StringComparison]::OrdinalIgnoreCase) -or $entry.FullName -ceq 'tools/net8.0/any/DotnetToolSettings.xml') {continue}
            $relative=$entry.FullName.Substring($prefix.Length)
            if ($relative -eq 'Pe.Revit.Cli.exe') {$relative='pe-revit.exe'}
            if ($relative.Split('/') -contains '..') {throw 'SDK archive path escape refused'}
            $stream=$entry.Open();$sha=[Security.Cryptography.SHA256]::Create()
            try {$hash=[BitConverter]::ToString($sha.ComputeHash($stream)).Replace('-','')} finally {$stream.Dispose();$sha.Dispose()}
            $installed=(Get-FileHash -LiteralPath (Join-Path $ShimRoot $relative)).Hash
            $comparison='sha256'
            # SDK installs publish win-x64 (owner and guest deps hash 43F19B92...); NuGet is portable, so only these two host-config files use form, not byte authority.
            if ($relative -cin @('Pe.Revit.Cli.deps.json','Pe.Revit.Cli.runtimeconfig.json')) {
                $reader=[IO.StreamReader]::new($entry.Open());try {$originalConfig=$reader.ReadToEnd() | ConvertFrom-Json} finally {$reader.Dispose()}
                Assert-GateSdkDeploymentForm $relative $originalConfig (Get-Content -LiteralPath (Join-Path $ShimRoot $relative) -Raw | ConvertFrom-Json)
                $comparison='deployment-form'
            } elseif ($installed -ne $hash) {throw ('Original SDK closure mismatch: '+$relative)}
            $rows+=@{path=$relative;comparison=$comparison;originalPackageSha256=$hash;installedSha256=$installed}
        }
        foreach ($required in @('pe-revit.exe','Pe.Revit.Cli.dll','Pe.Revit.Cli.deps.json','Pe.Revit.Cli.runtimeconfig.json','loader/net48/Pe.Revit.Loader.dll','loader/net8.0-windows/Pe.Revit.Loader.dll','bridge/net48/Pe.Revit.Bridge.dll','bridge/net8.0-windows/Pe.Revit.Bridge.dll','bootstrap/net48/Pe.Revit.Loader.Bootstrap.dll','bootstrap/net8.0-windows/Pe.Revit.Loader.Bootstrap.dll')) {
            if (@($rows | Where-Object path -eq $required).Count -ne 1) {throw ('Original SDK required runtime file missing: '+$required)}
        }
    } finally {$archive.Dispose();$rows | ConvertTo-Json -Depth 5 | Set-Content $Output}
}
function Assert-GateSdkDeploymentForm([string]$Name, $Original, $Installed) {
    if ($Name -ceq 'Pe.Revit.Cli.deps.json') {
        if ($Installed.runtimeTarget.name -cne '.NETCoreApp,Version=v8.0/win-x64') { throw 'Installed SDK deps must target net8 win-x64.' }
        $libraries = @($Original.libraries.PSObject.Properties.Name | Where-Object { $_ -clike 'Pe.Revit.*/*' })
        if (!$libraries.Count) { throw 'Original SDK deps declares no Pe.Revit libraries.' }
        foreach ($library in $libraries) {
            if (@($Installed.libraries.PSObject.Properties.Name) -cnotcontains $library) { throw "Installed SDK library version differs: $library" }
        }
        return
    }
    $originalOptions = $Original.runtimeOptions; $installedOptions = $Installed.runtimeOptions
    $core = @($installedOptions.includedFrameworks | Where-Object { $_.name -ceq 'Microsoft.NETCore.App' -and $_.version -match '^8\.' })
    if ([string]::IsNullOrWhiteSpace($originalOptions.tfm) -or $installedOptions.tfm -cne $originalOptions.tfm -or $core.Count -ne 1 -or $installedOptions.framework -or $installedOptions.frameworks) { throw 'Installed SDK runtimeconfig must be self-contained Microsoft.NETCore.App 8.x with the original tfm.' }
}

