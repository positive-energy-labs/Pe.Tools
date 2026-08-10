# RHVAC .r10 -> JSON extractor: room inputs + stored calculated loads. The oracle side of the
# takeoff eval harness. See README.md for format spec; run 32-bit like export-rhvac.ps1:
#   C:\Windows\SysWOW64\WindowsPowerShell\v1.0\powershell.exe -File extract-rhvac.ps1 `
#       -Path project.r10 -Output project.extract.json
#
# Loads are RHVAC's own persisted results (last calculation by the app): per-room supply CFM,
# per-system Calculated* load breakdowns, building totals. Zero placeholder rows are dropped —
# absence of exposure is an empty list, matching RhvacRoom semantics.
#
# -Assemblies instead emits the distinct assembly names per category (walls/roofs/floors/glass/
# doors) with their U-values (glass: + SHGC), first occurrence in Identifier order — the same row
# export-rhvac.ps1 clones Manual-J code fields from. This is the editor's assembly picker source.
param(
    [Parameter(Mandatory)][string]$Path,
    [Parameter(Mandatory)][string]$Output,
    [switch]$Assemblies
)

Add-Type -AssemblyName System.Data
$ErrorActionPreference = 'Stop'
if ([IntPtr]::Size -ne 4) { throw 'Run under 32-bit PowerShell (SysWOW64); the Jet driver is 32-bit only.' }
$ansi = [Text.Encoding]::Default

function Read-Serialized([object]$raw) {
    if ($null -eq $raw -or $raw -is [DBNull]) { return @() }
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
        return @($values)
    }
    $text = $ansi.GetString($bytes)
    $separator = $text.IndexOf('q')
    if ($separator -lt 1) { throw "Unknown serialized value '$text'" }
    return @($text.Substring($separator + 1))
}

function Row-Value([object[]]$values, [int]$index, [object]$fallback) {
    # Real files trim parallel arrays; a short array's last value applies to remaining rows.
    if ($values.Count -eq 0) { return $fallback }
    return $values[[Math]::Min($index, $values.Count - 1)]
}

$connection = [System.Data.Odbc.OdbcConnection]::new(
    "Driver={Microsoft Access Driver (*.mdb)};Dbq=$([IO.Path]::GetFullPath($Path));Uid=Admin;Pwd=;")

