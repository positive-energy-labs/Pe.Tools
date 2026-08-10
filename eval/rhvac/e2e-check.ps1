# Compares a RhvacCandidateBuilder JSON artifact with an extract of the exported .r10, while
# proving that the source room/system/building projection survived the insert unchanged.
param(
    [Parameter(Mandatory)][string]$CandidateJson,
    [Parameter(Mandatory)][string]$SourceExtract,
    [Parameter(Mandatory)][string]$OutputExtract,
    [int]$NumberOffset = 0,
    [double]$Tolerance = 0.001
)

$ErrorActionPreference = 'Stop'
$expected = Get-Content -LiteralPath $CandidateJson -Raw | ConvertFrom-Json
$source = Get-Content -LiteralPath $SourceExtract -Raw | ConvertFrom-Json
$output = Get-Content -LiteralPath $OutputExtract -Raw | ConvertFrom-Json
$failures = [Collections.Generic.List[string]]::new()
$maxLoss = @{}

function Assert-True([bool]$condition, [string]$message) {
    if (!$condition) { [void]$failures.Add($message) }
}

function Assert-Double([string]$key, [double]$expectedValue, [double]$actualValue, [string]$where) {
    $loss = [Math]::Abs($expectedValue - $actualValue)
    if (!$maxLoss.ContainsKey($key) -or $loss -gt $maxLoss[$key]) { $maxLoss[$key] = $loss }
    Assert-True ($loss -lt $Tolerance) "$where expected=$expectedValue actual=$actualValue"
}

function ConvertTo-CanonicalJson([object]$value) {
    return ($value | ConvertTo-Json -Depth 12 -Compress)
}

Assert-True ($output.rooms.Count -eq $source.rooms.Count + $expected.Count) `
    "room count expected=$($source.rooms.Count + $expected.Count) actual=$($output.rooms.Count)"
Assert-True ((ConvertTo-CanonicalJson $source.building) -eq (ConvertTo-CanonicalJson $output.building)) `
    'stored building projection changed'
