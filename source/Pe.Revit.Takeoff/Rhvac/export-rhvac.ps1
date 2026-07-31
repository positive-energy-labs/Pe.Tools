# JSON -> RHVAC .r10 export engine. See README.md in this folder for the format spec.
#
# MUST run 32-bit (r10 files are Access 97 Jet; only the WOW64 Jet driver opens them):
#   C:\Windows\SysWOW64\WindowsPowerShell\v1.0\powershell.exe -File export-rhvac.ps1 `
#       -RoomsJson rooms.json -Template project.r10 -Output out.r10
#
# RoomsJson is a System.Text.Json serialization of Pe.Revit.Takeoff.Rhvac.RhvacRoom[]
# (PascalCase properties, enums as ints). Every assembly Name must already be used somewhere in
# the template file; its Manual-J code fields are cloned from that row (see README "Materials").
param(
    [Parameter(Mandatory)][string]$RoomsJson,
    [Parameter(Mandatory)][string]$Template,
    [Parameter(Mandatory)][string]$Output
)

Add-Type -AssemblyName System.Data
$ErrorActionPreference = 'Stop'
if ([IntPtr]::Size -ne 4) { throw 'Run under 32-bit PowerShell (SysWOW64); the Jet driver is 32-bit only.' }
$ansi = [Text.Encoding]::Default

# --- VB6 variant array blob codec (spec in README.md) ---

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

function Write-Serialized([uint16]$variantType, [object[]]$values) {
    if ($values.Count -eq 0) { throw 'Cannot write an empty array' }
    $stream = [IO.MemoryStream]::new()
    $writer = [IO.BinaryWriter]::new($stream)
    $writer.Write([int]($values.Count - 1))
    $writer.Write($variantType)
    $writer.Write([uint16]1)
    $writer.Write([int]$values.Count)
    $writer.Write([int]0)
    foreach ($value in $values) {
        switch ($variantType) {
            0x2003 { $writer.Write([int]$value) }
            0x2004 { $writer.Write([single]$value) }
            0x2008 {
                $encoded = $ansi.GetBytes([string]$value)
                if ($encoded.Length -gt [uint16]::MaxValue) { throw 'String is too long' }
                $writer.Write([uint16]$encoded.Length)
                $writer.Write($encoded)
            }
            0x200B { $writer.Write([int16]$value) }
            default { throw ('Unsupported variant type 0x{0:X4}' -f $variantType) }
        }
    }
    $writer.Dispose()
    return ,$stream.ToArray()
}

# --- Column groups: material columns cloned from the seed row, geometry overridden per room ---

$materialColumns = @{
    Floor = @('FloorDescription', 'FloorConstructionMaterial', 'FloorCategory', 'FloorSealedCrawlSpace',
        'FloorCrawlSpaceWallUValue', 'FloorRadiant', 'FloorOptions', 'FloorSTD', 'FloorWTD')
    Roof = @('RoofDescription', 'RoofConstructionMaterial', 'RoofCategory', 'RoofCLTDIndex',
        'RoofDirection', 'RoofOptions', 'RoofSTD', 'RoofWTD')
    Wall = @('WallDescription', 'WallConstructionMaterial', 'WallGroupCode', 'WallCategory',
        'WallAboveGradeUValue', 'WallSTD', 'WallWTD')
    Glass = @('GlassDescription', 'GlassConstructionMaterial', 'GlassGlazingArrangement',
        'GlassExternalShadeScreenCoverage', 'GlassInternalShadeScreenType', 'GlassInternalShadeScreenCoverage',
        'GlassInsectScreenType', 'GlassInsectScreenCoverage', 'GlassGeometryType', 'GlassGroundReflectance',
        'GlassSkyLight', 'GlassOverhangProjection', 'GlassOverhangOffset', 'GlassUserShadeScreenCoefficient',
        'GlassUserSkylightTilt')
    Door = @('DoorDescription', 'DoorConstructionMaterial')
}

