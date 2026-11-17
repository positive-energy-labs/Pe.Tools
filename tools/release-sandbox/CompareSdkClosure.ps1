function CompareSdkClosure([string]$Package,[string]$ShimRoot,[string]$ExpectedVersion,[string]$Output) {
    $ErrorActionPreference='Stop'
    Add-Type -AssemblyName System.IO.Compression.FileSystem
    $archive=[IO.Compression.ZipFile]::OpenRead($Package);$rows=@()
    try {
        $nuspec=$archive.GetEntry('Pe.Revit.Cli.nuspec');if (!$nuspec) {throw 'Original CLI package metadata missing'}
        $reader=[IO.StreamReader]::new($nuspec.Open());try {$metadata=[xml]$reader.ReadToEnd()} finally {$reader.Dispose()}
        $version=$metadata.SelectSingleNode('//*[local-name()="metadata"]/*[local-name()="version"]').InnerText
        if ($version -ne $ExpectedVersion) {throw 'Original CLI package version mismatch'}
        # ProductManifest.InstalledCliImage deploys this exact RID publish flat under shims; the portable tool root is not its byte authority.
        $prefix='tools/net8.0/any/installed/win-x64/'
        if (!$archive.GetEntry($prefix+'Pe.Revit.Cli.dll')) {throw 'Original package has no installed win-x64 CLI image'}
        foreach ($entry in $archive.Entries) {
            if (!$entry.FullName.StartsWith($prefix,[StringComparison]::Ordinal) -or $entry.FullName.EndsWith('/') -or $entry.FullName.EndsWith('.pdb',[StringComparison]::OrdinalIgnoreCase) -or $entry.FullName -ceq ($prefix+'DotnetToolSettings.xml')) {continue}
            $relative=$entry.FullName.Substring($prefix.Length)
            if ($relative -ceq 'Pe.Revit.Cli.exe') {$relative='pe-revit.exe'}
            if ($relative.Split('/') -contains '..') {throw 'SDK archive path escape refused'}
            $stream=$entry.Open();$sha=[Security.Cryptography.SHA256]::Create()
            try {$hash=[BitConverter]::ToString($sha.ComputeHash($stream)).Replace('-','')} finally {$stream.Dispose();$sha.Dispose()}
            $installed=(Get-FileHash -LiteralPath (Join-Path $ShimRoot $relative) -Algorithm SHA256).Hash
            $rows+=@{path=$relative;packagePath=$entry.FullName;originalPackageSha256=$hash;installedSha256=$installed}
            if ($installed -ne $hash) {throw ('Installed SDK image closure mismatch: '+$relative)}
        }
        foreach ($required in @('pe-revit.exe','Pe.Revit.Cli.dll','Pe.Revit.Cli.deps.json','Pe.Revit.Cli.runtimeconfig.json','loader/net48/Pe.Revit.Loader.dll','loader/net8.0-windows/Pe.Revit.Loader.dll','bridge/net48/Pe.Revit.Bridge.dll','bridge/net8.0-windows/Pe.Revit.Bridge.dll','bootstrap/net48/Pe.Revit.Loader.Bootstrap.dll','bootstrap/net8.0-windows/Pe.Revit.Loader.Bootstrap.dll')) {
            if (@($rows | Where-Object path -eq $required).Count -ne 1) {throw ('Original SDK required runtime file missing: '+$required)}
        }
    } finally {$archive.Dispose();$rows | ConvertTo-Json -Depth 5 | Set-Content $Output}
}
