# JSON -> RHVAC .r10 engine: insert lane (takeoff export), edit lane (update/delete by room PK),
# and sync lane (system seeding + inserts + updates + deletes in one pass).
# See README.md in this folder for the format spec.
#
# ASCII ONLY: the 32-bit lane runs PowerShell 5.1, which parses these scripts under the ANSI
# codepage — any non-ASCII character breaks parsing. Keep every script in this folder ASCII-only.
#
# MUST run 32-bit (r10 files are Access 97 Jet; only the WOW64 Jet driver opens them):
#   C:\Windows\SysWOW64\WindowsPowerShell\v1.0\powershell.exe -File export-rhvac.ps1 `
#       -RoomsJson rooms.json -Template project.r10 -Output out.r10     # insert new rooms
#   C:\Windows\SysWOW64\WindowsPowerShell\v1.0\powershell.exe -File export-rhvac.ps1 `
#       -EditsJson edits.json -Source project.r10 -Output out.r10       # edit existing rooms
#   C:\Windows\SysWOW64\WindowsPowerShell\v1.0\powershell.exe -File export-rhvac.ps1 `
#       -SyncJson sync.json -Source project.r10 -Output out.r10 -ResultJson result.json
#
# RoomsJson is a System.Text.Json serialization of Pe.Revit.Takeoff.Rhvac.RhvacRoom[]
# (PascalCase properties, enums as ints). EditsJson is
#   { "updates": [ <RhvacRoom shape + "Identifier": <Room autonumber PK>> ], "deletes": [ <PK> ] }
# SyncJson is
#   { "systems": [ { "Number": <int>, "Name": <string> } ],   # seeded before rooms land
#     "inserts": [ <RhvacRoom shape> ],                        # new rooms
#     "updates": [ <RhvacRoom shape + Identifier> ],
#     "deletes": [ <PK> ],
#     "deleteUntouchedSeedRoom": <bool> }                      # the template's blank Room
# and writes -ResultJson: fileIdentity, seeded systems, inserted number -> Identifier, the seed-room
# decision, and assembly fallbacks. Sync order is fixed: systems -> inserts -> updates -> deletes ->
# seed room. The seed room goes LAST because the insert lane clones assembly code fields out of the
# rows already in the file, and in the firm template the seed room is the only such row.
#
# Updates rewrite only the modeled columns (Number/Description/scalars + the five category blob
# groups); every other column in the row stays untouched -- the file remains truth for everything
# the editor does not model. Deletes refuse if duct-design rows reference the room (see README).
# Every lane copies the input file and writes the copy; the original is never written in place.
#
# Assembly resolution, in order: (1) a row already in the target file using that assembly Name --
# its Manual-J code fields are cloned; (2) assembly-presets.json next to this script (a SHIM
# catalog, see its header); (3) neither -- the room's whole category is written as one explicit zero
# row and the room+category is reported as a fallback. The lane never invents code fields.
[CmdletBinding(DefaultParameterSetName = 'Insert')]
param(
    [Parameter(Mandatory, ParameterSetName = 'Insert')][string]$RoomsJson,
    [Parameter(Mandatory, ParameterSetName = 'Insert')][string]$Template,
    [Parameter(Mandatory, ParameterSetName = 'Edit')][string]$EditsJson,
    [Parameter(Mandatory, ParameterSetName = 'Edit')]
    [Parameter(Mandatory, ParameterSetName = 'Sync')][string]$Source,
    [Parameter(Mandatory, ParameterSetName = 'Sync')][string]$SyncJson,
    [Parameter(ParameterSetName = 'Sync')][string]$ResultJson,
    [Parameter(Mandatory)][string]$Output
)

Add-Type -AssemblyName System.Data
$ErrorActionPreference = 'Stop'
if ([IntPtr]::Size -ne 4) { throw 'Run under 32-bit PowerShell (SysWOW64); the Jet driver is 32-bit only.' }
$ansi = [Text.Encoding]::Default
$lane = $PSCmdlet.ParameterSetName
$isEdit = $lane -eq 'Edit'
$isSync = $lane -eq 'Sync'

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
# every category is always written -- empty categories get one explicit zero row, matching how
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
# JSON catalog category key per blob category prefix.
$catalogCategoryKeys = @{ Floor = 'floors'; Roof = 'roofs'; Wall = 'walls'; Glass = 'glass'; Door = 'doors' }