# Geometry/override columns per category (material columns above are cloned from seed rows).
$geometryColumns = @{
    Floor = @('FloorUValue', 'FloorLength', 'FloorWidth', 'FloorPerimeter')
    Roof = @('RoofUValue', 'RoofLength', 'RoofWidth')
    Wall = @('WallUValue', 'WallLength', 'WallHeight', 'WallDirection')
    Glass = @('GlassUValue', 'GlassSHGC', 'GlassWidth', 'GlassHeight', 'GlassReference', 'GlassOccurrences')
    Door = @('DoorUValue', 'DoorWidth', 'DoorHeight', 'DoorReference')
}
# Load-bearing columns zeroed in placeholder rows. DefaultRoom is NOT a clean template: real
# project files carry residual junk in it (projectA: four leftover wall lengths, floor U=1.18), so
# every category is always written — empty categories get one explicit zero row, matching how
# RHVAC itself represents "no exposure".
$placeholderZeroColumns = @{
    Floor = @('FloorDescription', 'FloorConstructionMaterial', 'FloorOptions', 'FloorUValue', 'FloorLength',
        'FloorWidth', 'FloorPerimeter', 'FloorRadiant', 'FloorSealedCrawlSpace', 'FloorCrawlSpaceWallUValue')
    Roof = @('RoofDescription', 'RoofConstructionMaterial', 'RoofOptions', 'RoofUValue', 'RoofLength', 'RoofWidth')
    Wall = @('WallDescription', 'WallConstructionMaterial', 'WallGroupCode', 'WallUValue',
        'WallAboveGradeUValue', 'WallLength', 'WallHeight', 'WallDirection')
    Glass = @('GlassDescription', 'GlassConstructionMaterial', 'GlassUValue', 'GlassSHGC',
        'GlassWidth', 'GlassHeight', 'GlassReference', 'GlassOccurrences')
    Door = @('DoorDescription', 'DoorConstructionMaterial', 'DoorUValue', 'DoorWidth', 'DoorHeight', 'DoorReference')
}

$rooms = Get-Content -LiteralPath $RoomsJson -Raw | ConvertFrom-Json
if ($null -eq $rooms) { throw "No rooms in $RoomsJson" }
$rooms = @($rooms)

$templatePath = [IO.Path]::GetFullPath($Template)
$outputPath = [IO.Path]::GetFullPath($Output)
if ($templatePath -eq $outputPath) { throw 'Template and output must differ; the original is never written in place.' }
if (![IO.File]::Exists($templatePath)) { throw "Template does not exist: $templatePath" }
Copy-Item -LiteralPath $templatePath -Destination $outputPath -Force

$connection = [System.Data.Odbc.OdbcConnection]::new(
    "Driver={Microsoft Access Driver (*.mdb)};Dbq=$outputPath;Uid=Admin;Pwd=;")

