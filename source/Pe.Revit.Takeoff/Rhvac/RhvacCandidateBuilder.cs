using Newtonsoft.Json;

namespace Pe.Revit.Takeoff.Rhvac;

// Offline takeoff -> RhvacRoom converter: parses the TSV snapshots RoomTakeoff emits (Contracts.cs
// ToTsv), applies per-project conversion conventions (conventions.json), and builds envelope rooms
// for the eval scorer. Pure math, no Revit API — runs anywhere the tests run.
//
// v1 heuristics (see Rhvac/README.md "Envelope conversion"):
// - Exterior walls: probe outward from each outer-loop edge midpoint; exterior iff the probe lands
//   in no other room on the level. One wall per compass direction, summed length x mean ceiling.
// - Floors/roofs: uncovered-fraction raster against the level immediately below/above.
// - No glass/doors (takeoff cannot see them yet); hole boundaries are skipped for walls.

/// <summary>One parsed room from a takeoff TSV: identity, scalars, and polygon (model feet).</summary>
public sealed record TakeoffRoomShape(
    string Id,
    double RawSqft,
    double PerimeterFt,
    double MeanCeilingFt,
    List<double[]> Outer,
    List<List<double[]>> Holes
);

/// <summary>One parsed takeoff TSV: a level and its rooms.</summary>
public sealed record LevelTakeoff(string LevelName, double Elevation, List<TakeoffRoomShape> Rooms);

/// <summary>The four assembly slots a project conversion needs (names must exist in the target .r10).</summary>
public sealed record ConventionAssemblies(
    RhvacAssembly Wall,
    RhvacAssembly Roof,
    RhvacAssembly SlabFloor,
    RhvacAssembly FramedFloor
);

/// <summary>
/// Per-project conversion config (eval/rhvac/&lt;project&gt;/conventions.json). TrueNorthAngleRadians
/// rotates model +Y to true north; SlabLevels lists level names whose floors are slab-on-grade.
/// </summary>
public sealed record Conventions(
    double TrueNorthAngleRadians,
    double RoofAreaMultiplier,
    double WallProbeFeet,
    double CoverageCellFeet,
    double UncoveredFractionThreshold,
    List<string> SlabLevels,
    ConventionAssemblies Assemblies
);

/// <summary>Builds RHVAC candidate rooms from committed takeoff TSVs plus project conventions.</summary>
public static class RhvacCandidateBuilder
{
    private const double MinWallEdgeFeet = 0.5; // raster stair-step slivers, not walls

    /// <summary>Parses one ToTsv payload (META/ROOM/POLY lines). Throws on any malformed line.</summary>
    public static LevelTakeoff ParseTsv(string tsvText)
    {
        var ic = CultureInfo.InvariantCulture;
        string? levelName = null;
        double? elevation = null;
        int? declaredRooms = null;
        var rooms = new List<TakeoffRoomShape>();
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
                    // totalSqft is display metadata; ignored.
                    break;
                case "ROOM" when parts.Length == 7:
                    var room = new TakeoffRoomShape(
                        parts[1],
                        Parse(parts[2], lineIndex),
                        Parse(parts[3], lineIndex),
                        Parse(parts[6], lineIndex),
                        new List<double[]>(),
                        new List<List<double[]>>()
                    );
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
            // The area scalar and the polygon are redundant truth; a drift means a corrupt or
            // stale TSV, and every downstream metric would silently grade the wrong geometry.
            var polyArea = outerArea - room.Holes.Sum(hole => Math.Abs(SignedArea(hole)));
            if (Math.Abs(polyArea - room.RawSqft) > Math.Max(2.0, room.RawSqft * 0.02))
                throw new InvalidDataException(
                    $"Room {room.Id}: RawSqft {room.RawSqft:F1} disagrees with polygon area {polyArea:F1}."
                );
        }