if ($isEdit) {
    $edits = Get-Content -LiteralPath $EditsJson -Raw | ConvertFrom-Json
    $updates = @(); if ($edits.PSObject.Properties['updates']) { $updates = @($edits.updates) }
    $deletes = @(); if ($edits.PSObject.Properties['deletes']) { $deletes = @($edits.deletes) }
    if ($updates.Count -eq 0 -and $deletes.Count -eq 0) { throw "No updates or deletes in $EditsJson" }
    $inputFile = $Source
    $rooms = @()
    $seedSystems = @()
    $deleteSeedRoom = $false
} elseif ($isSync) {
    $sync = Get-Content -LiteralPath $SyncJson -Raw | ConvertFrom-Json
    $seedSystems = @(); if ($sync.PSObject.Properties['systems']) { $seedSystems = @($sync.systems) }
    $rooms = @(); if ($sync.PSObject.Properties['inserts']) { $rooms = @($sync.inserts) }
    $updates = @(); if ($sync.PSObject.Properties['updates']) { $updates = @($sync.updates) }
    $deletes = @(); if ($sync.PSObject.Properties['deletes']) { $deletes = @($sync.deletes) }
    $deleteSeedRoom = [bool]($sync.PSObject.Properties['deleteUntouchedSeedRoom'] -and $sync.deleteUntouchedSeedRoom)
    if ($seedSystems.Count -eq 0 -and $rooms.Count -eq 0 -and $updates.Count -eq 0 -and
        $deletes.Count -eq 0 -and !$deleteSeedRoom) {
        throw "Nothing to sync in $SyncJson"
    }
    $inputFile = $Source
} else {
    $rooms = Get-Content -LiteralPath $RoomsJson -Raw | ConvertFrom-Json
    if ($null -eq $rooms) { throw "No rooms in $RoomsJson" }
    $rooms = @($rooms)
    $inputFile = $Template
    $updates = @()
    $deletes = @()
    $seedSystems = @()
    $deleteSeedRoom = $false
}

$inputPath = [IO.Path]::GetFullPath($inputFile)
$outputPath = [IO.Path]::GetFullPath($Output)
if ($inputPath -eq $outputPath) { throw 'Input and output must differ; the original is never written in place.' }
if (![IO.File]::Exists($inputPath)) { throw "Input file does not exist: $inputPath" }
Copy-Item -LiteralPath $inputPath -Destination $outputPath -Force

# --- Assembly preset catalog (SHIM; see assembly-presets.json header) --------------------------
$presetPath = Join-Path $PSScriptRoot 'assembly-presets.json'
$presets = @{}
if ([IO.File]::Exists($presetPath)) {
    $presetFile = Get-Content -LiteralPath $presetPath -Raw | ConvertFrom-Json
    foreach ($category in $catalogCategoryKeys.Keys) {
        $presets[$category] = @{}
        $key = $catalogCategoryKeys[$category]
        if (!$presetFile.PSObject.Properties[$key]) { continue }
        foreach ($entry in @($presetFile.$key)) {
            $cells = @{}
            foreach ($column in $entry.columns.PSObject.Properties) {
                $cells[$column.Name] = @{ VariantType = [uint16]$column.Value.variantType; Value = $column.Value.value }
            }
            $presets[$category][[string]$entry.name] = $cells
        }
    }
}

$connection = [System.Data.Odbc.OdbcConnection]::new(
    "Driver={Microsoft Access Driver (*.mdb)};Dbq=$outputPath;Uid=Admin;Pwd=;")

