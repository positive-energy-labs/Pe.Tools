namespace Pe.Revit.Takeoff.Rhvac;

/// <summary>RHVAC's eight wall-facing directions, clockwise from north.</summary>
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

/// <summary>A named RHVAC construction assembly and its effective U-value.</summary>
public sealed record RhvacAssembly(string Name, double UValue);

/// <summary>One RHVAC floor row. Multiple rows may approximate a non-rectangular room.</summary>
public sealed record RhvacFloor(
    RhvacAssembly Assembly,
    double LengthFeet,
    double WidthFeet,
    double ExposedPerimeterFeet
);

/// <summary>One horizontal, upward-facing RHVAC roof/ceiling row.</summary>
public sealed record RhvacRoof(
    RhvacAssembly Assembly,
    double LengthFeet,
    double WidthFeet
);

public sealed record RhvacWindow(
    RhvacAssembly Assembly,
    double WidthFeet,
    double HeightFeet,
    double SolarHeatGainCoefficient,
    int Occurrences = 1
);

public sealed record RhvacDoor(
    RhvacAssembly Assembly,
    double WidthFeet,
    double HeightFeet,
    int Occurrences = 1
);

/// <summary>
/// One exterior thermal wall. Openings are nested under their host wall; an RHVAC file adapter
/// is responsible for converting that relationship to RHVAC wall-reference ordinals.
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
        this.Assembly = assembly ?? throw new ArgumentNullException(nameof(assembly));
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
    double People = 0,
    double SensibleEquipmentBtuh = 0,
    double LatentEquipmentBtuh = 0,
    double LightingWatts = 0
);

public sealed record RhvacRoomValidationIssue(string Path, string Message);

/// <summary>
/// The preliminary room shape shared by Revit takeoff producers and future RHVAC adapters.
/// Dimensions use feet, areas use square feet, and loads use the units named on each member.
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

        if (room.Floors.Count == 0)
            issues.Add(new RhvacRoomValidationIssue("room.floors", "At least one floor is required."));
        if (room.Walls.Count == 0)
            issues.Add(new RhvacRoomValidationIssue("room.walls", "At least one wall is required."));

        for (var index = 0; index < room.Floors.Count; index++)
        {
            var floor = room.Floors[index];
            var path = $"room.floors[{index}]";
            Assembly(floor.Assembly, $"{path}.assembly", issues);
            Positive(floor.LengthFeet, $"{path}.lengthFeet", issues);
            Positive(floor.WidthFeet, $"{path}.widthFeet", issues);
            NonNegative(floor.ExposedPerimeterFeet, $"{path}.exposedPerimeterFeet", issues);
        }

        for (var index = 0; index < room.Roofs.Count; index++)
        {
            var roof = room.Roofs[index];
            var path = $"room.roofs[{index}]";
            Assembly(roof.Assembly, $"{path}.assembly", issues);
            Positive(roof.LengthFeet, $"{path}.lengthFeet", issues);
            Positive(roof.WidthFeet, $"{path}.widthFeet", issues);
        }

        for (var index = 0; index < room.Walls.Count; index++)
            Wall(room.Walls[index], index, issues);

        var floorArea = room.Floors.Sum(floor => floor.LengthFeet * floor.WidthFeet);
        var areaTolerance = Math.Max(1, room.AreaSquareFeet * 0.01);
        if (room.Floors.Count > 0 && IsFinitePositive(floorArea)
            && Math.Abs(floorArea - room.AreaSquareFeet) > areaTolerance)
        {
            issues.Add(new RhvacRoomValidationIssue(
                "room.floors",
                $"Floor area {floorArea:F2} sf does not match room area {room.AreaSquareFeet:F2} sf."
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
            Positive(door.Occurrences, $"{openingPath}.occurrences", issues);
        }

        var grossArea = wall.LengthFeet * wall.HeightFeet;
        var openingArea =
            wall.Windows.Sum(window => window.WidthFeet * window.HeightFeet * window.Occurrences)
            + wall.Doors.Sum(door => door.WidthFeet * door.HeightFeet * door.Occurrences);
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
