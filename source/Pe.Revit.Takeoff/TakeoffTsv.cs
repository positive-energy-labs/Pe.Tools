using NetTopologySuite.Geometries;
using NetTopologySuite.Operation.Valid;

namespace Pe.Revit.Takeoff;

/// <summary>One parsed room from a takeoff TSV: identity, scalars, and polygon (model feet).</summary>
public sealed record TakeoffRoomShape(
    string Id,
    double RawSqft,
    double PerimeterFt,
    double MeanCeilingFt,
    List<double[]> Outer,
    List<List<double[]>> Holes
)
{
    public List<string> Flags { get; init; } = new();
    public double[] Label { get; init; } = Array.Empty<double>();
    public string? SplitFrom { get; set; }
    public string? MergedFrom { get; set; }
}

public sealed record TakeoffResidueShape(
    string Id,
    ResidueReason Reason,
    double RawSqft,
    double MeanCeilingFt,
    double[] Label,
    List<double[]> Outer,
    List<List<double[]>> Holes
);

/// <summary>One parsed takeoff TSV: a level and its rooms.</summary>
public sealed record LevelTakeoff(string LevelName, double Elevation, List<TakeoffRoomShape> Rooms)
{
    public TakeoffSource Source { get; init; } = TakeoffSource.Detector;
    public List<TakeoffResidueShape> Residues { get; init; } = new();
}

public static class TakeoffTsv
{
    /// <summary>Parses one ToTsv payload (META/ROOM/POLY lines) without changing its geometry.</summary>
    public static LevelTakeoff ParseTsv(string tsvText)
    {
        var ic = CultureInfo.InvariantCulture;
        string? levelName = null;
        double? elevation = null;
        var source = TakeoffSource.Detector;
        int? declaredRooms = null;
        var rooms = new List<TakeoffRoomShape>();
        var residues = new List<TakeoffResidueShape>();
        var byId = new Dictionary<string, TakeoffRoomShape>();

        var lines = tsvText.Split('\n');
        for (var lineIndex = 0; lineIndex < lines.Length; lineIndex++)
        {
            var line = lines[lineIndex].TrimEnd('\r');
            if (line.Length == 0)
                continue;
            var parts = line.Split('\t');
            switch (parts[0])
            {
                case "META" when parts.Length == 3:
                    if (parts[1] == "level")
                        levelName = parts[2];
                    else if (parts[1] == "elev")
                        elevation = Parse(parts[2], lineIndex);
                    else if (parts[1] == "rooms")
                        declaredRooms = int.Parse(parts[2], ic);
                    else if (parts[1] == "source")
                        source = parts[2] switch {
                            "detector" => TakeoffSource.Detector,
                            "native" => TakeoffSource.Native,
                            _ => throw Malformed(lineIndex, $"unknown takeoff source '{parts[2]}'"),
                        };
                    else if (parts[1] == "flag")
                        ApplyFlagMeta(parts[2], byId);
                    else if (parts[1] == "splitFrom")
                        ApplyProvenance(parts[2], byId, (room, value) => room.SplitFrom = value);
                    else if (parts[1] == "mergedFrom")
                        ApplyProvenance(parts[2], byId, (room, value) => room.MergedFrom = value);
                    // totalSqft and other META fields are display metadata; ignored.
                    break;
                case "ROOM" when parts.Length == 7:
                    var room = new TakeoffRoomShape(
                        parts[1],
                        Parse(parts[2], lineIndex),
                        Parse(parts[3], lineIndex),
                        Parse(parts[6], lineIndex),
                        new List<double[]>(),
                        new List<List<double[]>>()
                    ) { Label = new[] { Parse(parts[4], lineIndex), Parse(parts[5], lineIndex) } };
                    rooms.Add(room);
                    byId.Add(room.Id, room);
                    break;
                case "POLY" when parts.Length == 4:
                    if (!byId.TryGetValue(parts[1], out var target))
                        throw Malformed(lineIndex, $"POLY references unknown room '{parts[1]}'");
                    var loop = ParseLoop(parts[3], lineIndex);
                    if (parts[2] == "outer")
                        target.Outer.AddRange(loop);
                    else if (parts[2] == "hole")
                        target.Holes.Add(loop);
                    else
                        throw Malformed(lineIndex, $"unknown loop kind '{parts[2]}'");
                    break;
                case "META" when parts.Length >= 9 && parts[1] == "residue":
                    residues.Add(new TakeoffResidueShape(
                        parts[2], (ResidueReason)Enum.Parse(typeof(ResidueReason), parts[3], true),
                        Parse(parts[4], lineIndex), Parse(parts[7], lineIndex),
                        new[] { Parse(parts[5], lineIndex), Parse(parts[6], lineIndex) },
                        ParseLoop(parts[8], lineIndex),
                        parts.Skip(9).Select(value => ParseLoop(value, lineIndex)).ToList()
                    ));
                    break;
                default:
                    throw Malformed(lineIndex, $"unrecognized line: {line[..Math.Min(line.Length, 80)]}");
            }
        }

        if (levelName is null || elevation is null)
            throw new InvalidDataException("TSV has no META level/elev header.");
        if (declaredRooms is not null && declaredRooms != rooms.Count)
            throw new InvalidDataException($"META rooms says {declaredRooms} but {rooms.Count} ROOM lines parsed.");
        foreach (var room in rooms)
        {
            if (room.Outer.Count < 3)
                throw new InvalidDataException($"Room {room.Id}: outer loop has {room.Outer.Count} vertices.");
            var outerArea = TakeoffGeometry.SignedArea(room.Outer);
            if (outerArea <= 0)
                throw new InvalidDataException($"Room {room.Id}: outer loop is not CCW (contract violation).");
            ValidateGeometry(room);
        }

        return new LevelTakeoff(levelName, elevation.Value, rooms) {
            Source = source,
            Residues = residues,
        };
    }

