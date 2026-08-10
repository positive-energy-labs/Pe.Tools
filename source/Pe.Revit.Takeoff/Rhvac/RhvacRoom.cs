namespace Pe.Revit.Takeoff.Rhvac;

// RHVAC is purely mathematical and area-based; nothing here is a drawing. Conventions below were
// validated 2026-07-24 against the firm's most complex real project (projectA, 150 rooms) —
// see README.md in this folder for the .r10 format spec and the verification evidence.
//
// Firm conventions (all confirmed in real files):
// - Rooms and floor/roof rows store AREA in the length field with width 1 ("area x 1"), purely to
//   make manual entry and auditing easy. Walls are the exception: real length x height segments.
// - Vaulted/sloped ceilings are entered as a volume-preserving AVERAGE height; RHVAC's sloped
//   ceiling feature is unused (0 of 150 project-a rooms).
// - Roof rows carry a pitch allowance in the RHVAC width field (1.2 on under-roof rooms). Kept
//   here as AreaMultiplier so exported files stay auditable the way engineers expect.
// - Interior rooms (no exterior exposure) are the norm, not the edge case: ~half of project-a rooms
//   have placeholder zero rows for walls/floors/glass. In this shape absence is an EMPTY list;
//   the file adapter writes RHVAC's zero placeholder rows.

/// <summary>RHVAC's eight wall-facing directions, clockwise from north (codes 0-7, verified).</summary>
public enum RhvacWallDirection
{
    North = 0,
    NorthEast = 1,
    East = 2,
    SouthEast = 3,
    South = 4,
    SouthWest = 5,
    West = 6,
    NorthWest = 7,
}

/// <summary>
/// A named construction assembly. RHVAC files have no catalog table: every room row carries the
/// full material payload inline (description, construction material, category/group/CLTD codes,
/// U-value). Name is free text and acts as the lookup key the file adapter uses to clone those
/// code fields from an existing row in the target file, so it must match an assembly the engineer
/// has already used there. UValue is written as-is and should agree with that assembly.
/// </summary>
public sealed record RhvacAssembly(string Name, double UValue);

/// <summary>
/// One floor row: an exposed-floor area plus the exposed slab-edge perimeter. Area 0 with a
/// positive perimeter is real data (slab-edge loss only). Rooms over conditioned space have no
/// floor rows at all.
/// </summary>
public sealed record RhvacFloor(
    RhvacAssembly Assembly,
    double AreaSquareFeet,
    double ExposedPerimeterFeet
);

/// <summary>
/// One roof/ceiling row: the plan ceiling area under roof or exposed ceiling. AreaMultiplier is
/// written to RHVAC's roof width field (firm uses 1.2 as a pitch allowance, 1.0 for flat).
/// </summary>
public sealed record RhvacRoof(
    RhvacAssembly Assembly,
    double AreaSquareFeet,
    double AreaMultiplier = 1.0
);

public sealed record RhvacWindow(
    RhvacAssembly Assembly,
    double WidthFeet,
    double HeightFeet,
    double SolarHeatGainCoefficient,
    int Occurrences = 1
);

/// <summary>RHVAC doors have no occurrences field; repeat a door as multiple entries.</summary>
public sealed record RhvacDoor(
    RhvacAssembly Assembly,
    double WidthFeet,
    double HeightFeet
);

/// <summary>
/// One exterior thermal wall segment: real length x height, unlike the area-based floors/roofs.
/// Openings are nested under their host wall; the file adapter converts that relationship to
/// RHVAC's 1-based wall-reference ordinals.
/// </summary>
public sealed class RhvacWall
{
    public RhvacWall(
        RhvacAssembly assembly,
        double lengthFeet,
        double heightFeet,
        RhvacWallDirection direction
    )
    {
        this.Assembly = assembly;
        this.LengthFeet = lengthFeet;
        this.HeightFeet = heightFeet;
        this.Direction = direction;
    }

    public RhvacAssembly Assembly { get; }
    public double LengthFeet { get; }
    public double HeightFeet { get; }
    public RhvacWallDirection Direction { get; }
    public List<RhvacWindow> Windows { get; } = new();
    public List<RhvacDoor> Doors { get; } = new();
}

public sealed record RhvacInternalLoads(
    int People = 0,
    double SensibleEquipmentBtuh = 0,
    double LatentEquipmentBtuh = 0,
    double LightingWatts = 0
);

