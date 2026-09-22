# Edit-lane round-trip self-check against a real .r10 file. Proves: extract -> apply a known edit
# set (one room's area + a wall length + a glass width, delete one room) -> re-extract, and the
# projection diff is EXACTLY the intended changes — every other room, system, and building total
# is byte-identical in projection. Also smoke-checks the -Assemblies listing mode.
#
# Runs from any PowerShell (it spawns the 32-bit Jet lane itself):
#   powershell -File eval/rhvac/edit-check.ps1
# Default source is the private project-a copy; outputs land next to it (also gitignored).
param(
    [string]$Project = (Join-Path ($env:PE_PRIVATE_FIXTURES ?? (Join-Path $PSScriptRoot '..\..\.privateixtures')) 'project-ahvac'),
    [string]$SourceR10 = (Join-Path $Project 'local.r10'),
    [string]$WorkDir = $Project
)

$ErrorActionPreference = 'Stop'
$ps32 = 'C:\Windows\SysWOW64\WindowsPowerShell\v1.0\powershell.exe'
$rhvacDir = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\..\dotnet\Pe.Revit.Takeoff\Rhvac'))
$extractScript = Join-Path $rhvacDir 'extract-rhvac.ps1'
$exportScript = Join-Path $rhvacDir 'export-rhvac.ps1'
if (![IO.File]::Exists($SourceR10)) { throw "Source .r10 not found: $SourceR10 (copy the engineer's file here first; see oracle.source.txt)" }

$beforeJson = Join-Path $WorkDir 'edit-check.before.json'
$afterJson = Join-Path $WorkDir 'edit-check.after.json'
$assembliesJson = Join-Path $WorkDir 'edit-check.assemblies.json'
$editsJson = Join-Path $WorkDir 'edit-check.edits.json'
$outputR10 = Join-Path $WorkDir 'edit-check.out.r10'

function Invoke-Lane32([string[]]$laneArguments) {
    & $ps32 -NoProfile -ExecutionPolicy Bypass @laneArguments
    if ($LASTEXITCODE -ne 0) { throw "32-bit lane failed: $($laneArguments -join ' ')" }
}

function ConvertTo-CanonicalJson([object]$value) {
    return ($value | ConvertTo-Json -Depth 10 -Compress)
}

$failures = [Collections.Generic.List[string]]::new()
function Assert-True([bool]$condition, [string]$message) {
    if (!$condition) { [void]$failures.Add($message) }
}

# --- 1. Extract the source projection ---
Invoke-Lane32 @('-File', $extractScript, '-Path', $SourceR10, '-Output', $beforeJson)
$before = Get-Content -LiteralPath $beforeJson -Raw | ConvertFrom-Json

# --- 2. Pick targets. The update room needs a projection that survives blob regeneration
# unchanged: compacted wall ordinals (index1 == 1..N), in-range references, and glass/door rows
# already in wall-major order (regeneration nests openings under walls, which re-emits them
# wall-major). Real rooms with zero-row padding would legitimately re-project with renumbered
# ordinals — excluded here so the diff stays exactly the intended edits. ---
function Test-EditableRoom([object]$room) {
    $walls = @($room.walls)
    $glass = @($room.glass)
    if ($walls.Count -lt 1 -or $glass.Count -lt 1) { return $false }
    for ($i = 0; $i -lt $walls.Count; $i++) { if ([int]$walls[$i].index1 -ne $i + 1) { return $false } }
    foreach ($rows in @(,$glass; ,@($room.doors))) {
        $previous = 1
        foreach ($opening in $rows) {
            $reference = [int]$opening.wallReference
            if ($reference -lt 1 -or $reference -gt $walls.Count -or $reference -lt $previous) { return $false }
            $previous = $reference
        }
    }
    return $true
}

$target = @($before.rooms | Where-Object { Test-EditableRoom $_ }) | Select-Object -First 1
if ($null -eq $target) { throw 'No editable room found (walls + glass with compacted ordinals); pick another source file.' }
$victim = @($before.rooms | Where-Object { $_.identifier -ne $target.identifier }) | Select-Object -Last 1
if ($null -eq $victim) { throw 'Need at least two rooms.' }