try {
    $connection.Open()

    # Seed index: category -> assembly description -> @{ Identifier; RowIndex }
    $seedIndex = @{}
    $seedRowCache = @{}
    $assemblyCellCache = @{}
    $command = $connection.CreateCommand()
    $command.CommandText = 'SELECT Identifier, Number, FloorDescription, RoofDescription, WallDescription, GlassDescription, DoorDescription FROM [Room] ORDER BY Identifier'
    $reader = $command.ExecuteReader()
    $existingNumbers = [Collections.Generic.HashSet[int]]::new()
    $numberByIdentifier = @{}
    while ($reader.Read()) {
        [void]$existingNumbers.Add($reader.GetInt32(1))
        $numberByIdentifier[$reader.GetInt32(0)] = $reader.GetInt32(1)
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

    function Get-SeedRow([int]$identifier) {
        $cacheKey = "$identifier"
        if (!$seedRowCache.ContainsKey($cacheKey)) {
            $rowCommand = $connection.CreateCommand()
            $rowCommand.CommandText = "SELECT * FROM [Room] WHERE Identifier = $identifier"
            $rowAdapter = [System.Data.Odbc.OdbcDataAdapter]::new($rowCommand)
            $rowTable = [System.Data.DataTable]::new()
            [void]$rowAdapter.Fill($rowTable)
            $seedRowCache[$cacheKey] = $rowTable.Rows[0]
            $rowAdapter.Dispose()
            $rowCommand.Dispose()
        }
        return $seedRowCache[$cacheKey]
    }

    function Get-AssemblyCells([string]$category, [string]$assemblyName) {
        # Material columns for one assembly: file row first, then the preset catalog, else $null
        # (the caller writes the whole category as a zero row and reports the fallback).
        $cacheKey = "$category|$assemblyName"
        if ($assemblyCellCache.ContainsKey($cacheKey)) { return $assemblyCellCache[$cacheKey] }
        $cells = $null
        if ($seedIndex[$category].ContainsKey($assemblyName)) {
            $seed = $seedIndex[$category][$assemblyName]
            $row = Get-SeedRow $seed.Identifier
            $cells = @{}
            foreach ($column in $materialColumns[$category]) {
                $decoded = Read-Serialized $row[$column]
                if ($null -eq $decoded -or $decoded.Values.Count -eq 0) {
                    throw "Seed room $($seed.Identifier) has no value for $column"
                }
                # Real files trim parallel arrays; a single value applies to all rows (README quirks).
                $valueIndex = [Math]::Min($seed.RowIndex, $decoded.Values.Count - 1)
                $cells[$column] = @{ VariantType = $decoded.VariantType; Value = $decoded.Values[$valueIndex] }
            }
        } elseif ($presets.ContainsKey($category) -and $presets[$category].ContainsKey($assemblyName)) {
            $cells = $presets[$category][$assemblyName]
        }
        $assemblyCellCache[$cacheKey] = $cells
        return $cells
    }

    function Build-CategoryBlobs([string]$category, [object[]]$assemblyNames, [hashtable]$overrides) {
        # One blob per column: material columns replicated from each row's resolved assembly,
        # overrides as given. Returns $null when any assembly is unresolvable.
        $resolved = @()
        $missing = @()
        foreach ($name in $assemblyNames) {
            $cells = Get-AssemblyCells $category ([string]$name)
            if ($null -eq $cells) { $missing += [string]$name } else { $resolved += ,$cells }
        }
        if ($missing.Count -gt 0) { return @{ Missing = @($missing | Sort-Object -Unique) } }
        $blobs = @{}
        foreach ($column in $materialColumns[$category]) {
            $perRow = @(foreach ($cells in $resolved) { $cells[$column].Value })
            $blobs[$column] = Write-Serialized $resolved[0][$column].VariantType $perRow
        }
        foreach ($column in $overrides.Keys) {
            $spec = $overrides[$column]   # @{ Type = uint16; Values = object[] }
            $blobs[$column] = Write-Serialized $spec.Type $spec.Values
        }
        return @{ Blobs = $blobs }
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

    function Build-RoomBlobs([object]$room) {
        # The five category blob groups for one RhvacRoom-shaped object; shared by every lane.
        # A category whose assemblies cannot be resolved lands as one explicit zero row and is
        # reported in Fallbacks -- never guessed.
        $blobs = @{}
        $fallbacks = @()

        function Add-Category([string]$category, [object[]]$assemblyNames, [hashtable]$overrides) {
            $built = Build-CategoryBlobs $category $assemblyNames $overrides
            if ($built.ContainsKey('Missing')) {
                $script:categoryFallback = $built.Missing
                return Build-PlaceholderBlobs $category
            }
            $script:categoryFallback = $null
            return $built.Blobs
        }

        $floors = @($room.Floors)
        if ($floors.Count -eq 0) { $blobs += Build-PlaceholderBlobs 'Floor' }
        else {
            $blobs += Add-Category 'Floor' @($floors | ForEach-Object { $_.Assembly.Name }) @{
                FloorUValue = @{ Type = $single; Values = @($floors | ForEach-Object { [single]$_.Assembly.UValue }) }
                FloorLength = @{ Type = $single; Values = @($floors | ForEach-Object { [single]$_.AreaSquareFeet }) }
                FloorWidth = @{ Type = $single; Values = @($floors | ForEach-Object { [single]1 }) }
                FloorPerimeter = @{ Type = $single; Values = @($floors | ForEach-Object { [single]$_.ExposedPerimeterFeet }) }
            }
            if ($script:categoryFallback) { $fallbacks += ,@{ category = 'floors'; assemblies = $script:categoryFallback } }
        }

        $roofs = @($room.Roofs)
        if ($roofs.Count -eq 0) { $blobs += Build-PlaceholderBlobs 'Roof' }
        else {
            $blobs += Add-Category 'Roof' @($roofs | ForEach-Object { $_.Assembly.Name }) @{
                RoofUValue = @{ Type = $single; Values = @($roofs | ForEach-Object { [single]$_.Assembly.UValue }) }
                RoofLength = @{ Type = $single; Values = @($roofs | ForEach-Object { [single]$_.AreaSquareFeet }) }
                RoofWidth = @{ Type = $single; Values = @($roofs | ForEach-Object { [single]$_.AreaMultiplier }) }
            }
            if ($script:categoryFallback) { $fallbacks += ,@{ category = 'roofs'; assemblies = $script:categoryFallback } }
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
            $blobs += Add-Category 'Wall' @($walls | ForEach-Object { $_.Assembly.Name }) @{
                WallUValue = @{ Type = $single; Values = @($walls | ForEach-Object { [single]$_.Assembly.UValue }) }
                WallLength = @{ Type = $single; Values = @($walls | ForEach-Object { [single]$_.LengthFeet }) }
                WallHeight = @{ Type = $single; Values = @($walls | ForEach-Object { [single]$_.HeightFeet }) }
                WallDirection = @{ Type = $integer; Values = @($walls | ForEach-Object { [int]$_.Direction }) }
            }
            if ($script:categoryFallback) {
                $fallbacks += ,@{ category = 'walls'; assemblies = $script:categoryFallback }
                # Walls fell back to a zero row, so the ordinals glass/doors reference no longer
                # exist. Their categories go to zero rows too rather than dangle.
                $walls = @()
                $glassRows = @()
                $doorRows = @()
            }
        }

        if ($glassRows.Count -eq 0) { $blobs += Build-PlaceholderBlobs 'Glass' }
        else {
            $blobs += Add-Category 'Glass' @($glassRows | ForEach-Object { $_[0].Assembly.Name }) @{
                GlassUValue = @{ Type = $single; Values = @($glassRows | ForEach-Object { [single]$_[0].Assembly.UValue }) }
                GlassSHGC = @{ Type = $single; Values = @($glassRows | ForEach-Object { [single]$_[0].SolarHeatGainCoefficient }) }
                GlassWidth = @{ Type = $single; Values = @($glassRows | ForEach-Object { [single]$_[0].WidthFeet }) }
                GlassHeight = @{ Type = $single; Values = @($glassRows | ForEach-Object { [single]$_[0].HeightFeet }) }
                GlassReference = @{ Type = $integer; Values = @($glassRows | ForEach-Object { [int]$_[1] }) }
                GlassOccurrences = @{ Type = $integer; Values = @($glassRows | ForEach-Object { [int]$_[0].Occurrences }) }
            }
            if ($script:categoryFallback) {
                $fallbacks += ,@{ category = 'glass'; assemblies = $script:categoryFallback }
                $glassRows = @()
            }
        }

        if ($doorRows.Count -eq 0) { $blobs += Build-PlaceholderBlobs 'Door' }
        else {
            $blobs += Add-Category 'Door' @($doorRows | ForEach-Object { $_[0].Assembly.Name }) @{
                DoorUValue = @{ Type = $single; Values = @($doorRows | ForEach-Object { [single]$_[0].Assembly.UValue }) }
                DoorWidth = @{ Type = $single; Values = @($doorRows | ForEach-Object { [single]$_[0].WidthFeet }) }
                DoorHeight = @{ Type = $single; Values = @($doorRows | ForEach-Object { [single]$_[0].HeightFeet }) }
                DoorReference = @{ Type = $integer; Values = @($doorRows | ForEach-Object { [int]$_[1] }) }
            }
            if ($script:categoryFallback) {
                $fallbacks += ,@{ category = 'doors'; assemblies = $script:categoryFallback }
                $doorRows = @()
            }
        }

        return @{ Blobs = $blobs; Walls = $walls; GlassRows = $glassRows; DoorRows = $doorRows; Fallbacks = @($fallbacks) }
    }

    function Write-RoomBlobColumns([object]$transaction, [int]$identifier, [hashtable]$blobs, [string]$label) {
        if ($blobs.Count -eq 0) { return }
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
        if ($update.ExecuteNonQuery() -ne 1) { throw "Blob update failed for room $label" }
        $update.Dispose()
    }

    function Assert-RoomReadBack([int]$identifier, [object]$room, [hashtable]$built) {
        # Read-back verification: counts and references must match the input exactly.
        $verify = $connection.CreateCommand()
        $verify.CommandText = "SELECT Number, Description, Length, Height, VentilationCFM, WallLength, WallDirection, GlassReference, DoorReference FROM [Room] WHERE Identifier = $identifier"
        $verifyReader = $verify.ExecuteReader()
        if (!$verifyReader.Read()) { throw "Room $($room.Number) could not be read back" }
        $backNumber = $verifyReader.GetInt32(0)
        $backName = $verifyReader.GetString(1)
        $backVentilation = $verifyReader.GetDouble(4)
        $backWalls = Read-Serialized $verifyReader.GetValue(5)
        $backDirections = Read-Serialized $verifyReader.GetValue(6)
        $backGlassRefs = Read-Serialized $verifyReader.GetValue(7)
        $backDoorRefs = Read-Serialized $verifyReader.GetValue(8)
        $verifyReader.Dispose()
        $verify.Dispose()
        if ($backNumber -ne [int]$room.Number -or $backName -ne [string]$room.Name) {
            throw "Read-back mismatch for room $($room.Number): number/name"
        }
        if ($backVentilation -ne [double]$room.InternalLoads.VentilationCfm) {
            throw "Read-back mismatch for room $($room.Number): ventilation"
        }
        if ($built.Walls.Count -gt 0) {
            $expectedDirections = (@($built.Walls | ForEach-Object { [int]$_.Direction }) -join ',')
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
        if ($built.GlassRows.Count -gt 0 -and (($backGlassRefs.Values -join ',') -ne (@($built.GlassRows | ForEach-Object { $_[1] }) -join ','))) {
            throw "Read-back mismatch for room $($room.Number): glass references"
        }
        if ($built.DoorRows.Count -gt 0 -and (($backDoorRefs.Values -join ',') -ne (@($built.DoorRows | ForEach-Object { $_[1] }) -join ','))) {
            throw "Read-back mismatch for room $($room.Number): door references"
        }
    }

    # --- Per-room operations, shared by the insert / edit / sync lanes -------------------------

    $assemblyFallbacks = [Collections.Generic.List[object]]::new()

    function Add-AssemblyFallbacks([object]$room, [hashtable]$built) {
        foreach ($fallback in @($built.Fallbacks)) {
            [void]$assemblyFallbacks.Add([ordered]@{
                roomNumber = [int]$room.Number
                roomName = [string]$room.Name
                category = $fallback.category
                assemblies = @($fallback.assemblies)
            })
            "FALLBACK room $($room.Number) '$($room.Name)' $($fallback.category): assembly not in the file or the preset catalog [$($fallback.assemblies -join '; ')] -- category written as one zero row"
        }
    }

    # Add-Room writes its progress line to stdout like every other lane operation, so it publishes
    # the new autonumber PK here instead of returning it (a return would ride the same pipeline).
    $script:lastInsertedIdentifier = 0

    function Add-Room([object]$room) {
        if ($existingNumbers.Contains([int]$room.Number)) { throw "Room number $($room.Number) already exists in the target file." }
        [void]$existingNumbers.Add([int]$room.Number)

        $built = Build-RoomBlobs $room

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
    PeopleNumber = ?, LightingWatts = ?, EquipmentSensible = ?, EquipmentLatent = ?, VentilationCFM = ?,
    Occurrences = 1, CalculationMode = 0
WHERE Identifier = ?
'@
        foreach ($value in @([int]$room.SystemNumber, [int]$room.ZoneNumber, [double]$room.AreaSquareFeet,
                [double]$room.CeilingHeightFeet, [int]$loads.People, [int][Math]::Round($loads.LightingWatts),
                [double]$loads.SensibleEquipmentBtuh, [double]$loads.LatentEquipmentBtuh,
                [double]$loads.VentilationCfm, $identifier)) {
            $parameter = $scalar.CreateParameter()
            $parameter.Value = $value
            [void]$scalar.Parameters.Add($parameter)
        }
        if ($scalar.ExecuteNonQuery() -ne 1) { throw "Scalar update failed for room $($room.Number)" }
        $scalar.Dispose()

        Write-RoomBlobColumns $transaction $identifier $built.Blobs "$($room.Number)"

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

        Assert-RoomReadBack $identifier $room $built
        $numberByIdentifier[$identifier] = [int]$room.Number
        Add-AssemblyFallbacks $room $built
        $script:lastInsertedIdentifier = $identifier
        "Room $($room.Number) '$($room.Name)': identifier=$identifier walls=$($built.Walls.Count) glass=$($built.GlassRows.Count) doors=$($built.DoorRows.Count) floors=$(@($room.Floors).Count) roofs=$(@($room.Roofs).Count) OK"
    }

    function Update-Room([object]$room) {
        $identifier = [int]$room.Identifier
        if (!$numberByIdentifier.ContainsKey($identifier)) { throw "No room with Identifier $identifier in $inputPath" }
        foreach ($pair in @($numberByIdentifier.GetEnumerator())) {
            if ($pair.Key -ne $identifier -and $pair.Value -eq [int]$room.Number) {
                throw "Room number $($room.Number) already belongs to Identifier $($pair.Key)."
            }
        }
        $built = Build-RoomBlobs $room

        # Jet's bulk LONGBINARY update mangles adjacent LONGCHAR values, so read the room's
        # notes up front and rewrite them verbatim after the blob write (Description gets the
        # edited name).
        $notesCommand = $connection.CreateCommand()
        $notesCommand.CommandText = "SELECT RoomNotes, RoomNotesPlainText FROM [Room] WHERE Identifier = $identifier"
        $notesReader = $notesCommand.ExecuteReader()
        [void]$notesReader.Read()
        $roomNotes = $notesReader.GetValue(0)
        $roomNotesPlain = $notesReader.GetValue(1)
        $notesReader.Dispose()
        $notesCommand.Dispose()

        $transaction = $connection.BeginTransaction()

        $scalar = $connection.CreateCommand()
        $scalar.Transaction = $transaction
        # [Number] must be bracketed: it is a Jet reserved word in SET position.
        $scalar.CommandText = @'
UPDATE [Room]
SET [Number] = ?, [SystemNumber] = ?, [ZoneNumber] = ?, [Length] = ?, [Width] = 1, [Height] = ?,
    [PeopleNumber] = ?, [LightingWatts] = ?, [EquipmentSensible] = ?, [EquipmentLatent] = ?, [VentilationCFM] = ?
WHERE [Identifier] = ?
'@
        $loads = $room.InternalLoads
        foreach ($value in @([int]$room.Number, [int]$room.SystemNumber, [int]$room.ZoneNumber,
                [double]$room.AreaSquareFeet, [double]$room.CeilingHeightFeet, [int]$loads.People,
                [double]$loads.LightingWatts, [double]$loads.SensibleEquipmentBtuh,
                [double]$loads.LatentEquipmentBtuh, [double]$loads.VentilationCfm, $identifier)) {
            $parameter = $scalar.CreateParameter()
            $parameter.Value = $value
            [void]$scalar.Parameters.Add($parameter)
        }
        if ($scalar.ExecuteNonQuery() -ne 1) { throw "Scalar update failed for room Identifier $identifier" }
        $scalar.Dispose()

        Write-RoomBlobColumns $transaction $identifier $built.Blobs "Identifier $identifier"

        $name = $connection.CreateCommand()
        $name.Transaction = $transaction
        $name.CommandText = 'UPDATE [Room] SET [Description] = ?, [RoomNotes] = ?, [RoomNotesPlainText] = ? WHERE [Identifier] = ?'
        [void]$name.Parameters.Add('@description', [System.Data.Odbc.OdbcType]::VarChar, 255)
        [void]$name.Parameters.Add('@notes', [System.Data.Odbc.OdbcType]::Text)
        [void]$name.Parameters.Add('@notesPlain', [System.Data.Odbc.OdbcType]::Text)
        [void]$name.Parameters.Add('@identifier', [System.Data.Odbc.OdbcType]::Int)
        $name.Parameters[0].Value = [string]$room.Name
        $name.Parameters[1].Value = $roomNotes
        $name.Parameters[2].Value = $roomNotesPlain
        $name.Parameters[3].Value = $identifier
        if ($name.ExecuteNonQuery() -ne 1) { throw "Name update failed for room Identifier $identifier" }
        $name.Dispose()

        $transaction.Commit()
        $transaction.Dispose()

        Assert-RoomReadBack $identifier $room $built
        $numberByIdentifier[$identifier] = [int]$room.Number
        Add-AssemblyFallbacks $room $built
        "Updated Identifier=$identifier number=$($room.Number) '$($room.Name)': walls=$($built.Walls.Count) glass=$($built.GlassRows.Count) doors=$($built.DoorRows.Count) floors=$(@($room.Floors).Count) roofs=$(@($room.Roofs).Count) OK"
    }

    function Remove-Room([int]$identifier) {
        if (!$numberByIdentifier.ContainsKey($identifier)) { throw "No room with Identifier $identifier in $inputPath" }

        # Duct sizing rows (TabularManualDDuctsize) reference rooms by Identifier -- a direct
        # RoomIdentifier plus a comma-list ReturnRunoutRoomIdentifiers. Deleting a referenced
        # room would silently corrupt the duct design, so refuse: the engineer detaches the
        # room in RHVAC's duct sizing first. (Nothing else references rooms; see README.)
        $referenceCommand = $connection.CreateCommand()
        $referenceCommand.CommandText = "SELECT COUNT(*) FROM [TabularManualDDuctsize] WHERE RoomIdentifier = $identifier OR (',' + ReturnRunoutRoomIdentifiers + ',') LIKE '%,$identifier,%'"
        $referenceCount = [int]$referenceCommand.ExecuteScalar()
        $referenceCommand.Dispose()
        if ($referenceCount -gt 0) {
            throw "Room Identifier $identifier is referenced by $referenceCount duct sizing row(s); detach it in RHVAC's duct sizing before deleting."
        }

        $delete = $connection.CreateCommand()
        $delete.CommandText = "DELETE FROM [Room] WHERE Identifier = $identifier"
        if ($delete.ExecuteNonQuery() -ne 1) { throw "Delete failed for room Identifier $identifier" }
        $delete.Dispose()
        [void]$existingNumbers.Remove($numberByIdentifier[$identifier])
        $numberByIdentifier.Remove($identifier)
        "Deleted Identifier=$identifier"
    }

    # --- Lanes --------------------------------------------------------------------------------

    if ($isEdit) {
        foreach ($room in $updates) { Update-Room $room }
        foreach ($identifierRaw in $deletes) { Remove-Room ([int]$identifierRaw) }
        "EDITED $($updates.Count) update(s), $($deletes.Count) delete(s) -> $outputPath"
    }
    elseif ($isSync) {
        # 1. First-run System seeding owns exactly Number + Description. Every other field remains
        #    NULL/default and is configured by the engineer in RHVAC.

        function Get-SystemMap {
            $map = @{}
            $systemCommand = $connection.CreateCommand()
            $systemCommand.CommandText = 'SELECT [Number], Identifier, Description FROM [System] ORDER BY [Number]'
            $systemReader = $systemCommand.ExecuteReader()
            while ($systemReader.Read()) {
                $map[$systemReader.GetInt32(0)] = @{
                    Identifier = $systemReader.GetInt32(1)
                    Name = $(if ($systemReader.IsDBNull(2)) { '' } else { $systemReader.GetString(2) })
                }
            }
            $systemReader.Dispose()
            $systemCommand.Dispose()
            return $map
        }

        $systemMap = Get-SystemMap
        $seededSystems = [Collections.Generic.List[object]]::new()
        foreach ($system in $seedSystems) {
            $number = [int]$system.Number
            $systemName = [string]$system.Name
            if ($systemMap.ContainsKey($number)) {
                # Idempotent: an existing system is left exactly as the engineer has it, never renamed.
                [void]$seededSystems.Add([ordered]@{
                    number = $number; name = $systemMap[$number].Name
                    identifier = $systemMap[$number].Identifier; seeded = $false
                })
                "System $number already exists ('$($systemMap[$number].Name)'); left untouched"
                continue
            }
            $systemInsert = $connection.CreateCommand()
            $systemInsert.CommandText = 'INSERT INTO [System] ([Number], [Description]) VALUES (?, ?)'
            [void]$systemInsert.Parameters.Add('@number', [System.Data.Odbc.OdbcType]::Int)
            [void]$systemInsert.Parameters.Add('@description', [System.Data.Odbc.OdbcType]::VarChar, 255)
            $systemInsert.Parameters[0].Value = $number
            $systemInsert.Parameters[1].Value = $systemName
            if ($systemInsert.ExecuteNonQuery() -ne 1) { throw "System insert failed for Number $number" }
            $systemInsert.Dispose()
            $systemMap = Get-SystemMap
            if (!$systemMap.ContainsKey($number)) { throw "System $number could not be read back after insert" }
            if ($systemMap[$number].Name -ne $systemName) {
                throw "System $number read back as '$($systemMap[$number].Name)', expected '$systemName'"
            }
            [void]$seededSystems.Add([ordered]@{
                number = $number; name = $systemName
                identifier = $systemMap[$number].Identifier; seeded = $true
            })
            "Seeded System $number '$systemName' (identifier=$($systemMap[$number].Identifier))"
        }

        # Jet does not enforce Room.SystemNumber -> System.Number. Refuse orphans before writing.
        foreach ($room in @($rooms) + @($updates)) {
            if (!$systemMap.ContainsKey([int]$room.SystemNumber)) {
                throw "Room $($room.Number) references System $($room.SystemNumber), which does not exist in the target file (systems: $(($systemMap.Keys | Sort-Object) -join ', ')). Seed it or fix the room."
            }
        }

        # 2. Inserts, 3. updates, 4. explicit deletes.
        $insertedRooms = [Collections.Generic.List[object]]::new()
        foreach ($room in $rooms) {
            Add-Room $room
            [void]$insertedRooms.Add([ordered]@{
                number = [int]$room.Number; name = [string]$room.Name
                identifier = $script:lastInsertedIdentifier
            })
        }
        foreach ($room in $updates) { Update-Room $room }
        foreach ($identifierRaw in $deletes) { Remove-Room ([int]$identifierRaw) }

        # 5. The template's blank seed room, LAST: the insert lane clones assembly code fields out
        #    of rows already in the file, and in the firm template this room is the only such row.
        $seedRoomIdentifier = 1
        $seedRoomReport = [ordered]@{ identifier = $seedRoomIdentifier; action = 'not-requested'; reason = '' }
        if ($deleteSeedRoom) {
            if (!$numberByIdentifier.ContainsKey($seedRoomIdentifier)) {
                $seedRoomReport.action = 'kept'
                $seedRoomReport.reason = "no room with Identifier $seedRoomIdentifier exists"
            } else {
                $seedCommand = $connection.CreateCommand()
                $seedCommand.CommandText = "SELECT * FROM [Room] WHERE Identifier = $seedRoomIdentifier"
                $seedAdapter = [System.Data.Odbc.OdbcDataAdapter]::new($seedCommand)
                $seedTable = [System.Data.DataTable]::new()
                [void]$seedAdapter.Fill($seedTable)
                $seedAdapter.Dispose()
                $seedCommand.Dispose()
                $seedRow = $seedTable.Rows[0]

                # "Untouched" means byte/scalar equality with DefaultRoom across every shared column,
                # plus a blank Description. This deliberately keeps the row on any ambiguity.
                $reasons = @()
                if (-not [string]::IsNullOrWhiteSpace([string]$seedRow['Description'])) { $reasons += "name is '$($seedRow['Description'])'" }
                $defaultAdapter = [System.Data.Odbc.OdbcDataAdapter]::new('SELECT * FROM [DefaultRoom]', $connection)
                $defaultTable = [System.Data.DataTable]::new()
                [void]$defaultAdapter.Fill($defaultTable)
                $defaultAdapter.Dispose()
                if ($defaultTable.Rows.Count -ne 1) {
                    $reasons += "DefaultRoom has $($defaultTable.Rows.Count) rows"
                } else {
                    $defaultRow = $defaultTable.Rows[0]
                    foreach ($column in $defaultTable.Columns) {
                        $name = $column.ColumnName
                        $left = $seedRow[$name]
                        $right = $defaultRow[$name]
                        $equal = if ($left -is [DBNull] -and $right -is [DBNull]) { $true }
                            elseif ($left -is [byte[]] -and $right -is [byte[]]) {
                                [BitConverter]::ToString($left) -eq [BitConverter]::ToString($right)
                            } else { $left -eq $right }
                        if (!$equal) { $reasons += "$name differs from DefaultRoom" }
                    }
                }
                if ($reasons.Count -gt 0) {
                    $seedRoomReport.action = 'kept'
                    $seedRoomReport.reason = "room has been edited: $($reasons -join '; ')"
                    "SEED ROOM KEPT (Identifier $seedRoomIdentifier): $($seedRoomReport.reason)"
                } else {
                    Remove-Room $seedRoomIdentifier | Out-Null
                    $seedRoomReport.action = 'deleted'
                    $seedRoomReport.reason = 'blank template row exactly matches DefaultRoom'
                    "SEED ROOM DELETED (Identifier $seedRoomIdentifier)"
                }
            }
        }

        # 6. fileIdentity. The .r10 schema carries NO GUID or stable id of any kind (probed: the
        #    Project table is 9 free-text/flag columns, Client 9, Version 6 build numbers). The
        #    strongest available identity is therefore the file name plus a stamp over the
        #    engineer-facing project/client titles: it survives a copy or a rename of the file, and
        #    it CHANGES when the engineer retitles the project. Both halves are reported so the
        #    caller can detect drift instead of silently trusting a match.
        $projectCommand = $connection.CreateCommand()
        $projectCommand.CommandText = 'SELECT ProjectTitle FROM [Project]'
        $projectTitle = [string]$projectCommand.ExecuteScalar()
        $projectCommand.Dispose()
        $clientCommand = $connection.CreateCommand()
        $clientCommand.CommandText = 'SELECT ClientName FROM [Client]'
        $clientName = [string]$clientCommand.ExecuteScalar()
        $clientCommand.Dispose()
        $stampSource = $projectTitle + [char]0 + $clientName
        $stampBytes = [Security.Cryptography.SHA256]::Create().ComputeHash([Text.Encoding]::UTF8.GetBytes($stampSource))
        $fileIdentity = [ordered]@{
            fileName = [IO.Path]::GetFileName($inputPath)
            projectTitle = $projectTitle
            clientName = $clientName
            stamp = ([BitConverter]::ToString($stampBytes) -replace '-').Substring(0, 16).ToLowerInvariant()
        }

        $result = [ordered]@{
            outputPath = $outputPath
            fileIdentity = $fileIdentity
            systems = @($seededSystems)
            insertedRooms = @($insertedRooms)
            updated = $updates.Count
            deleted = @($deletes | ForEach-Object { [int]$_ })
            seedRoom = $seedRoomReport
            assemblyFallbacks = @($assemblyFallbacks)
            roomCount = $numberByIdentifier.Count
        }
        if ($ResultJson) {
            $result | ConvertTo-Json -Depth 8 | Out-File -LiteralPath $ResultJson -Encoding utf8
        }
        "SYNCED systems=$($seededSystems.Count) inserted=$($insertedRooms.Count) updated=$($updates.Count) deleted=$(@($deletes).Count) seedRoom=$($seedRoomReport.action) fallbacks=$($assemblyFallbacks.Count) -> $outputPath"
    }
    else {
        foreach ($room in $rooms) { Add-Room $room }
        "EXPORTED $($rooms.Count) room(s) -> $outputPath"
    }
} finally {
    $connection.Dispose()
}