public sealed record RhvacRoomValidationIssue(string Path, string Message);

/// <summary>
/// The room shape shared by Revit takeoff producers and the RHVAC file adapter. Dimensions use
/// feet, areas use square feet. CeilingHeightFeet is the volume-preserving average for vaulted
/// spaces. Empty Floors/Walls/Roofs mean no exposure of that kind (interior rooms are common).
/// </summary>
public sealed class RhvacRoom
{
    public RhvacRoom(
        int number,
        string name,
        double areaSquareFeet,
        double ceilingHeightFeet
    )
    {
        this.Number = number;
        this.Name = name;
        this.AreaSquareFeet = areaSquareFeet;
        this.CeilingHeightFeet = ceilingHeightFeet;
    }

    public int Number { get; }
    public string Name { get; }
    public double AreaSquareFeet { get; }
    public double CeilingHeightFeet { get; }
    public int SystemNumber { get; init; } = 1;
    public int ZoneNumber { get; init; } = 1;
    public RhvacInternalLoads InternalLoads { get; init; } = new();
    public List<RhvacFloor> Floors { get; } = new();
    public List<RhvacRoof> Roofs { get; } = new();
    public List<RhvacWall> Walls { get; } = new();

    public IReadOnlyList<RhvacRoomValidationIssue> Validate() =>
        RhvacRoomValidator.Validate(this);
}

internal static class RhvacRoomValidator
{
    public static IReadOnlyList<RhvacRoomValidationIssue> Validate(RhvacRoom room)
    {
        if (room is null)
            throw new ArgumentNullException(nameof(room));

        var issues = new List<RhvacRoomValidationIssue>();
        Positive(room.Number, "room.number", issues);
        Required(room.Name, "room.name", issues);
        Positive(room.SystemNumber, "room.systemNumber", issues);
        Positive(room.ZoneNumber, "room.zoneNumber", issues);
        Positive(room.AreaSquareFeet, "room.areaSquareFeet", issues);
        Positive(room.CeilingHeightFeet, "room.ceilingHeightFeet", issues);
        NonNegative(room.InternalLoads.People, "room.internalLoads.people", issues);
        NonNegative(room.InternalLoads.SensibleEquipmentBtuh, "room.internalLoads.sensibleEquipmentBtuh", issues);
        NonNegative(room.InternalLoads.LatentEquipmentBtuh, "room.internalLoads.latentEquipmentBtuh", issues);
        NonNegative(room.InternalLoads.LightingWatts, "room.internalLoads.lightingWatts", issues);

        for (var index = 0; index < room.Floors.Count; index++)
        {
            var floor = room.Floors[index];
            var path = $"room.floors[{index}]";
            Assembly(floor.Assembly, $"{path}.assembly", issues);
            NonNegative(floor.AreaSquareFeet, $"{path}.areaSquareFeet", issues);
            NonNegative(floor.ExposedPerimeterFeet, $"{path}.exposedPerimeterFeet", issues);
            if (floor.AreaSquareFeet == 0 && floor.ExposedPerimeterFeet == 0)
                issues.Add(new RhvacRoomValidationIssue(
                    path,
                    "Floor area or exposed perimeter must be greater than zero."
                ));
        }

        for (var index = 0; index < room.Roofs.Count; index++)
        {
            var roof = room.Roofs[index];
            var path = $"room.roofs[{index}]";
            Assembly(roof.Assembly, $"{path}.assembly", issues);
            Positive(roof.AreaSquareFeet, $"{path}.areaSquareFeet", issues);
            Positive(roof.AreaMultiplier, $"{path}.areaMultiplier", issues);
        }

        for (var index = 0; index < room.Walls.Count; index++)
            Wall(room.Walls[index], index, issues);

        // Floor rows describe exposed area and may cover only part of a room. Real data has slack:
        // project-a room 110 totals 478 sf against a 491 sf room, so only reject impossible overshoot.
        var floorArea = room.Floors.Sum(floor => floor.AreaSquareFeet);
        var areaTolerance = Math.Max(1, room.AreaSquareFeet * 0.05);
        if (IsFinitePositive(floorArea)
            && floorArea - room.AreaSquareFeet > areaTolerance)
        {
            issues.Add(new RhvacRoomValidationIssue(
                "room.floors",
                $"Floor area {floorArea:F2} sf exceeds room area {room.AreaSquareFeet:F2} sf."
            ));
        }

        return issues;
    }