Assert-True ((ConvertTo-CanonicalJson $source.systems) -eq (ConvertTo-CanonicalJson $output.systems)) `
    'stored systems projection changed'

$outputByIdentifier = @{}
foreach ($room in $output.rooms) { $outputByIdentifier[[int]$room.identifier] = $room }
foreach ($room in $source.rooms) {
    $identifier = [int]$room.identifier
    Assert-True $outputByIdentifier.ContainsKey($identifier) "source Identifier=$identifier missing"
    if ($outputByIdentifier.ContainsKey($identifier)) {
        Assert-True `
            ((ConvertTo-CanonicalJson $room) -eq (ConvertTo-CanonicalJson $outputByIdentifier[$identifier])) `
            "source Identifier=$identifier changed"
    }
}

$outputByNumber = @{}
foreach ($room in $output.rooms) { $outputByNumber[[int]$room.number] = $room }
foreach ($room in $expected) {
    $number = [int]$room.Number + $NumberOffset
    Assert-True $outputByNumber.ContainsKey($number) "inserted room Number=$number missing"
    if (!$outputByNumber.ContainsKey($number)) { continue }
    $actual = $outputByNumber[$number]

    Assert-True ($actual.name -eq $room.Name) "room $number name"
    Assert-True ([int]$actual.systemNumber -eq [int]$room.SystemNumber) "room $number system"
    Assert-True ([int]$actual.zoneNumber -eq [int]$room.ZoneNumber) "room $number zone"
    Assert-Double roomArea $room.AreaSquareFeet $actual.areaSquareFeet "room $number area"
    Assert-Double ceilingHeight $room.CeilingHeightFeet $actual.ceilingHeightFeet "room $number height"
    Assert-Double people $room.InternalLoads.People $actual.people "room $number people"
    Assert-Double lighting $room.InternalLoads.LightingWatts $actual.lightingWatts "room $number lighting"
    Assert-Double equipmentSensible $room.InternalLoads.SensibleEquipmentBtuh `
        $actual.equipmentSensibleBtuh "room $number sensible equipment"
    Assert-Double equipmentLatent $room.InternalLoads.LatentEquipmentBtuh `
        $actual.equipmentLatentBtuh "room $number latent equipment"

    Assert-True (@($room.Floors).Count -eq @($actual.floors).Count) "room $number floor count"
    for ($index = 0; $index -lt [Math]::Min(@($room.Floors).Count, @($actual.floors).Count); $index++) {
        $expectedFloor = $room.Floors[$index]
        $actualFloor = $actual.floors[$index]
        Assert-True ($expectedFloor.Assembly.Name -eq $actualFloor.assembly) "room $number floor $index assembly"
        Assert-Double floorUValue $expectedFloor.Assembly.UValue $actualFloor.uValue "room $number floor $index U"
        Assert-Double floorArea $expectedFloor.AreaSquareFeet $actualFloor.areaSquareFeet "room $number floor $index area"
        Assert-Double floorPerimeter $expectedFloor.ExposedPerimeterFeet `
            $actualFloor.exposedPerimeterFeet "room $number floor $index perimeter"
    }

    Assert-True (@($room.Roofs).Count -eq @($actual.roofs).Count) "room $number roof count"
    for ($index = 0; $index -lt [Math]::Min(@($room.Roofs).Count, @($actual.roofs).Count); $index++) {
        $expectedRoof = $room.Roofs[$index]
        $actualRoof = $actual.roofs[$index]
        Assert-True ($expectedRoof.Assembly.Name -eq $actualRoof.assembly) "room $number roof $index assembly"
        Assert-Double roofUValue $expectedRoof.Assembly.UValue $actualRoof.uValue "room $number roof $index U"
        Assert-Double roofArea $expectedRoof.AreaSquareFeet $actualRoof.areaSquareFeet "room $number roof $index area"
        Assert-Double roofMultiplier $expectedRoof.AreaMultiplier `
            $actualRoof.areaMultiplier "room $number roof $index multiplier"
    }

    Assert-True (@($room.Walls).Count -eq @($actual.walls).Count) "room $number wall count"
    $expectedGlass = @()
    $expectedDoors = @()
    for ($index = 0; $index -lt [Math]::Min(@($room.Walls).Count, @($actual.walls).Count); $index++) {
        $expectedWall = $room.Walls[$index]
        $actualWall = $actual.walls[$index]
        $ordinal = $index + 1
        Assert-True ([int]$actualWall.index1 -eq $ordinal) "room $number wall $index ordinal"
        Assert-True ($expectedWall.Assembly.Name -eq $actualWall.assembly) "room $number wall $index assembly"
        Assert-True ([int]$expectedWall.Direction -eq [int]$actualWall.direction) "room $number wall $index direction"
        Assert-Double wallUValue $expectedWall.Assembly.UValue $actualWall.uValue "room $number wall $index U"
        Assert-Double wallLength $expectedWall.LengthFeet $actualWall.lengthFeet "room $number wall $index length"
        Assert-Double wallHeight $expectedWall.HeightFeet $actualWall.heightFeet "room $number wall $index height"
        $expectedGlass += @($expectedWall.Windows | ForEach-Object { [pscustomobject]@{ Row = $_; Ordinal = $ordinal } })
        $expectedDoors += @($expectedWall.Doors | ForEach-Object { [pscustomobject]@{ Row = $_; Ordinal = $ordinal } })
    }

    Assert-True ($expectedGlass.Count -eq @($actual.glass).Count) "room $number glass count"
    for ($index = 0; $index -lt [Math]::Min($expectedGlass.Count, @($actual.glass).Count); $index++) {
        $expectedWindow = $expectedGlass[$index]
        $actualWindow = $actual.glass[$index]
        Assert-True ([int]$actualWindow.wallReference -eq $expectedWindow.Ordinal) `
            "room $number glass $index wall reference"
        Assert-True ($actualWindow.assembly -eq $expectedWindow.Row.Assembly.Name) "room $number glass $index assembly"
        Assert-Double glassUValue $expectedWindow.Row.Assembly.UValue $actualWindow.uValue "room $number glass $index U"
        Assert-Double glassWidth $expectedWindow.Row.WidthFeet $actualWindow.widthFeet "room $number glass $index width"
        Assert-Double glassHeight $expectedWindow.Row.HeightFeet $actualWindow.heightFeet "room $number glass $index height"
        Assert-Double glassShgc $expectedWindow.Row.SolarHeatGainCoefficient `
            $actualWindow.shgc "room $number glass $index SHGC"
        Assert-True ([int]$actualWindow.occurrences -eq [int]$expectedWindow.Row.Occurrences) `
            "room $number glass $index occurrences"
    }

    Assert-True ($expectedDoors.Count -eq @($actual.doors).Count) "room $number door count"
    for ($index = 0; $index -lt [Math]::Min($expectedDoors.Count, @($actual.doors).Count); $index++) {
        $expectedDoor = $expectedDoors[$index]
        $actualDoor = $actual.doors[$index]
        Assert-True ([int]$actualDoor.wallReference -eq $expectedDoor.Ordinal) `
            "room $number door $index wall reference"
        Assert-True ($actualDoor.assembly -eq $expectedDoor.Row.Assembly.Name) "room $number door $index assembly"
        Assert-Double doorUValue $expectedDoor.Row.Assembly.UValue $actualDoor.uValue "room $number door $index U"
        Assert-Double doorWidth $expectedDoor.Row.WidthFeet $actualDoor.widthFeet "room $number door $index width"
        Assert-Double doorHeight $expectedDoor.Row.HeightFeet $actualDoor.heightFeet "room $number door $index height"
    }
}

if ($failures.Count -gt 0) {
    ''
    "E2E-CHECK FAIL ($($failures.Count) assertion(s)):"
    $failures | ForEach-Object { "  - $_" }
    exit 1
}

$expectedArea = ($expected | Measure-Object AreaSquareFeet -Sum).Sum
$actualInserts = @($expected | ForEach-Object { $outputByNumber[[int]$_.Number + $NumberOffset] })
$actualArea = ($actualInserts | Measure-Object areaSquareFeet -Sum).Sum
"E2E-CHECK PASS: $($source.rooms.Count) source rooms unchanged; $($expected.Count) inserts exact within $Tolerance; wall/opening references exact."
[pscustomobject]@{
    CandidateAreaSquareFeet = [Math]::Round($expectedArea, 6)
    ReadBackAreaSquareFeet = [Math]::Round($actualArea, 6)
    TotalAreaDeltaSquareFeet = [Math]::Round($actualArea - $expectedArea, 6)
    InsertedWalls = @($actualInserts | ForEach-Object { @($_.walls) }).Count
    InsertedGlass = @($actualInserts | ForEach-Object { @($_.glass) }).Count
    InsertedDoors = @($actualInserts | ForEach-Object { @($_.doors) }).Count
    MaxRoomAreaQuantization = $maxLoss.roomArea
    MaxWallLengthQuantization = $maxLoss.wallLength
} | Format-List
