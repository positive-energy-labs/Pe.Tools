# Generator for assembly-presets.json: mines the Manual-J code fields of every distinct assembly
# used in a real .r10 and writes them as cloneable presets. See the header of assembly-presets.json
# for what the catalog is (a shim) and how the insert lane uses it.
#
# MUST run 32-bit (Jet 3.5):
#   C:\Windows\SysWOW64\WindowsPowerShell\v1.0\powershell.exe -File mine-assembly-presets.ps1 `
#       -Path <source>.r10 -Output assembly-presets.json
#
# Reads only; the source file is never written. Hand it a scratch copy anyway -- the .r10 lane's
# standing rule is that engineer files are never opened for write by anything here.
param(
    [Parameter(Mandatory)][string]$Path,
    [Parameter(Mandatory)][string]$Output,
    [string]$Note = ''
)

Add-Type -AssemblyName System.Data
$ErrorActionPreference = 'Stop'
if ([IntPtr]::Size -ne 4) { throw 'Run under 32-bit PowerShell (SysWOW64); the Jet driver is 32-bit only.' }
$ansi = [Text.Encoding]::Default

# Same material-column groups the insert lane clones (export-rhvac.ps1 $materialColumns). Geometry
# and U-value/SHGC columns are deliberately absent: those come from the takeoff, per room.
$materialColumns = [ordered]@{
    floors = @{ Prefix = 'Floor'; Columns = @('FloorDescription', 'FloorConstructionMaterial', 'FloorCategory',
            'FloorSealedCrawlSpace', 'FloorCrawlSpaceWallUValue', 'FloorRadiant', 'FloorOptions', 'FloorSTD', 'FloorWTD') }
    roofs = @{ Prefix = 'Roof'; Columns = @('RoofDescription', 'RoofConstructionMaterial', 'RoofCategory',
            'RoofCLTDIndex', 'RoofDirection', 'RoofOptions', 'RoofSTD', 'RoofWTD') }
    walls = @{ Prefix = 'Wall'; Columns = @('WallDescription', 'WallConstructionMaterial', 'WallGroupCode',
            'WallCategory', 'WallAboveGradeUValue', 'WallSTD', 'WallWTD') }
    glass = @{ Prefix = 'Glass'; Columns = @('GlassDescription', 'GlassConstructionMaterial', 'GlassGlazingArrangement',
            'GlassExternalShadeScreenCoverage', 'GlassInternalShadeScreenType', 'GlassInternalShadeScreenCoverage',
            'GlassInsectScreenType', 'GlassInsectScreenCoverage', 'GlassGeometryType', 'GlassGroundReflectance',
            'GlassSkyLight', 'GlassOverhangProjection', 'GlassOverhangOffset', 'GlassUserShadeScreenCoefficient',
            'GlassUserSkylightTilt') }
    doors = @{ Prefix = 'Door'; Columns = @('DoorDescription', 'DoorConstructionMaterial') }
}

function Read-Serialized([object]$raw) {
    if ($null -eq $raw -or $raw -is [DBNull]) { return $null }
    $bytes = [byte[]]$raw
    if ($bytes.Length -ge 16 -and [BitConverter]::ToUInt16($bytes, 6) -eq 1) {
        $variantType = [BitConverter]::ToUInt16($bytes, 4)
        $count = [BitConverter]::ToInt32($bytes, 8)
        $offset = 16
        $values = [Collections.Generic.List[object]]::new()
        for ($item = 0; $item -lt $count; $item++) {
            switch ($variantType) {
                0x2003 { [void]$values.Add([BitConverter]::ToInt32($bytes, $offset)); $offset += 4 }
                0x2004 { [void]$values.Add([BitConverter]::ToSingle($bytes, $offset)); $offset += 4 }
                0x2008 {
                    $length = [BitConverter]::ToUInt16($bytes, $offset)
                    $offset += 2
                    [void]$values.Add($ansi.GetString($bytes, $offset, $length))
                    $offset += $length
                }
                0x200B { [void]$values.Add([BitConverter]::ToInt16($bytes, $offset)); $offset += 2 }
                default { throw ('Unsupported variant type 0x{0:X4}' -f $variantType) }
            }
        }
        return [pscustomobject]@{ VariantType = $variantType; Values = @($values) }
    }
    $text = $ansi.GetString($bytes)
    $separator = $text.IndexOf('q')
    if ($separator -lt 1) { throw "Unknown serialized value '$text'" }
    $type = [int]$text.Substring(0, $separator)
    $scalar = $text.Substring($separator + 1)
    $value = switch ($type) {
        3 { [int]::Parse($scalar, [Globalization.CultureInfo]::InvariantCulture) }
        4 { [single]::Parse($scalar, [Globalization.CultureInfo]::InvariantCulture) }
        8 { $scalar }
        11 { if ([bool]::Parse($scalar)) { [int16]-1 } else { [int16]0 } }
        default { throw "Unsupported scalar type $type" }
    }
    return [pscustomobject]@{ VariantType = 0x2000 + $type; Values = @($value) }
}