try {
    $connection.Open()

    if ($Assemblies) {
        # Distinct assemblies per category, first-seen in Identifier order (matching the seed row
        # export-rhvac.ps1 would clone from). U-value read with trimmed-parallel-array semantics.
        $assemblyAdapter = [System.Data.Odbc.OdbcDataAdapter]::new('SELECT * FROM [Room] ORDER BY Identifier', $connection)
        $assemblyTable = [System.Data.DataTable]::new()
        [void]$assemblyAdapter.Fill($assemblyTable)
        $assemblyAdapter.Dispose()
        $listing = [ordered]@{ sourceFile = [IO.Path]::GetFileName($Path) }
        foreach ($category in @(
                @{ Key = 'floors'; Prefix = 'Floor' }, @{ Key = 'roofs'; Prefix = 'Roof' },
                @{ Key = 'walls'; Prefix = 'Wall' }, @{ Key = 'glass'; Prefix = 'Glass' },
                @{ Key = 'doors'; Prefix = 'Door' })) {
            $seen = [ordered]@{}
            foreach ($row in $assemblyTable.Rows) {
                # @(): PowerShell unwraps one-element returns; indexing a bare string yields chars.
                $names = @(Read-Serialized $row["$($category.Prefix)Description"])
                $uValues = @(Read-Serialized $row["$($category.Prefix)UValue"])
                $shgcs = @(if ($category.Prefix -eq 'Glass') { Read-Serialized $row['GlassSHGC'] })
                for ($i = 0; $i -lt $names.Count; $i++) {
                    $name = [string]$names[$i]
                    if ([string]::IsNullOrWhiteSpace($name) -or $seen.Contains($name)) { continue }
                    $entry = [ordered]@{
                        name = $name
                        uValue = [double](Row-Value $uValues $i 0)
                    }
                    if ($category.Prefix -eq 'Glass') { $entry.shgc = [double](Row-Value $shgcs $i 0) }
                    $seen[$name] = $entry
                }
            }
            $listing[$category.Key] = @($seen.Values)
        }
        $listing | ConvertTo-Json -Depth 4 | Out-File -LiteralPath $Output -Encoding utf8
        "ASSEMBLIES $(($listing.Keys | Where-Object { $_ -ne 'sourceFile' } | ForEach-Object { $listing[$_].Count } | Measure-Object -Sum).Sum) distinct -> $Output"
        return
    }

    $adapter = [System.Data.Odbc.OdbcDataAdapter]::new('SELECT * FROM [Room] ORDER BY Number', $connection)
    $roomTable = [System.Data.DataTable]::new()
    [void]$adapter.Fill($roomTable)
    $adapter.Dispose()

    $rooms = foreach ($row in $roomTable.Rows) {
        $floorAreas = Read-Serialized $row['FloorLength']
        $floorWidths = Read-Serialized $row['FloorWidth']
        $floorPerimeters = Read-Serialized $row['FloorPerimeter']
        $floorDescriptions = Read-Serialized $row['FloorDescription']
        $floorUValues = Read-Serialized $row['FloorUValue']
        $floors = for ($i = 0; $i -lt $floorAreas.Count; $i++) {
            $area = [double](Row-Value $floorAreas $i 0) * [double](Row-Value $floorWidths $i 1)
            $perimeter = [double](Row-Value $floorPerimeters $i 0)
            if ($area -eq 0 -and $perimeter -eq 0) { continue }
            [ordered]@{
                assembly = [string](Row-Value $floorDescriptions $i '')
                uValue = [double](Row-Value $floorUValues $i 0)
                areaSquareFeet = $area
                exposedPerimeterFeet = $perimeter
            }
        }

        $roofAreas = Read-Serialized $row['RoofLength']
        $roofWidths = Read-Serialized $row['RoofWidth']
        $roofDescriptions = Read-Serialized $row['RoofDescription']
        $roofUValues = Read-Serialized $row['RoofUValue']
        $roofs = for ($i = 0; $i -lt $roofAreas.Count; $i++) {
            $area = [double](Row-Value $roofAreas $i 0)
            if ($area -eq 0) { continue }
            [ordered]@{
                assembly = [string](Row-Value $roofDescriptions $i '')
                uValue = [double](Row-Value $roofUValues $i 0)
                areaSquareFeet = $area
                areaMultiplier = [double](Row-Value $roofWidths $i 1)
            }
        }

        $wallLengths = Read-Serialized $row['WallLength']
        $wallHeights = Read-Serialized $row['WallHeight']
        $wallDirections = Read-Serialized $row['WallDirection']
        $wallDescriptions = Read-Serialized $row['WallDescription']
        $wallUValues = Read-Serialized $row['WallUValue']
        $walls = for ($i = 0; $i -lt $wallLengths.Count; $i++) {
            $length = [double](Row-Value $wallLengths $i 0)
            if ($length -eq 0) { continue }
            [ordered]@{
                index1 = $i + 1   # 1-based ordinal, the target of glass/door references
                assembly = [string](Row-Value $wallDescriptions $i '')
                uValue = [double](Row-Value $wallUValues $i 0)
                lengthFeet = $length
                heightFeet = [double](Row-Value $wallHeights $i 0)
                direction = [int](Row-Value $wallDirections $i 0)
            }
        }

        $glassWidths = Read-Serialized $row['GlassWidth']
        $glassHeights = Read-Serialized $row['GlassHeight']
        $glassReferences = Read-Serialized $row['GlassReference']
        $glassDescriptions = Read-Serialized $row['GlassDescription']
        $glassUValues = Read-Serialized $row['GlassUValue']
        $glassShgcs = Read-Serialized $row['GlassSHGC']
        $glassOccurrences = Read-Serialized $row['GlassOccurrences']
        $glass = for ($i = 0; $i -lt $glassWidths.Count; $i++) {
            $width = [double](Row-Value $glassWidths $i 0)
            if ($width -eq 0) { continue }
            [ordered]@{
                assembly = [string](Row-Value $glassDescriptions $i '')
                uValue = [double](Row-Value $glassUValues $i 0)
                widthFeet = $width
                heightFeet = [double](Row-Value $glassHeights $i 0)
                wallReference = [int](Row-Value $glassReferences $i 0)
                shgc = [double](Row-Value $glassShgcs $i 0)
                occurrences = [int](Row-Value $glassOccurrences $i 1)
            }
        }

        $doorWidths = Read-Serialized $row['DoorWidth']
        $doorHeights = Read-Serialized $row['DoorHeight']
        $doorReferences = Read-Serialized $row['DoorReference']
        $doorDescriptions = Read-Serialized $row['DoorDescription']
        $doorUValues = Read-Serialized $row['DoorUValue']
        $doors = for ($i = 0; $i -lt $doorWidths.Count; $i++) {
            $width = [double](Row-Value $doorWidths $i 0)
            if ($width -eq 0) { continue }
            [ordered]@{
                assembly = [string](Row-Value $doorDescriptions $i '')
                uValue = [double](Row-Value $doorUValues $i 0)
                widthFeet = $width
                heightFeet = [double](Row-Value $doorHeights $i 0)
                wallReference = [int](Row-Value $doorReferences $i 0)
            }
        }

        [ordered]@{
            identifier = [int]$row['Identifier']   # autonumber PK, the edit lane's row target
            number = [int]$row['Number']
            name = [string]$row['Description']
            systemNumber = [int]$row['SystemNumber']
            zoneNumber = [int]$row['ZoneNumber']
            areaSquareFeet = [double]$row['Length'] * [double]$row['Width']
            ceilingHeightFeet = [double]$row['Height']
            people = [int]$row['PeopleNumber']
            lightingWatts = [double]$row['LightingWatts']
            equipmentSensibleBtuh = [double]$row['EquipmentSensible']
            equipmentLatentBtuh = [double]$row['EquipmentLatent']
            loads = [ordered]@{
                cfmSupplyCooling = [double]$row['CFMSupplyCooling']
                cfmSupplyHeating = [double]$row['CFMSupplyHeating']
                cfmSupplyActual = [double]$row['CFMSupplyActual']
                temperatureInDuct = [double]$row['TemperatureInDuct']
                registersCalculated = [double]$row['RegistersCalculated']
            }
            floors = @($floors)
            roofs = @($roofs)
            walls = @($walls)
            glass = @($glass)
            doors = @($doors)
        }
    }

    $systemColumns = @($connection.GetSchema('Columns') |
        Where-Object { $_.TABLE_NAME -eq 'System' -and $_.COLUMN_NAME -like 'Calculated*' -and $_.TYPE_NAME -ne 'LONGBINARY' } |
        ForEach-Object COLUMN_NAME)
    $systemAdapter = [System.Data.Odbc.OdbcDataAdapter]::new(
        "SELECT Number, $(($systemColumns | ForEach-Object { "[$_]" }) -join ', ') FROM [System] ORDER BY Number", $connection)
    $systemTable = [System.Data.DataTable]::new()
    [void]$systemAdapter.Fill($systemTable)
    $systemAdapter.Dispose()
    $systems = foreach ($row in $systemTable.Rows) {
        $entry = [ordered]@{ number = [int]$row['Number'] }
        foreach ($column in $systemColumns) {
            $value = $row[$column]
            if ($value -is [DBNull]) { continue }
            # Calculated* -> calculated* JSON casing
            $entry[[char]::ToLowerInvariant($column[0]) + $column.Substring(1)] = [double]$value
        }
        $entry
    }

    $resultsAdapter = [System.Data.Odbc.OdbcDataAdapter]::new('SELECT * FROM [Results]', $connection)
    $resultsTable = [System.Data.DataTable]::new()
    [void]$resultsAdapter.Fill($resultsTable)
    $resultsAdapter.Dispose()
    $resultsRow = $resultsTable.Rows[0]
    $building = [ordered]@{
        areaSquareFeet = [double]$resultsRow['BuildingArea']
        people = [double]$resultsRow['PeopleInBuilding']
        coolingLoadNetBtuh = [double]$resultsRow['BuildingCoolingLoadNet']
        coolingLoadRecommendedBtuh = [double]$resultsRow['BuildingCoolingLoadRecommended']
        heatingLoadBtuh = [double]$resultsRow['BuildingHeatingLoad']
        heatingLoadRecommendedBtuh = [double]$resultsRow['BuildingHeatingLoadRecommended']
    }

    $extract = [ordered]@{
        sourceFile = [IO.Path]::GetFileName($Path)
        building = $building
        systems = @($systems)
        rooms = @($rooms)
    }
    $extract | ConvertTo-Json -Depth 8 | Out-File -LiteralPath $Output -Encoding utf8
    "EXTRACTED $(@($rooms).Count) rooms, $(@($systems).Count) systems -> $Output"
} finally {
    $connection.Dispose()
}