    /// <summary>Parses every rooms_*.tsv in a takeoff directory, level-name ordered.</summary>
    public static List<LevelTakeoff> ParseTsvDirectory(string tsvDirectory) =>
        Directory.GetFiles(Path.GetFullPath(tsvDirectory), "rooms_*.tsv")
            .Where(path => !path.EndsWith(".native.tsv", StringComparison.OrdinalIgnoreCase))
            .OrderBy(path => path, StringComparer.Ordinal)
            .Select(path => ParseTsv(File.ReadAllText(path)))
            .ToList();

    private static void ApplyFlagMeta(string payload, IReadOnlyDictionary<string, TakeoffRoomShape> byId)
    {
        var colon = payload.IndexOf(':');
        if (colon <= 0 || !byId.TryGetValue(payload[..colon], out var room))
            return;
        foreach (var flag in payload[(colon + 1)..].Split('+').Where(flag => flag.Length > 0))
            if (!room.Flags.Contains(flag)) room.Flags.Add(flag);
        room.Flags.Sort(StringComparer.Ordinal);
    }

    private static void ApplyProvenance(
        string payload,
        IReadOnlyDictionary<string, TakeoffRoomShape> byId,
        Action<TakeoffRoomShape, string> apply)
    {
        var colon = payload.IndexOf(':');
        if (colon <= 0 || colon == payload.Length - 1
            || !byId.TryGetValue(payload[..colon], out var room)) return;
        apply(room, payload[(colon + 1)..]);
    }

    private static void ValidateGeometry(TakeoffRoomShape room)
    {
        try
        {
            var factory = TakeoffGeometry.Coverage;
            var polygon = TakeoffGeometry.ToPolygon(room, factory);
            var validity = new IsValidOp(polygon).ValidationError;
            if (validity != null)
                throw new InvalidDataException($"Room {room.Id}: invalid polygon ({validity.Message}).");
            if (polygon.Area <= 0)
                throw new InvalidDataException($"Room {room.Id}: polygon has no net area.");
            if (room.RawSqft <= 0 || polygon.Area > 4 * room.RawSqft || room.RawSqft > 4 * polygon.Area)
                throw new InvalidDataException(
                    $"Room {room.Id}: RawSqft {room.RawSqft:F1} grossly disagrees with polygon area {polygon.Area:F1}."
                );
            if (room.Label.Length < 2 || !polygon.Contains(factory.CreatePoint(
                    new Coordinate(room.Label[0], room.Label[1]))))
                throw new InvalidDataException($"Room {room.Id}: label is not strictly inside its polygon.");
        }
        catch (InvalidDataException) { throw; }
        catch (Exception exception)
        {
            throw new InvalidDataException($"Room {room.Id}: malformed polygon.", exception);
        }
    }

    private static List<double[]> ParseLoop(string text, int lineIndex)
    {
        var vertices = new List<double[]>();
        foreach (var pair in text.Split('|'))
        {
            var xy = pair.Split(';');
            if (xy.Length != 2)
                throw Malformed(lineIndex, $"bad vertex '{pair}'");
            vertices.Add(new[] { Parse(xy[0], lineIndex), Parse(xy[1], lineIndex) });
        }
        return vertices;
    }

    private static double Parse(string text, int lineIndex) =>
        double.TryParse(text, NumberStyles.Float, CultureInfo.InvariantCulture, out var value)
            ? value
            : throw Malformed(lineIndex, $"bad number '{text}'");

    private static InvalidDataException Malformed(int lineIndex, string message) =>
        new($"TSV line {lineIndex + 1}: {message}");
}