        return new LevelTakeoff(levelName, elevation.Value, rooms);
    }

    /// <summary>Loads and validates a conventions.json.</summary>
    public static Conventions LoadConventions(string path)
    {
        var conventions = JsonConvert.DeserializeObject<Conventions>(File.ReadAllText(path))
            ?? throw new InvalidDataException($"{path}: empty conventions file.");
        if (conventions.WallProbeFeet <= 0 || conventions.CoverageCellFeet <= 0)
            throw new InvalidDataException($"{path}: wallProbeFeet and coverageCellFeet must be positive.");
        if (conventions.UncoveredFractionThreshold is <= 0 or >= 1)
            throw new InvalidDataException($"{path}: uncoveredFractionThreshold must be in (0, 1).");
        if (conventions.RoofAreaMultiplier <= 0)
            throw new InvalidDataException($"{path}: roofAreaMultiplier must be positive.");
        if (conventions.SlabLevels is null)
            throw new InvalidDataException($"{path}: slabLevels is required.");
        if (conventions.Assemblies is not { Wall: not null, Roof: not null, SlabFloor: not null, FramedFloor: not null })
            throw new InvalidDataException($"{path}: assemblies.wall/roof/slabFloor/framedFloor are all required.");
        return conventions;
    }

    /// <summary>
    /// Converts parsed level takeoffs into RHVAC rooms. Levels are ordered by elevation; room
    /// numbers run sequentially across them and Name is "{levelName}:{id}" (the run-takeoff.py
    /// convention room-map.json keys against — do not change).
    /// </summary>
    public static List<RhvacRoom> Build(IReadOnlyList<LevelTakeoff> levels, Conventions conventions)
    {
        var ordered = levels.OrderBy(level => level.Elevation).ToList();
        var rooms = new List<RhvacRoom>();
        var number = 0;
        for (var levelIndex = 0; levelIndex < ordered.Count; levelIndex++)
        {
            var level = ordered[levelIndex];
            // ponytail: adjacent-by-elevation-order only; split levels (e.g. Landing) between two
            // full levels will misattribute coverage. Acceptable at v1 — project-a' four takeoff
            // levels are true storeys.
            var below = levelIndex > 0 ? ordered[levelIndex - 1] : null;
            var above = levelIndex < ordered.Count - 1 ? ordered[levelIndex + 1] : null;
            var isSlab = conventions.SlabLevels.Contains(level.LevelName);

            foreach (var shape in level.Rooms)
            {
                number++;
                var room = new RhvacRoom(number, $"{level.LevelName}:{shape.Id}", shape.RawSqft, shape.MeanCeilingFt);
                var exteriorPerimeter = AddWalls(room, shape, level, conventions);

                if (isSlab)
                {
                    room.Floors.Add(new RhvacFloor(conventions.Assemblies.SlabFloor, shape.RawSqft, exteriorPerimeter));
                }
                else if (below is not null)
                {
                    var uncovered = UncoveredFraction(shape, below, conventions.CoverageCellFeet);
                    if (uncovered > conventions.UncoveredFractionThreshold)
                        room.Floors.Add(new RhvacFloor(
                            conventions.Assemblies.FramedFloor,
                            uncovered * shape.RawSqft,
                            0
                        ));
                }
                // Bottom level not marked slab: no floor row — that is a conventions gap, not
                // framed exposure over air.

                var roofFraction = above is null ? 1.0 : UncoveredFraction(shape, above, conventions.CoverageCellFeet);
                if (roofFraction > conventions.UncoveredFractionThreshold)
                    room.Roofs.Add(new RhvacRoof(
                        conventions.Assemblies.Roof,
                        roofFraction * shape.RawSqft,
                        conventions.RoofAreaMultiplier
                    ));

                rooms.Add(room);
            }
        }

        return rooms;
    }

    /// <summary>
    /// Classifies outer-loop edges exterior/interior by outward probe, sums exterior length per
    /// compass direction, and adds one wall per direction. Returns total exterior edge length.
    /// Hole boundaries are skipped: courtyards are usually enclosed (v1, see README).
    /// </summary>
    private static double AddWalls(
        RhvacRoom room,
        TakeoffRoomShape shape,
        LevelTakeoff level,
        Conventions conventions
    )
    {
        var lengthByDirection = new double[8];
        var exteriorPerimeter = 0.0;
        var outer = shape.Outer;
        for (var index = 0; index < outer.Count; index++)
        {
            var p = outer[index];
            var q = outer[(index + 1) % outer.Count];
            var dx = q[0] - p[0];
            var dy = q[1] - p[1];
            var length = Math.Sqrt((dx * dx) + (dy * dy));
            if (length <= MinWallEdgeFeet)
                continue;

            // Outer loops are CCW, interior on the left of travel, so outward = right-hand normal.
            var nx = dy / length;
            var ny = -dx / length;
            var probeX = ((p[0] + q[0]) / 2) + (nx * conventions.WallProbeFeet);
            var probeY = ((p[1] + q[1]) / 2) + (ny * conventions.WallProbeFeet);

            var interior = level.Rooms.Any(other =>
                !ReferenceEquals(other, shape) && Inside(other, probeX, probeY));
            if (interior)
                continue;

            lengthByDirection[Bucket(nx, ny, conventions.TrueNorthAngleRadians)] += length;
            exteriorPerimeter += length;
        }

        for (var direction = 0; direction < 8; direction++)
        {
            if (lengthByDirection[direction] > 0)
                room.Walls.Add(new RhvacWall(
                    conventions.Assemblies.Wall,
                    lengthByDirection[direction],
                    shape.MeanCeilingFt,
                    (RhvacWallDirection)direction
                ));
        }

        return exteriorPerimeter;
    }

    /// <summary>
    /// Fraction of the room's raster cells (centers at CellFeet pitch, holes respected) whose
    /// center lies inside no room of the neighbor level. ponytail: O(rooms x cells) ray casting
    /// with a bbox early-out — ~10^6 cheap tests per level pair at 1 ft cells, fine offline.
    /// </summary>
    private static double UncoveredFraction(TakeoffRoomShape shape, LevelTakeoff neighbor, double cellFeet)
    {
        var minX = shape.Outer.Min(v => v[0]);
        var maxX = shape.Outer.Max(v => v[0]);
        var minY = shape.Outer.Min(v => v[1]);
        var maxY = shape.Outer.Max(v => v[1]);

        var total = 0;
        var uncovered = 0;
        for (var y = minY + (cellFeet / 2); y < maxY; y += cellFeet)
        {
            for (var x = minX + (cellFeet / 2); x < maxX; x += cellFeet)
            {
                if (!Inside(shape, x, y))
                    continue;
                total++;
                if (!neighbor.Rooms.Any(other => Inside(other, x, y)))
                    uncovered++;
            }
        }

        if (total == 0)
            throw new InvalidDataException(
                $"Room {shape.Id}: no raster cells at {cellFeet} ft — polygon degenerate or cell too coarse."
            );
        return (double)uncovered / total;
    }

    /// <summary>Snaps an outward normal to the 8 RHVAC directions; +Y is North at angle 0.</summary>
    private static int Bucket(double nx, double ny, double trueNorthAngleRadians)
    {
        var azimuthDegrees = ((Math.Atan2(nx, ny) + trueNorthAngleRadians) * 180.0 / Math.PI) % 360.0;
        var bucket = (int)Math.Round(azimuthDegrees / 45.0) % 8;
        return bucket < 0 ? bucket + 8 : bucket;
    }

    /// <summary>Point-in-room: inside the outer loop and inside no hole.</summary>
    private static bool Inside(TakeoffRoomShape shape, double x, double y) =>
        InsideLoop(shape.Outer, x, y) && !shape.Holes.Any(hole => InsideLoop(hole, x, y));

    private static bool InsideLoop(List<double[]> loop, double x, double y)
    {
        // Even-odd ray casting, orientation-agnostic.
        var inside = false;
        for (int i = 0, j = loop.Count - 1; i < loop.Count; j = i++)
        {
            var pi = loop[i];
            var pj = loop[j];
            if (pi[1] > y != pj[1] > y
                && x < ((pj[0] - pi[0]) * (y - pi[1]) / (pj[1] - pi[1])) + pi[0])
                inside = !inside;
        }

        return inside;
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