$newArea = [double]$target.areaSquareFeet + 25
$newWallLength = [double]$target.walls[0].lengthFeet + 2
$newGlassWidth = [double]$target.glass[0].widthFeet + 0.5

# --- 3. Build the edits payload (RhvacRoom shape + Identifier) from the extract projection ---
$wallsOut = @()
for ($i = 0; $i -lt @($target.walls).Count; $i++) {
    $wall = $target.walls[$i]
    $windows = @(foreach ($g in @($target.glass)) {
        if ([int]$g.wallReference -ne [int]$wall.index1) { continue }
        $width = [double]$g.widthFeet
        if ([object]::ReferenceEquals($g, $target.glass[0])) { $width = $newGlassWidth }
        [ordered]@{
            Assembly = [ordered]@{ Name = $g.assembly; UValue = $g.uValue }
            WidthFeet = $width
            HeightFeet = $g.heightFeet
            SolarHeatGainCoefficient = $g.shgc
            Occurrences = $g.occurrences
        }
    })
    $doors = @(foreach ($d in @($target.doors)) {
        if ([int]$d.wallReference -ne [int]$wall.index1) { continue }
        [ordered]@{
            Assembly = [ordered]@{ Name = $d.assembly; UValue = $d.uValue }
            WidthFeet = $d.widthFeet
            HeightFeet = $d.heightFeet
        }
    })
    $length = [double]$wall.lengthFeet
    if ($i -eq 0) { $length = $newWallLength }
    $wallsOut += [ordered]@{
        Assembly = [ordered]@{ Name = $wall.assembly; UValue = $wall.uValue }
        LengthFeet = $length
        HeightFeet = $wall.heightFeet
        Direction = $wall.direction
        Windows = $windows
        Doors = $doors
    }
}
$updatePayload = [ordered]@{
    Identifier = $target.identifier
    Number = $target.number
    Name = $target.name
    AreaSquareFeet = $newArea
    CeilingHeightFeet = $target.ceilingHeightFeet
    SystemNumber = $target.systemNumber
    ZoneNumber = $target.zoneNumber
    InternalLoads = [ordered]@{
        People = $target.people
        SensibleEquipmentBtuh = $target.equipmentSensibleBtuh
        LatentEquipmentBtuh = $target.equipmentLatentBtuh
        LightingWatts = $target.lightingWatts
    }
    Floors = @(foreach ($f in @($target.floors)) {
        [ordered]@{
            Assembly = [ordered]@{ Name = $f.assembly; UValue = $f.uValue }
            AreaSquareFeet = $f.areaSquareFeet
            ExposedPerimeterFeet = $f.exposedPerimeterFeet
        }
    })
    Roofs = @(foreach ($r in @($target.roofs)) {
        [ordered]@{
            Assembly = [ordered]@{ Name = $r.assembly; UValue = $r.uValue }
            AreaSquareFeet = $r.areaSquareFeet
            AreaMultiplier = $r.areaMultiplier
        }
    })
    Walls = $wallsOut
}
[ordered]@{
    updates = @($updatePayload)
    deletes = @($victim.identifier)
} | ConvertTo-Json -Depth 10 | Out-File -LiteralPath $editsJson -Encoding utf8

"TARGET update: Identifier=$($target.identifier) number=$($target.number) '$($target.name)' (area $($target.areaSquareFeet) -> $newArea, wall1 $($target.walls[0].lengthFeet) -> $newWallLength, glass1 width $($target.glass[0].widthFeet) -> $newGlassWidth)"
"TARGET delete: Identifier=$($victim.identifier) number=$($victim.number) '$($victim.name)'"

# --- 4. Apply the edit set and re-extract ---
Invoke-Lane32 @('-File', $exportScript, '-EditsJson', $editsJson, '-Source', $SourceR10, '-Output', $outputR10)
Invoke-Lane32 @('-File', $extractScript, '-Path', $outputR10, '-Output', $afterJson)
$after = Get-Content -LiteralPath $afterJson -Raw | ConvertFrom-Json