$connection = [System.Data.Odbc.OdbcConnection]::new(
    "Driver={Microsoft Access Driver (*.mdb)};Dbq=$([IO.Path]::GetFullPath($Path));Uid=Admin;Pwd=;")
try {
    $connection.Open()
    $adapter = [System.Data.Odbc.OdbcDataAdapter]::new('SELECT * FROM [Room] ORDER BY Identifier', $connection)
    $rooms = [System.Data.DataTable]::new()
    [void]$adapter.Fill($rooms)
    $adapter.Dispose()

    $catalog = [ordered]@{
        header = @(
            'SHIM. Cloneable Manual-J code fields per assembly, used ONLY when the target .r10 does not',
            'already contain a row using that assembly name. The real design -- per-project custom',
            'assemblies authored against the project envelope -- is deferred; see the sync op comment.',
            'Values are RHVAC VB6 variant cells: variantType 8195=int32 (0x2003), 8196=float32 (0x2004),',
            '8200=string (0x2008), 8203=int16 bool (0x200B). Geometry, U-value, and SHGC are NOT here:',
            'those come from the takeoff, per room.',
            'Regenerate with mine-assembly-presets.ps1; never hand-edit a value you cannot source.'
        )
        generatedFrom = [IO.Path]::GetFileName($Path)
        generatedUtc = (Get-Date).ToUniversalTime().ToString('yyyy-MM-ddTHH:mm:ssZ')
    }
    if ($Note) { $catalog.note = $Note }

    $total = 0
    foreach ($category in $materialColumns.Keys) {
        $prefix = $materialColumns[$category].Prefix
        $seen = [ordered]@{}
        foreach ($row in $rooms.Rows) {
            $descriptions = Read-Serialized $row["${prefix}Description"]
            if ($null -eq $descriptions) { continue }
            for ($rowIndex = 0; $rowIndex -lt $descriptions.Values.Count; $rowIndex++) {
                $name = [string]$descriptions.Values[$rowIndex]
                if ([string]::IsNullOrWhiteSpace($name) -or $seen.Contains($name)) { continue }
                $columns = [ordered]@{}
                $complete = $true
                foreach ($column in $materialColumns[$category].Columns) {
                    $decoded = Read-Serialized $row[$column]
                    if ($null -eq $decoded -or $decoded.Values.Count -eq 0) { $complete = $false; break }
                    # Real files trim parallel arrays; a short array's last value applies to the rest.
                    $valueIndex = [Math]::Min($rowIndex, $decoded.Values.Count - 1)
                    $columns[$column] = [ordered]@{
                        variantType = [int]$decoded.VariantType
                        value = $decoded.Values[$valueIndex]
                    }
                }
                # A partial preset would silently inherit whatever the fallback row carries; skip it.
                if (!$complete) { continue }
                $seen[$name] = [ordered]@{ name = $name; columns = $columns }
            }
        }
        $catalog[$category] = @($seen.Values)
        $total += $seen.Count
    }

    $catalog | ConvertTo-Json -Depth 8 | Out-File -LiteralPath $Output -Encoding utf8
    "MINED $total assembly preset(s) -> $Output"
} finally {
    $connection.Dispose()
}
