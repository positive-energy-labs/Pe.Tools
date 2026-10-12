function Assert-GateInstalledClosure([string]$Release = 'candidate') {
    $zip=@($config.files | Where-Object role -eq ($Release+'Zip'))[0]
    $spec=@{candidateVersion=$config.($Release+'Version');files=$config.files;expectedSdkVersion=$config.expectedSdkVersion}
    Add-Type -AssemblyName System.IO.Compression.FileSystem
    $archive=[System.IO.Compression.ZipFile]::OpenRead((Join-Path $inputRoot $zip.name)); $expected=@()
    try {
        foreach ($entry in $archive.Entries) {
            $archiveManifestEntry=$archive.GetEntry('product.payloads.json')
            if (!$archiveManifest) {$reader=New-Object IO.StreamReader($archiveManifestEntry.Open());try {$archiveManifest=$reader.ReadToEnd() | ConvertFrom-Json}finally{$reader.Dispose()};Check 'Archive manifest version' ($archiveManifest.version -eq $spec.candidateVersion) $archiveManifest.version}
            $mapped=$null
            foreach ($payload in @($archiveManifest.payloads | Where-Object {$_.type -eq 'VersionedApp' -and $_.name -in 'host','pea'})) {
                $prefix=$payload.source.TrimEnd('/')+'/'
                if ($entry.FullName.StartsWith($prefix,[StringComparison]::Ordinal)) {$mapped='bin/'+$payload.name+'/'+$entry.FullName.Substring($prefix.Length);break}
            }
            if (!$mapped -or $entry.FullName.EndsWith('/') -or $entry.FullName.EndsWith('.pdb',[StringComparison]::OrdinalIgnoreCase)) {continue}
            if ($mapped.Split('/') -contains '..') { throw 'Archive payload escaped installed root' }
            $path=$mapped; $stream=$entry.Open(); $sha=[Security.Cryptography.SHA256]::Create()
            try {$hash=[BitConverter]::ToString($sha.ComputeHash($stream)).Replace('-','')} finally {$stream.Dispose();$sha.Dispose()}
            $actual=(Get-FileHash -LiteralPath (Join-Path $root $path)).Hash
            $expected+=@{path=$path;sha256=$hash;installedSha256=$actual}; Check ('Final shippable payload '+$path) ($actual -eq $hash) $hash
        }
    } finally {$archive.Dispose()}
    Check 'Archive covers host and Pea payloads' (@($expected | Where-Object path -eq 'bin/host/Pe.Host.exe').Count -eq 1 -and @($expected | Where-Object path -eq 'bin/pea/pea.exe').Count -eq 1) $expected.Count
    $expected | ConvertTo-Json -Depth 4 | Set-Content "$run\$Release-payload-hashes.json"
    if ($Release -eq 'previous') {return}
    $sdkDll=Join-Path $root 'shims\Pe.Revit.Cli.dll';$sdkVersion=[Diagnostics.FileVersionInfo]::GetVersionInfo($sdkDll).ProductVersion
    Check 'Expected adopted SDK version' ($spec.expectedSdkVersion -match '^0\.1\.0-beta\.[0-9]+$' -and ($sdkVersion -eq $spec.expectedSdkVersion -or $sdkVersion.StartsWith($spec.expectedSdkVersion+'+'))) $sdkVersion
    @{version=$sdkVersion;sha256=(Get-FileHash $sdkDll).Hash} | ConvertTo-Json | Set-Content "$run\installed-sdk-identity.json"
    $sdkPackage=@($spec.files | Where-Object role -eq 'sdkPackage')[0]
    CompareSdkClosure (Join-Path $inputRoot $sdkPackage.name) (Join-Path $root 'shims') $spec.expectedSdkVersion "$run\original-sdk-closure-comparison.json"
}