    private static void Wall(
        RhvacWall wall,
        int index,
        List<RhvacRoomValidationIssue> issues
    )
    {
        var path = $"room.walls[{index}]";
        Assembly(wall.Assembly, $"{path}.assembly", issues);
        Positive(wall.LengthFeet, $"{path}.lengthFeet", issues);
        Positive(wall.HeightFeet, $"{path}.heightFeet", issues);

        for (var openingIndex = 0; openingIndex < wall.Windows.Count; openingIndex++)
        {
            var window = wall.Windows[openingIndex];
            var openingPath = $"{path}.windows[{openingIndex}]";
            Assembly(window.Assembly, $"{openingPath}.assembly", issues);
            Positive(window.WidthFeet, $"{openingPath}.widthFeet", issues);
            Positive(window.HeightFeet, $"{openingPath}.heightFeet", issues);
            Positive(window.Occurrences, $"{openingPath}.occurrences", issues);
            Range(window.SolarHeatGainCoefficient, 0, 1, $"{openingPath}.solarHeatGainCoefficient", issues);
        }

        for (var openingIndex = 0; openingIndex < wall.Doors.Count; openingIndex++)
        {
            var door = wall.Doors[openingIndex];
            var openingPath = $"{path}.doors[{openingIndex}]";
            Assembly(door.Assembly, $"{openingPath}.assembly", issues);
            Positive(door.WidthFeet, $"{openingPath}.widthFeet", issues);
            Positive(door.HeightFeet, $"{openingPath}.heightFeet", issues);
        }

        var grossArea = wall.LengthFeet * wall.HeightFeet;
        var openingArea =
            wall.Windows.Sum(window => window.WidthFeet * window.HeightFeet * window.Occurrences)
            + wall.Doors.Sum(door => door.WidthFeet * door.HeightFeet);
        if (IsFinitePositive(grossArea) && openingArea > grossArea)
        {
            issues.Add(new RhvacRoomValidationIssue(
                $"{path}.openings",
                $"Opening area {openingArea:F2} sf exceeds gross wall area {grossArea:F2} sf."
            ));
        }
    }

    private static void Assembly(
        RhvacAssembly assembly,
        string path,
        List<RhvacRoomValidationIssue> issues
    )
    {
        if (assembly is null)
        {
            issues.Add(new RhvacRoomValidationIssue(path, "Assembly is required."));
            return;
        }

        Required(assembly.Name, $"{path}.name", issues);
        Positive(assembly.UValue, $"{path}.uValue", issues);
    }

    private static void Required(
        string value,
        string path,
        List<RhvacRoomValidationIssue> issues
    )
    {
        if (string.IsNullOrWhiteSpace(value))
            issues.Add(new RhvacRoomValidationIssue(path, "Value is required."));
    }

    private static void Positive(
        double value,
        string path,
        List<RhvacRoomValidationIssue> issues
    )
    {
        if (!IsFinitePositive(value))
            issues.Add(new RhvacRoomValidationIssue(path, "Value must be finite and greater than zero."));
    }

    private static void Positive(
        int value,
        string path,
        List<RhvacRoomValidationIssue> issues
    )
    {
        if (value <= 0)
            issues.Add(new RhvacRoomValidationIssue(path, "Value must be greater than zero."));
    }

    private static void NonNegative(
        double value,
        string path,
        List<RhvacRoomValidationIssue> issues
    )
    {
        if (!IsFinite(value) || value < 0)
            issues.Add(new RhvacRoomValidationIssue(path, "Value must be finite and non-negative."));
    }

    private static void Range(
        double value,
        double minimum,
        double maximum,
        string path,
        List<RhvacRoomValidationIssue> issues
    )
    {
        if (!IsFinite(value) || value < minimum || value > maximum)
            issues.Add(new RhvacRoomValidationIssue(path, $"Value must be between {minimum} and {maximum}."));
    }

    private static bool IsFinitePositive(double value) =>
        IsFinite(value) && value > 0;

    private static bool IsFinite(double value) =>
        !double.IsNaN(value) && !double.IsInfinity(value);
}
