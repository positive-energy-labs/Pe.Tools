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
    public string? SplitFrom { get; init; }
    public string? MergedFrom { get; init; }
}

public sealed record TakeoffResidueShape(
    string Id,
    ResidueReason Reason,
    double RawSqft,
    double MeanCeilingFt,
    double[] Label,
    List<double[]> Outer,
    List<List<double[]>> Holes
)
{
    public bool Claimed { get; init; }
}

/// <summary>One parsed takeoff TSV: a level and its rooms.</summary>
public sealed record LevelTakeoff(string LevelName, double Elevation, List<TakeoffRoomShape> Rooms)
{
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
                    else if (parts[1] == "flag")
                        ApplyFlagMeta(parts[2], byId);
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
                        parts[2], Enum.Parse<ResidueReason>(parts[3], true),
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
            var outerArea = SignedArea(room.Outer);
            if (outerArea <= 0)
                throw new InvalidDataException($"Room {room.Id}: outer loop is not CCW (contract violation).");
            // RawSqft stays the exact cell-count truth while a regularized polygon may diverge
            // up to TakeoffOptions.RegularizeAreaTolerancePct (3%); gate at that contract + slack.
            var polyArea = outerArea - room.Holes.Sum(hole => Math.Abs(SignedArea(hole)));
            if (Math.Abs(polyArea - room.RawSqft) > Math.Max(2.0, room.RawSqft * 0.035))
                throw new InvalidDataException(
                    $"Room {room.Id}: RawSqft {room.RawSqft:F1} disagrees with polygon area {polyArea:F1}."
                );
        }

        return new LevelTakeoff(levelName, elevation.Value, rooms) { Residues = residues };
    }

    /// <summary>
    /// Parses every rooms_*.tsv in a takeoff directory and applies the optional
    /// takeoff-resolutions.json beside that directory.
    /// </summary>
    public static ResolutionApplyResult ParseTsvDirectory(
        string tsvDirectory,
        string? resolutionsPath = null
    )
    {
        var fullDirectory = Path.GetFullPath(tsvDirectory);
        var levels = Directory.GetFiles(fullDirectory, "rooms_*.tsv")
            .OrderBy(path => path, StringComparer.Ordinal)
            .Select(path => ParseTsv(File.ReadAllText(path)))
            .ToList();
        var sidecar = resolutionsPath ?? TakeoffResolutions.ResolutionPath(fullDirectory);
        return File.Exists(sidecar)
            ? TakeoffResolutions.ApplyResolutions(levels, sidecar)
            : new ResolutionApplyResult(levels, 0, 0, 0);
    }

    private static void ApplyFlagMeta(string payload, IReadOnlyDictionary<string, TakeoffRoomShape> byId)
    {
        var colon = payload.IndexOf(':');
        if (colon <= 0 || !byId.TryGetValue(payload[..colon], out var room))
            return;
        foreach (var flag in payload[(colon + 1)..].Split('+').Where(flag => flag.Length > 0))
            if (!room.Flags.Contains(flag)) room.Flags.Add(flag);
        room.Flags.Sort(StringComparer.Ordinal);
    }

    private static double SignedArea(List<double[]> loop)
    {
        var sum = 0.0;
        for (int i = 0, j = loop.Count - 1; i < loop.Count; j = i++)
            sum += (loop[j][0] * loop[i][1]) - (loop[i][0] * loop[j][1]);
        return sum / 2;
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