try {
    $connection.Open()

    # Seed index: category -> assembly description -> @{ Identifier; RowIndex }
    $seedIndex = @{}
    $seedRowCache = @{}
    $command = $connection.CreateCommand()
    $command.CommandText = 'SELECT Identifier, Number, FloorDescription, RoofDescription, WallDescription, GlassDescription, DoorDescription FROM [Room] ORDER BY Identifier'
    $reader = $command.ExecuteReader()
    $existingNumbers = [Collections.Generic.HashSet[int]]::new()
    while ($reader.Read()) {
        [void]$existingNumbers.Add($reader.GetInt32(1))
        foreach ($category in 'Floor', 'Roof', 'Wall', 'Glass', 'Door') {
            if (!$seedIndex.ContainsKey($category)) { $seedIndex[$category] = @{} }
            $decoded = Read-Serialized $reader.GetValue($reader.GetOrdinal("${category}Description"))
            if ($null -eq $decoded) { continue }
            for ($rowIndex = 0; $rowIndex -lt $decoded.Values.Count; $rowIndex++) {
                $name = [string]$decoded.Values[$rowIndex]
                if ([string]::IsNullOrWhiteSpace($name)) { continue }
                if (!$seedIndex[$category].ContainsKey($name)) {
                    $seedIndex[$category][$name] = @{ Identifier = $reader.GetInt32(0); RowIndex = $rowIndex }
                }
            }
        }
    }
    $reader.Dispose()
    $command.Dispose()

    function Get-SeedValue([string]$category, [string]$assemblyName, [string]$column) {
        # Returns @{ VariantType; Value } for one material column of the seed row matching the assembly.
        if (!$seedIndex[$category].ContainsKey($assemblyName)) {
            throw "Assembly '$assemblyName' ($category) is not used anywhere in the template; the engineer must add it to a room first."
        }
        $seed = $seedIndex[$category][$assemblyName]
        $cacheKey = "$($seed.Identifier)"
        if (!$seedRowCache.ContainsKey($cacheKey)) {
            $rowCommand = $connection.CreateCommand()
            $rowCommand.CommandText = "SELECT * FROM [Room] WHERE Identifier = $($seed.Identifier)"
            $rowAdapter = [System.Data.Odbc.OdbcDataAdapter]::new($rowCommand)
            $rowTable = [System.Data.DataTable]::new()
            [void]$rowAdapter.Fill($rowTable)
            $seedRowCache[$cacheKey] = $rowTable.Rows[0]
            $rowAdapter.Dispose()
            $rowCommand.Dispose()
        }
        $decoded = Read-Serialized $seedRowCache[$cacheKey][$column]
        if ($null -eq $decoded -or $decoded.Values.Count -eq 0) { throw "Seed room $($seed.Identifier) has no value for $column" }
        # Real files trim parallel arrays; a single value applies to all rows (README quirks).
        $valueIndex = [Math]::Min($seed.RowIndex, $decoded.Values.Count - 1)
        return @{ VariantType = $decoded.VariantType; Value = $decoded.Values[$valueIndex] }
    }

    function Build-CategoryBlobs([string]$category, [object[]]$assemblyNames, [hashtable]$overrides) {
        # One blob per column: material columns replicated from each row's seed, overrides as given.
        $blobs = @{}
        foreach ($column in $materialColumns[$category]) {
            $perRow = @(foreach ($name in $assemblyNames) { (Get-SeedValue $category $name $column).Value })
            $variantType = (Get-SeedValue $category $assemblyNames[0] $column).VariantType
            $blobs[$column] = Write-Serialized $variantType $perRow
        }
        foreach ($column in $overrides.Keys) {
            $spec = $overrides[$column]   # @{ Type = uint16; Values = object[] }
            $blobs[$column] = Write-Serialized $spec.Type $spec.Values
        }
        return $blobs
    }

    $defaultColumns = @($connection.GetSchema('Columns') |
        Where-Object TABLE_NAME -eq 'DefaultRoom' |
        Sort-Object ORDINAL_POSITION |
        ForEach-Object COLUMN_NAME)
    $quotedDefaults = ($defaultColumns | ForEach-Object { "[$_]" }) -join ', '

    $defaultRoomCommand = $connection.CreateCommand()
    $defaultRoomCommand.CommandText = 'SELECT * FROM [DefaultRoom]'
    $defaultRoomAdapter = [System.Data.Odbc.OdbcDataAdapter]::new($defaultRoomCommand)
    $defaultRoomTable = [System.Data.DataTable]::new()
    [void]$defaultRoomAdapter.Fill($defaultRoomTable)
    $defaultRoom = $defaultRoomTable.Rows[0]
    $defaultRoomAdapter.Dispose()
    $defaultRoomCommand.Dispose()

    function Build-PlaceholderBlobs([string]$category) {
        # One zero row per column: load-bearing values zeroed, RHVAC's own defaults (categories,
        # screen types/coverages) kept from DefaultRoom so its dialogs stay sensible.
        $blobs = @{}
        foreach ($column in @($materialColumns[$category]) + @($geometryColumns[$category])) {
            if (-not $defaultRoomTable.Columns.Contains($column)) { continue }
            $decoded = Read-Serialized $defaultRoom[$column]
            if ($null -eq $decoded -or $decoded.Values.Count -eq 0) { continue }
            $value = $decoded.Values[0]
            if ($placeholderZeroColumns[$category] -contains $column) {
                if ($decoded.VariantType -eq 0x2008) { $value = '' } else { $value = 0 }
            }
            $blobs[$column] = Write-Serialized $decoded.VariantType @($value)
        }
        return $blobs
    }

    $single = [uint16]0x2004
    $integer = [uint16]0x2003

    foreach ($room in $rooms) {
        if ($existingNumbers.Contains([int]$room.Number)) { throw "Room number $($room.Number) already exists in the template." }
        [void]$existingNumbers.Add([int]$room.Number)

        $blobs = @{}
        if (@($room.Floors).Count -eq 0) { $blobs += Build-PlaceholderBlobs 'Floor' }
        else {
            $floors = @($room.Floors)
            $blobs += Build-CategoryBlobs 'Floor' @($floors | ForEach-Object { $_.Assembly.Name }) @{
                FloorUValue = @{ Type = $single; Values = @($floors | ForEach-Object { [single]$_.Assembly.UValue }) }
                FloorLength = @{ Type = $single; Values = @($floors | ForEach-Object { [single]$_.AreaSquareFeet }) }
                FloorWidth = @{ Type = $single; Values = @($floors | ForEach-Object { [single]1 }) }
                FloorPerimeter = @{ Type = $single; Values = @($floors | ForEach-Object { [single]$_.ExposedPerimeterFeet }) }
            }
        }
        if (@($room.Roofs).Count -eq 0) { $blobs += Build-PlaceholderBlobs 'Roof' }
        else {
            $roofs = @($room.Roofs)
            $blobs += Build-CategoryBlobs 'Roof' @($roofs | ForEach-Object { $_.Assembly.Name }) @{
                RoofUValue = @{ Type = $single; Values = @($roofs | ForEach-Object { [single]$_.Assembly.UValue }) }
                RoofLength = @{ Type = $single; Values = @($roofs | ForEach-Object { [single]$_.AreaSquareFeet }) }
                RoofWidth = @{ Type = $single; Values = @($roofs | ForEach-Object { [single]$_.AreaMultiplier }) }
            }
        }
        $walls = @($room.Walls)
        $glassRows = @()
        $doorRows = @()
        for ($wallOrdinal = 1; $wallOrdinal -le $walls.Count; $wallOrdinal++) {
            $wall = $walls[$wallOrdinal - 1]
            foreach ($window in @($wall.Windows)) { $glassRows += ,@($window, $wallOrdinal) }
            foreach ($door in @($wall.Doors)) { $doorRows += ,@($door, $wallOrdinal) }
        }
        if ($walls.Count -eq 0) { $blobs += Build-PlaceholderBlobs 'Wall' }
        else {
            $blobs += Build-CategoryBlobs 'Wall' @($walls | ForEach-Object { $_.Assembly.Name }) @{
                WallUValue = @{ Type = $single; Values = @($walls | ForEach-Object { [single]$_.Assembly.UValue }) }
                WallLength = @{ Type = $single; Values = @($walls | ForEach-Object { [single]$_.LengthFeet }) }
                WallHeight = @{ Type = $single; Values = @($walls | ForEach-Object { [single]$_.HeightFeet }) }
                WallDirection = @{ Type = $integer; Values = @($walls | ForEach-Object { [int]$_.Direction }) }
            }
        }
        if ($glassRows.Count -eq 0) { $blobs += Build-PlaceholderBlobs 'Glass' }
        else {
            $blobs += Build-CategoryBlobs 'Glass' @($glassRows | ForEach-Object { $_[0].Assembly.Name }) @{
                GlassUValue = @{ Type = $single; Values = @($glassRows | ForEach-Object { [single]$_[0].Assembly.UValue }) }
                GlassSHGC = @{ Type = $single; Values = @($glassRows | ForEach-Object { [single]$_[0].SolarHeatGainCoefficient }) }
                GlassWidth = @{ Type = $single; Values = @($glassRows | ForEach-Object { [single]$_[0].WidthFeet }) }
                GlassHeight = @{ Type = $single; Values = @($glassRows | ForEach-Object { [single]$_[0].HeightFeet }) }
                GlassReference = @{ Type = $integer; Values = @($glassRows | ForEach-Object { [int]$_[1] }) }
                GlassOccurrences = @{ Type = $integer; Values = @($glassRows | ForEach-Object { [int]$_[0].Occurrences }) }
            }
        }
        if ($doorRows.Count -eq 0) { $blobs += Build-PlaceholderBlobs 'Door' }
        else {
            $blobs += Build-CategoryBlobs 'Door' @($doorRows | ForEach-Object { $_[0].Assembly.Name }) @{
                DoorUValue = @{ Type = $single; Values = @($doorRows | ForEach-Object { [single]$_[0].Assembly.UValue }) }
                DoorWidth = @{ Type = $single; Values = @($doorRows | ForEach-Object { [single]$_[0].WidthFeet }) }
                DoorHeight = @{ Type = $single; Values = @($doorRows | ForEach-Object { [single]$_[0].HeightFeet }) }
                DoorReference = @{ Type = $integer; Values = @($doorRows | ForEach-Object { [int]$_[1] }) }
            }
        }

        $transaction = $connection.BeginTransaction()

        $insert = $connection.CreateCommand()
        $insert.Transaction = $transaction
        $insert.CommandText = "INSERT INTO [Room] ([Number], [Description], $quotedDefaults) SELECT ?, ?, $quotedDefaults FROM [DefaultRoom]"
        [void]$insert.Parameters.Add('@number', [System.Data.Odbc.OdbcType]::Int)
        [void]$insert.Parameters.Add('@description', [System.Data.Odbc.OdbcType]::VarChar, 255)
        $insert.Parameters[0].Value = [int]$room.Number
        $insert.Parameters[1].Value = [string]$room.Name
        if ($insert.ExecuteNonQuery() -ne 1) { throw "Insert failed for room $($room.Number)" }
        $insert.Dispose()

        $identity = $connection.CreateCommand()
        $identity.Transaction = $transaction
        $identity.CommandText = 'SELECT MAX(Identifier) FROM [Room]'
        $identifier = [int]$identity.ExecuteScalar()
        $identity.Dispose()

        $loads = $room.InternalLoads
        $scalar = $connection.CreateCommand()
        $scalar.Transaction = $transaction
        $scalar.CommandText = @'
UPDATE [Room]
SET SystemNumber = ?, ZoneNumber = ?, Length = ?, Width = 1, Height = ?,
    PeopleNumber = ?, LightingWatts = ?, EquipmentSensible = ?, EquipmentLatent = ?,
    Occurrences = 1, CalculationMode = 0
WHERE Identifier = ?
'@
        foreach ($value in @([int]$room.SystemNumber, [int]$room.ZoneNumber, [double]$room.AreaSquareFeet,
                [double]$room.CeilingHeightFeet, [int]$loads.People, [int][Math]::Round($loads.LightingWatts),
                [double]$loads.SensibleEquipmentBtuh, [double]$loads.LatentEquipmentBtuh, $identifier)) {
            $parameter = $scalar.CreateParameter()
            $parameter.Value = $value
            [void]$scalar.Parameters.Add($parameter)
        }
        if ($scalar.ExecuteNonQuery() -ne 1) { throw "Scalar update failed for room $($room.Number)" }
        $scalar.Dispose()

        if ($blobs.Count -gt 0) {
            $columns = @($blobs.Keys | Sort-Object)
            $update = $connection.CreateCommand()
            $update.Transaction = $transaction
            $update.CommandText = "UPDATE [Room] SET $((($columns | ForEach-Object { ""[$_] = ?"" }) -join ', ')) WHERE Identifier = ?"
            foreach ($column in $columns) {
                $bytes = [byte[]]$blobs[$column]
                [void]$update.Parameters.Add("@$column", [System.Data.Odbc.OdbcType]::Image, $bytes.Length)
                $update.Parameters[$update.Parameters.Count - 1].Value = $bytes
            }
            [void]$update.Parameters.Add('@identifier', [System.Data.Odbc.OdbcType]::Int)
            $update.Parameters[$update.Parameters.Count - 1].Value = $identifier
            if ($update.ExecuteNonQuery() -ne 1) { throw "Blob update failed for room $($room.Number)" }
            $update.Dispose()
        }

        # Jet's bulk LONGBINARY update mangles adjacent LONGCHAR values; write them after the blobs.
        $name = $connection.CreateCommand()
        $name.Transaction = $transaction
        $name.CommandText = "UPDATE [Room] SET [Description] = ?, [RoomNotesPlainText] = 'Exported by Pe.Revit.Takeoff' WHERE [Identifier] = ?"
        [void]$name.Parameters.Add('@description', [System.Data.Odbc.OdbcType]::VarChar, 255)
        [void]$name.Parameters.Add('@identifier', [System.Data.Odbc.OdbcType]::Int)
        $name.Parameters[0].Value = [string]$room.Name
        $name.Parameters[1].Value = $identifier
        if ($name.ExecuteNonQuery() -ne 1) { throw "Name update failed for room $($room.Number)" }
        $name.Dispose()

        $transaction.Commit()
        $transaction.Dispose()

        # Read-back verification: counts and references must match the input exactly.
        $verify = $connection.CreateCommand()
        $verify.CommandText = "SELECT Number, Description, Length, Height, WallLength, WallDirection, GlassReference, DoorReference FROM [Room] WHERE Identifier = $identifier"
        $verifyReader = $verify.ExecuteReader()
        if (!$verifyReader.Read()) { throw "Room $($room.Number) could not be read back" }
        $backNumber = $verifyReader.GetInt32(0)
        $backName = $verifyReader.GetString(1)
        $backWalls = Read-Serialized $verifyReader.GetValue(4)
        $backDirections = Read-Serialized $verifyReader.GetValue(5)
        $backGlassRefs = Read-Serialized $verifyReader.GetValue(6)
        $backDoorRefs = Read-Serialized $verifyReader.GetValue(7)
        $verifyReader.Dispose()
        $verify.Dispose()
        if ($backNumber -ne [int]$room.Number -or $backName -ne [string]$room.Name) {
            throw "Read-back mismatch for room $($room.Number): number/name"
        }
        if ($walls.Count -gt 0) {
            $expectedDirections = (@($walls | ForEach-Object { [int]$_.Direction }) -join ',')
            if (($backDirections.Values -join ',') -ne $expectedDirections) {
                throw "Read-back mismatch for room $($room.Number): wall directions"
            }
        }
        else {
            # Empty category must land as one explicit zero row, never DefaultRoom residue.
            if (($backWalls.Values -join ',') -ne '0') {
                throw "Read-back mismatch for room $($room.Number): expected zero placeholder wall, got [$($backWalls.Values -join ',')]"
            }
        }
        if ($glassRows.Count -gt 0 -and (($backGlassRefs.Values -join ',') -ne (@($glassRows | ForEach-Object { $_[1] }) -join ','))) {
            throw "Read-back mismatch for room $($room.Number): glass references"
        }
        if ($doorRows.Count -gt 0 -and (($backDoorRefs.Values -join ',') -ne (@($doorRows | ForEach-Object { $_[1] }) -join ','))) {
            throw "Read-back mismatch for room $($room.Number): door references"
        }
        "Room $($room.Number) '$($room.Name)': walls=$($walls.Count) glass=$($glassRows.Count) doors=$($doorRows.Count) floors=$(@($room.Floors).Count) roofs=$(@($room.Roofs).Count) OK"
    }
    "EXPORTED $($rooms.Count) room(s) -> $outputPath"
} finally {
    $connection.Dispose()
}