# --- 5. Assert the diff is exactly the intended changes ---
Assert-True ($after.rooms.Count -eq $before.rooms.Count - 1) "Room count: expected $($before.rooms.Count - 1), got $($after.rooms.Count)"
Assert-True (@($after.rooms | Where-Object { $_.identifier -eq $victim.identifier }).Count -eq 0) "Deleted room Identifier=$($victim.identifier) still present"
Assert-True ((ConvertTo-CanonicalJson $after.building) -eq (ConvertTo-CanonicalJson $before.building)) 'Building totals changed'
Assert-True ((ConvertTo-CanonicalJson $after.systems) -eq (ConvertTo-CanonicalJson $before.systems)) 'Systems changed'

$afterById = @{}
foreach ($room in $after.rooms) { $afterById[[int]$room.identifier] = $room }
foreach ($room in $before.rooms) {
    $identifier = [int]$room.identifier
    if ($identifier -eq [int]$victim.identifier) { continue }
    if (!$afterById.ContainsKey($identifier)) { Assert-True $false "Room Identifier=$identifier missing after edit"; continue }
    if ($identifier -eq [int]$target.identifier) { continue }
    Assert-True ((ConvertTo-CanonicalJson $afterById[$identifier]) -eq (ConvertTo-CanonicalJson $room)) "Untouched room Identifier=$identifier changed in projection"
}

$targetAfter = $afterById[[int]$target.identifier]
if ($null -eq $targetAfter) { Assert-True $false "Updated room Identifier=$($target.identifier) missing" }
else {
    Assert-True ([Math]::Abs([double]$targetAfter.areaSquareFeet - $newArea) -lt 0.01) "Updated area: expected $newArea, got $($targetAfter.areaSquareFeet)"
    Assert-True ([Math]::Abs([double]$targetAfter.walls[0].lengthFeet - $newWallLength) -lt 0.01) "Updated wall length: expected $newWallLength, got $($targetAfter.walls[0].lengthFeet)"
    Assert-True ([Math]::Abs([double]$targetAfter.glass[0].widthFeet - $newGlassWidth) -lt 0.01) "Updated glass width: expected $newGlassWidth, got $($targetAfter.glass[0].widthFeet)"
    # Neutralize the three intended fields (float32 quantization makes exact prediction fragile),
    # then the rest of the room must be projection-identical to before.
    $targetAfter.areaSquareFeet = $target.areaSquareFeet
    $targetAfter.walls[0].lengthFeet = $target.walls[0].lengthFeet
    $targetAfter.glass[0].widthFeet = $target.glass[0].widthFeet
    Assert-True ((ConvertTo-CanonicalJson $targetAfter) -eq (ConvertTo-CanonicalJson $target)) 'Updated room changed outside the intended fields'
}

# --- 6. Assemblies listing mode ---
Invoke-Lane32 @('-File', $extractScript, '-Path', $SourceR10, '-Output', $assembliesJson, '-Assemblies')
$assemblies = Get-Content -LiteralPath $assembliesJson -Raw | ConvertFrom-Json
foreach ($category in 'floors', 'roofs', 'walls', 'glass', 'doors') {
    Assert-True (@($assemblies.$category).Count -gt 0) "Assemblies listing: no $category entries"
}
Assert-True (@($assemblies.walls | Where-Object { $_.name -eq $target.walls[0].assembly }).Count -eq 1) 'Assemblies listing missing the update room wall assembly'

if ($failures.Count -gt 0) {
    ''
    "EDIT-CHECK FAIL ($($failures.Count) assertion(s)):"
    $failures | ForEach-Object { "  - $_" }
    exit 1
}
''
"EDIT-CHECK PASS: $($before.rooms.Count) rooms -> $($after.rooms.Count); update Identifier=$($target.identifier) exact; delete Identifier=$($victim.identifier) clean; all other rooms projection-identical."
