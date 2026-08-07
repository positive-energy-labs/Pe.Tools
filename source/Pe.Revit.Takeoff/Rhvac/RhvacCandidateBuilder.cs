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

/// <summary>Resolved levels plus loss accounting for every sidecar decision.</summary>
public sealed record ResolutionApplyResult(
    List<LevelTakeoff> Levels,
    int Applied,
    int Remapped,
    int Orphaned
);

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

/// <summary>Builds RHVAC rooms from takeoff TSVs, optional flag resolutions, and conventions.</summary>
public static class RhvacCandidateBuilder
{
    private const double MinWallEdgeFeet = 0.5; // raster stair-step slivers, not walls
    private const double MaxRasterPitchFeet = 1.0; // finer grids are staircases; coarser data is left alone
    private const double StairEdgeCells = 2.5; // edges up to this many grid cells are staircase steps

    private sealed record ResolutionsFile(int Version, List<FlagResolution>? Resolutions);
    private sealed record FlagResolution(
        string CandidateKey,
        string Flag,
        string Action,
        ResolutionParams? Params,
        ResolutionAnchor? Anchor
    );
    private sealed record ResolutionParams(
        double[]? A,
        double[]? B,
        string? Other,
        string? ResidueId,
        string? Into,
        ResolutionAnchor? Anchor
    );
    private sealed record ResolutionAnchor(double[] Label, double Sqft);
    private sealed record RoomReference(string LevelName, string Key, TakeoffRoomShape Room);
    private sealed record ResidueReference(string LevelName, string Key, TakeoffResidueShape Residue);
    private readonly record struct RingSnap(int Edge, double T, double[] Point);

    /// <summary>
    /// Parses one ToTsv payload (META/ROOM/POLY lines). Throws on any malformed line. Unless
    /// <paramref name="simplify"/> is false, raster staircase outlines are simplified after
    /// validation (see SimplifyShape) so perimeter/wall lengths derive from clean segments.
    /// </summary>
    public static LevelTakeoff ParseTsv(string tsvText, bool simplify = true)
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
            // The area scalar and the polygon are redundant truth; a drift means a corrupt or
            // stale TSV, and every downstream metric would silently grade the wrong geometry.
            // RawSqft stays the exact cell-count truth while a regularized polygon may diverge
            // up to TakeoffOptions.RegularizeAreaTolerancePct (3%); gate at that contract + slack.
            var polyArea = outerArea - room.Holes.Sum(hole => Math.Abs(SignedArea(hole)));
            if (Math.Abs(polyArea - room.RawSqft) > Math.Max(2.0, room.RawSqft * 0.035))
                throw new InvalidDataException(
                    $"Room {room.Id}: RawSqft {room.RawSqft:F1} disagrees with polygon area {polyArea:F1}."
                );
        }

        if (simplify)
            SimplifyLevelLoops(rooms);
        return new LevelTakeoff(levelName, elevation.Value, rooms) { Residues = residues };
    }

    /// <summary>
    /// Parses every rooms_*.tsv in a takeoff directory and applies the optional
    /// takeoff-resolutions.json beside that directory.
    /// </summary>
    public static ResolutionApplyResult ParseTsvDirectory(
        string tsvDirectory,
        string? resolutionsPath = null,
        bool simplify = true
    )
    {
        var fullDirectory = Path.GetFullPath(tsvDirectory);
        var levels = Directory.GetFiles(fullDirectory, "rooms_*.tsv")
            .OrderBy(path => path, StringComparer.Ordinal)
            .Select(path => ParseTsv(File.ReadAllText(path), simplify: false))
            .ToList();
        var sidecar = resolutionsPath ?? ResolutionPath(fullDirectory);
        var result = File.Exists(sidecar)
            ? ApplyResolutions(levels, sidecar)
            : new ResolutionApplyResult(levels, 0, 0, 0);
        if (simplify)
            foreach (var level in result.Levels)
                SimplifyLevelLoops(level.Rooms);
        return result;
    }

    internal static string ResolutionPath(string tsvDirectory)
    {
        var fullDirectory = Path.GetFullPath(tsvDirectory);
        var projectDirectory = Directory.GetParent(fullDirectory)?.FullName
            ?? throw new InvalidDataException($"{fullDirectory}: takeoff directory has no parent.");
        return Path.Combine(projectDirectory, "takeoff-resolutions.json");
    }

    /// <summary>Pure, idempotent sidecar application with v2 anchor remapping and loss accounting.</summary>
    public static ResolutionApplyResult ApplyResolutions(
        IReadOnlyList<LevelTakeoff> levels,
        string resolutionsPath
    )
    {
        var file = JsonConvert.DeserializeObject<ResolutionsFile>(File.ReadAllText(resolutionsPath))
            ?? throw new InvalidDataException($"{resolutionsPath}: empty resolutions file.");
        if (file.Version is not (1 or 2) || file.Resolutions is null)
            throw new InvalidDataException($"{resolutionsPath}: expected version 1 or 2 with a resolutions array.");
        foreach (var resolution in file.Resolutions)
        {
            if (string.IsNullOrEmpty(resolution.CandidateKey) || string.IsNullOrEmpty(resolution.Flag))
                throw new InvalidDataException($"{resolutionsPath}: candidateKey and flag are required.");
            if (resolution.Action is not ("accept" or "split" or "reject" or "merge" or "claim-residue"))
                throw new InvalidDataException($"{resolutionsPath}: unknown action '{resolution.Action}'.");
            if (resolution.Action == "split" && resolution.Params is { A: not null, B: not null })
            {
                ValidatePoint(resolution.Params.A, resolutionsPath);
                ValidatePoint(resolution.Params.B, resolutionsPath);
            }
            if (resolution.Action == "merge"
                && resolution.Params is not { Other.Length: > 0, Anchor: not null })
                throw new InvalidDataException($"{resolutionsPath}: merge params require other and anchor.");
            if (resolution.Action == "merge" && resolution.Params is { Anchor: not null })
            {
                ValidatePoint(resolution.Params.Anchor.Label, resolutionsPath);
                if (!double.IsFinite(resolution.Params.Anchor.Sqft) || resolution.Params.Anchor.Sqft <= 0)
                    throw new InvalidDataException($"{resolutionsPath}: merge anchor sqft must be positive and finite.");
            }
            if (resolution.Action == "claim-residue"
                && resolution.Params is not { ResidueId.Length: > 0 })
                throw new InvalidDataException($"{resolutionsPath}: claim-residue params require residueId.");
            if (resolution.Action == "claim-residue" && resolution.Params is { Into.Length: > 0, Anchor: null })
                throw new InvalidDataException($"{resolutionsPath}: claim-residue into requires a target anchor.");
            if (resolution.Anchor is not null)
            {
                ValidatePoint(resolution.Anchor.Label, resolutionsPath);
                if (!double.IsFinite(resolution.Anchor.Sqft) || resolution.Anchor.Sqft <= 0)
                    throw new InvalidDataException($"{resolutionsPath}: anchor sqft must be positive and finite.");
            }
        }

        var rooms = levels.SelectMany(level => level.Rooms.Select(room => new RoomReference(
            level.LevelName, $"{level.LevelName}:{room.Id}", room))).ToList();
        var residues = levels.SelectMany(level => level.Residues.Select(residue => new ResidueReference(
            level.LevelName, $"{level.LevelName}:{residue.Id}", residue))).ToList();
        var byKey = new Dictionary<string, List<FlagResolution>>(StringComparer.Ordinal);
        var splitTargets = new HashSet<string>(StringComparer.Ordinal);
        var mergeSources = new HashSet<string>(StringComparer.Ordinal);
        var mergedByTarget = new Dictionary<string, TakeoffRoomShape>(StringComparer.Ordinal);
        var claimedResidues = new HashSet<string>(StringComparer.Ordinal);
        var promoted = new Dictionary<string, List<TakeoffRoomShape>>(StringComparer.Ordinal);
        var applied = 0;
        var remapped = 0;
        var orphaned = 0;
        foreach (var resolution in file.Resolutions)
        {
            if (resolution.Action == "claim-residue")
            {
                var parameters = resolution.Params!;
                var separator = resolution.CandidateKey.LastIndexOf(':');
                if (parameters.ResidueId != resolution.CandidateKey[(separator + 1)..])
                {
                    orphaned++;
                    continue;
                }
                var residueResolution = ResolveResidue(
                    residues, file.Version, resolution.CandidateKey, resolution.Anchor);
                var source = residueResolution.Target;
                if (source is null || claimedResidues.Contains(source.Key))
                {
                    orphaned++;
                    continue;
                }
                var residueRemapped = residueResolution.Remapped;
                if (!string.IsNullOrEmpty(parameters.Into))
                {
                    var targetResolution = ResolveCandidate(
                        rooms, file.Version, parameters.Into, parameters.Anchor);
                    var target = targetResolution.Target;
                    if (target is null || target.LevelName != source.LevelName || mergeSources.Contains(target.Key))
                    {
                        orphaned++;
                        continue;
                    }
                    var residueRoom = new TakeoffRoomShape(
                        source.Residue.Id, source.Residue.RawSqft, RingPerimeter(source.Residue.Outer),
                        source.Residue.MeanCeilingFt, source.Residue.Outer, source.Residue.Holes
                    ) { Label = source.Residue.Label };
                    var targetRoom = mergedByTarget.GetValueOrDefault(target.Key) ?? target.Room;
                    var merged = MergeShapes(residueRoom, targetRoom, resolution.Flag);
                    if (merged is null)
                    {
                        orphaned++;
                        continue;
                    }
                    mergedByTarget[target.Key] = merged with { MergedFrom = targetRoom.MergedFrom };
                    residueRemapped |= targetResolution.Remapped;
                }
                else
                {
                    if (!promoted.TryGetValue(source.LevelName, out var levelPromoted))
                        promoted[source.LevelName] = levelPromoted = new List<TakeoffRoomShape>();
                    levelPromoted.Add(new TakeoffRoomShape(
                        source.Residue.Id, source.Residue.RawSqft, RingPerimeter(source.Residue.Outer),
                        source.Residue.MeanCeilingFt, source.Residue.Outer, source.Residue.Holes
                    ) { Label = source.Residue.Label });
                }
                claimedResidues.Add(source.Key);
                if (residueRemapped) remapped++; else applied++;
                continue;
            }
            var sourceResolution = ResolveCandidate(
                rooms, file.Version, resolution.CandidateKey, resolution.Anchor);
            var sourceCandidate = sourceResolution.Target;
            if (sourceCandidate is null)
            {
                orphaned++;
                continue;
            }
            if (resolution.Action == "split"
                && (resolution.Params is not { A: not null, B: not null }
                    || splitTargets.Contains(sourceCandidate.Key)
                    || SplitShape(sourceCandidate.Room, resolution.Params.A, resolution.Params.B) is null))
            {
                orphaned++;
                continue;
            }
            if (resolution.Action == "split")
                splitTargets.Add(sourceCandidate.Key);
            var wasRemapped = sourceResolution.Remapped;
            if (resolution.Action == "merge")
            {
                var parameters = resolution.Params;
                var survivorResolution = parameters is { Other: not null, Anchor: not null }
                    ? ResolveCandidate(rooms, file.Version, parameters.Other, parameters.Anchor)
                    : default;
                var survivor = survivorResolution.Target;
                if (survivor is null
                    || survivor.Key == sourceCandidate.Key
                    || survivor.LevelName != sourceCandidate.LevelName
                    || mergeSources.Contains(sourceCandidate.Key)
                    || mergeSources.Contains(survivor.Key))
                {
                    orphaned++;
                    continue;
                }
                var merged = MergeShapes(
                    mergedByTarget.GetValueOrDefault(sourceCandidate.Key) ?? sourceCandidate.Room,
                    mergedByTarget.GetValueOrDefault(survivor.Key) ?? survivor.Room,
                    resolution.Flag);
                if (merged is null)
                {
                    orphaned++;
                    continue;
                }
                mergeSources.Add(sourceCandidate.Key);
                mergedByTarget.Remove(sourceCandidate.Key);
                mergedByTarget[survivor.Key] = merged;
                wasRemapped |= survivorResolution.Remapped;
            }
            if (wasRemapped) remapped++;
            else applied++;
            if (resolution.Action == "merge")
                continue;
            if (!byKey.TryGetValue(sourceCandidate.Key, out var targetResolutions))
            {
                targetResolutions = new List<FlagResolution>();
                byKey.Add(sourceCandidate.Key, targetResolutions);
            }
            targetResolutions.Add(resolution);
        }

        var resolved = levels.Select(level => {
            var rejected = new List<TakeoffResidueShape>();
            return level with {
                Rooms = level.Rooms.SelectMany(room => {
                    var key = $"{level.LevelName}:{room.Id}";
                    if (mergeSources.Contains(key))
                        return Array.Empty<TakeoffRoomShape>();
                    return ApplyRoomResolutions(
                        level.LevelName,
                        mergedByTarget.TryGetValue(key, out var merged) ? merged : room,
                        byKey,
                        rejected);
                }).Concat(promoted.GetValueOrDefault(level.LevelName)
                    ?? Enumerable.Empty<TakeoffRoomShape>()).ToList(),
                Residues = level.Residues
                    .Where(residue => !claimedResidues.Contains($"{level.LevelName}:{residue.Id}"))
                    .Concat(rejected)
                    .ToList(),
            };
        }).ToList();
        return new ResolutionApplyResult(resolved, applied, remapped, orphaned);
    }

    private static (RoomReference? Target, bool Remapped) ResolveCandidate(
        IReadOnlyList<RoomReference> rooms,
        int version,
        string key,
        ResolutionAnchor? anchor
    )
    {
        var exact = rooms.FirstOrDefault(room => room.Key == key);
        if (version == 1)
            return (exact, false);
        if (anchor is null)
            return (null, false);
        if (exact is not null
            && Contains(exact.Room, anchor.Label)
            && Math.Abs(exact.Room.RawSqft - anchor.Sqft) <= anchor.Sqft * 0.2)
            return (exact, false);
        var separator = key.LastIndexOf(':');
        var levelName = separator < 0 ? "" : key[..separator];
        return (rooms.FirstOrDefault(room => room.LevelName == levelName
            && Contains(room.Room, anchor.Label)), true);
    }

    private static (ResidueReference? Target, bool Remapped) ResolveResidue(
        IReadOnlyList<ResidueReference> residues,
        int version,
        string key,
        ResolutionAnchor? anchor
    )
    {
        var exact = residues.FirstOrDefault(residue => residue.Key == key);
        if (version == 1) return (exact, false);
        if (anchor is null) return (null, false);
        if (exact is not null
            && Contains(exact.Residue.Outer, exact.Residue.Holes, anchor.Label)
            && Math.Abs(exact.Residue.RawSqft - anchor.Sqft) <= anchor.Sqft * 0.2)
            return (exact, false);
        var separator = key.LastIndexOf(':');
        var levelName = separator < 0 ? "" : key[..separator];
        return (residues.FirstOrDefault(residue => residue.LevelName == levelName
            && Contains(residue.Residue.Outer, residue.Residue.Holes, anchor.Label)), true);
    }

    private static bool Contains(TakeoffRoomShape room, double[] point) =>
        Contains(room.Outer, room.Holes, point);

    private static bool Contains(List<double[]> outer, List<List<double[]>> holes, double[] point) =>
        InsideLoop(outer, point[0], point[1])
        && holes.All(hole => !InsideLoop(hole, point[0], point[1]));

    private static IEnumerable<TakeoffRoomShape> ApplyRoomResolutions(
        string levelName,
        TakeoffRoomShape room,
        IReadOnlyDictionary<string, List<FlagResolution>> byKey,
        ICollection<TakeoffResidueShape> rejected
    )
    {
        if (!byKey.TryGetValue($"{levelName}:{room.Id}", out var resolutions))
            return new[] { room };

        var accepted = resolutions
            .Where(resolution => resolution.Action == "accept")
            .Select(resolution => resolution.Flag)
            .ToHashSet(StringComparer.Ordinal);
        var split = resolutions.FirstOrDefault(resolution =>
            resolution.Action == "split"
            && resolution.Params is { A: not null, B: not null });
        var remaining = room.Flags.Where(flag => !accepted.Contains(flag)).ToList();

        if (resolutions.Any(resolution => resolution.Action == "reject"))
        {
            rejected.Add(new TakeoffResidueShape(
                room.Id, ResidueReason.Rejected, room.RawSqft, room.MeanCeilingFt,
                room.Label, room.Outer, room.Holes) { Claimed = true });
            return Array.Empty<TakeoffRoomShape>();
        }

        if (split?.Params is { A: { } a, B: { } b })
        {
            var halves = SplitShape(room, a, b);
            if (halves is not null)
            {
                var childFlags = remaining.Where(flag => flag != split.Flag).ToList();
                return halves.Select(half => half with { Flags = new List<string>(childFlags) });
            }
        }

        return remaining.Count == room.Flags.Count
            ? new[] { room }
            : new[] { room with { Flags = remaining } };
    }

    private sealed record DirectedSegment(double[] A, double[] B);

    /// <summary>Unions adjacent, non-overlapping detector polygons by cancelling their shared boundary.</summary>
    private static TakeoffRoomShape? MergeShapes(
        TakeoffRoomShape source,
        TakeoffRoomShape target,
        string resolvedFlag
    )
    {
        var edges = new[] { source.Outer, target.Outer }
            .SelectMany(ring => ring.Select((point, index) => new DirectedSegment(
                SnapPoint(point), SnapPoint(ring[(index + 1) % ring.Count]))))
            .ToList();
        var endpoints = edges.SelectMany(edge => new[] { edge.A, edge.B }).ToList();
        var pieces = new List<DirectedSegment>();
        // ponytail: O(n^2) endpoint noding is fine for two room rings; use a clipping
        // library if resolutions ever merge large arbitrary polygon sets.
        foreach (var edge in edges)
        {
            var dx = edge.B[0] - edge.A[0];
            var dy = edge.B[1] - edge.A[1];
            var cuts = endpoints
                .Where(point => PointOnSegment(point, edge))
                .GroupBy(PointKey)
                .Select(group => group.First())
                .OrderBy(point => Math.Abs(dx) >= Math.Abs(dy)
                    ? (point[0] - edge.A[0]) / dx
                    : (point[1] - edge.A[1]) / dy)
                .ToList();
            for (var index = 0; index < cuts.Count - 1; index++)
                if (PointKey(cuts[index]) != PointKey(cuts[index + 1]))
                    pieces.Add(new DirectedSegment(cuts[index], cuts[index + 1]));
        }

        var boundary = new List<DirectedSegment>();
        var shared = false;
        foreach (var group in pieces.GroupBy(piece => {
            var a = PointKey(piece.A);
            var b = PointKey(piece.B);
            return string.CompareOrdinal(a, b) < 0 ? $"{a}|{b}" : $"{b}|{a}";
        }))
        {
            var pair = group.ToList();
            if (pair.Count == 1)
                boundary.Add(pair[0]);
            else if (pair.Count == 2
                && PointKey(pair[0].A) == PointKey(pair[1].B)
                && PointKey(pair[0].B) == PointKey(pair[1].A))
                shared = true;
            else
                return null;
        }
        if (!shared)
            return null;

        var outgoing = boundary
            .Select((edge, index) => (edge, index))
            .GroupBy(item => PointKey(item.edge.A))
            .ToDictionary(group => group.Key, group => group.Select(item => item.index).ToList());
        var unused = Enumerable.Range(0, boundary.Count).ToHashSet();
        var loops = new List<List<double[]>>();
        while (unused.Count > 0)
        {
            var first = unused.First();
            var start = PointKey(boundary[first].A);
            var loop = new List<double[]> { boundary[first].A };
            var index = first;
            var closed = false;
            for (var step = 0; step <= boundary.Count; step++)
            {
                if (!unused.Remove(index))
                    return null;
                var edge = boundary[index];
                var end = PointKey(edge.B);
                if (end == start)
                {
                    closed = true;
                    break;
                }
                loop.Add(edge.B);
                var next = outgoing.GetValueOrDefault(end)?.Where(unused.Contains).ToList();
                if (next is not { Count: 1 })
                    return null;
                index = next[0];
            }
            if (!closed)
                return null;
            loops.Add(loop);
        }
        if (loops is not [{ Count: >= 3 }])
            return null;
        var outer = SignedArea(loops[0]) > 0 ? loops[0] : loops[0].AsEnumerable().Reverse().ToList();
        var flags = target.Flags
            .Concat(source.Flags.Where(flag => flag != resolvedFlag))
            .Distinct(StringComparer.Ordinal)
            .OrderBy(flag => flag, StringComparer.Ordinal)
            .ToList();
        return target with {
            RawSqft = source.RawSqft + target.RawSqft,
            PerimeterFt = RingPerimeter(outer),
            Outer = outer,
            Holes = target.Holes.Concat(source.Holes).ToList(),
            Flags = flags,
            MergedFrom = source.MergedFrom ?? source.Id,
        };
    }

    private static double[] SnapPoint(double[] point) => new[] { Snap(point[0]), Snap(point[1]) };

    private static double Snap(double value) => Math.Floor((value * 1e6) + 0.5) / 1e6;

    private static string PointKey(double[] point) =>
        $"{Snap(point[0]).ToString("0.######", CultureInfo.InvariantCulture)}," +
        Snap(point[1]).ToString("0.######", CultureInfo.InvariantCulture);

    private static bool PointOnSegment(double[] point, DirectedSegment segment)
    {
        var dx = segment.B[0] - segment.A[0];
        var dy = segment.B[1] - segment.A[1];
        var px = point[0] - segment.A[0];
        var py = point[1] - segment.A[1];
        var dot = (px * dx) + (py * dy);
        return Math.Abs((dx * py) - (dy * px)) <= 1e-6 * Math.Max(1, Math.Sqrt((dx * dx) + (dy * dy)))
            && dot >= -1e-6
            && dot <= (dx * dx) + (dy * dy) + 1e-6;
    }

    private static TakeoffRoomShape[]? SplitShape(TakeoffRoomShape room, double[] a, double[] b)
    {
        if (room.Outer.Count < 3)
            return null;
        var snapA = NearestOnRing(room.Outer, a);
        var snapB = NearestOnRing(room.Outer, b);
        if (Distance(snapA.Point, snapB.Point) < 1e-6)
            return null;

        var half1 = Dedupe(WalkBetween(room.Outer, snapA, snapB));
        var half2 = Dedupe(WalkBetween(room.Outer, snapB, snapA));
        if (half1.Count < 3 || half2.Count < 3)
            return null;
        var area1 = Math.Abs(SignedArea(half1));
        var area2 = Math.Abs(SignedArea(half2));
        if (area1 < 1 || area2 < 1)
            return null;

        var holes1 = new List<List<double[]>>();
        var holes2 = new List<List<double[]>>();
        foreach (var hole in room.Holes)
        {
            var centroid = CentroidOf(hole);
            (InsideLoop(half1, centroid[0], centroid[1]) ? holes1 : holes2).Add(hole);
        }

        TakeoffRoomShape Make(string suffix, List<double[]> outer, List<List<double[]>> holes, double grossArea) =>
            new(
                $"{room.Id}.{suffix}",
                grossArea - holes.Sum(hole => Math.Abs(SignedArea(hole))),
                RingPerimeter(outer),
                room.MeanCeilingFt,
                outer,
                holes
            ) {
                Label = CentroidOf(outer),
                SplitFrom = room.SplitFrom ?? room.Id,
            };

        var centroid1 = CentroidOf(half1);
        var centroid2 = CentroidOf(half2);
        var firstIsA = area1 != area2
            ? area1 > area2
            : centroid1[0] != centroid2[0]
                ? centroid1[0] < centroid2[0]
                : centroid1[1] <= centroid2[1];
        return firstIsA
            ? new[] { Make("a", half1, holes1, area1), Make("b", half2, holes2, area2) }
            : new[] { Make("a", half2, holes2, area2), Make("b", half1, holes1, area1) };
    }

    private static RingSnap NearestOnRing(List<double[]> ring, double[] point)
    {
        var best = new RingSnap(0, 0, ring[0]);
        var bestDistance = double.PositiveInfinity;
        for (var index = 0; index < ring.Count; index++)
        {
            var a = ring[index];
            var b = ring[(index + 1) % ring.Count];
            var dx = b[0] - a[0];
            var dy = b[1] - a[1];
            var lengthSquared = (dx * dx) + (dy * dy);
            var t = lengthSquared < 1e-12
                ? 0
                : BclCompat.Clamp((((point[0] - a[0]) * dx) + ((point[1] - a[1]) * dy)) / lengthSquared, 0, 1);
            var snapped = new[] { a[0] + (t * dx), a[1] + (t * dy) };
            var distance = Distance(point, snapped);
            if (distance < bestDistance)
            {
                bestDistance = distance;
                best = new RingSnap(index, t, snapped);
            }
        }
        return best;
    }

    private static List<double[]> WalkBetween(List<double[]> ring, RingSnap from, RingSnap to)
    {
        var result = new List<double[]> { from.Point };
        if (from.Edge == to.Edge && to.T >= from.T)
        {
            result.Add(to.Point);
            return result;
        }
        var index = (from.Edge + 1) % ring.Count;
        for (var step = 0; step <= ring.Count; step++)
        {
            result.Add(ring[index]);
            if (index == to.Edge)
                break;
            index = (index + 1) % ring.Count;
        }
        result.Add(to.Point);
        return result;
    }

    private static List<double[]> Dedupe(List<double[]> ring) => ring
        .Where((point, index) => Distance(point, ring[(index + ring.Count - 1) % ring.Count]) > 1e-6)
        .ToList();

    private static double[] CentroidOf(List<double[]> ring)
    {
        var area = 0.0;
        var x = 0.0;
        var y = 0.0;
        for (var index = 0; index < ring.Count; index++)
        {
            var a = ring[index];
            var b = ring[(index + 1) % ring.Count];
            var cross = (a[0] * b[1]) - (b[0] * a[1]);
            area += cross;
            x += (a[0] + b[0]) * cross;
            y += (a[1] + b[1]) * cross;
        }
        return Math.Abs(area) < 1e-9 ? ring[0] : new[] { x / (3 * area), y / (3 * area) };
    }

    private static double RingPerimeter(List<double[]> ring) => ring
        .Select((point, index) => Distance(point, ring[(index + 1) % ring.Count]))
        .Sum();

    private static double Distance(double[] a, double[] b) =>
        Math.Sqrt(((a[0] - b[0]) * (a[0] - b[0])) + ((a[1] - b[1]) * (a[1] - b[1])));

    private static void ValidatePoint(double[]? point, string path)
    {
        if (point is not { Length: 2 } || point.Any(value => !double.IsFinite(value)))
            throw new InvalidDataException($"{path}: split points must be finite [x, y] pairs.");
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

    // ── raster simplification ─────────────────────────────────────────────────────────────────
    // The detector emits marching-squares staircase outlines on its raster grid, so diagonal
    // walls arrive as hundreds of one-cell steps: every step edge falls under MinWallEdgeFeet
    // (walls vanish from the envelope) and any length summed from the raw outline overstates
    // diagonals by up to sqrt(2). Collapse collinear runs, then Douglas-Peucker with tolerance =
    // one grid cell, derived from the data. Mirror of apps/web/src/rhvac/takeoff.ts — keep the
    // algorithm and tolerance semantics aligned.

    /// <summary>Most frequent repeated sub-limit axis component = detector grid pitch.</summary>
    internal static double? DeriveGridPitch(IEnumerable<List<double[]>> loops)
    {
        var components = new List<double>();
        foreach (var loop in loops)
        {
            for (var i = 0; i < loop.Count; i++)
            {
                var p = loop[i];
                var q = loop[(i + 1) % loop.Count];
                var dx = Math.Abs(q[0] - p[0]);
                var dy = Math.Abs(q[1] - p[1]);
                if (dx > 1e-6)
                    components.Add(dx);
                if (dy > 1e-6)
                    components.Add(dy);
            }
        }

        return components
            .Where(component => component <= MaxRasterPitchFeet)
            .GroupBy(component => Math.Round(component, 6, MidpointRounding.AwayFromZero))
            .Where(group => group.Count() > 1)
            .OrderByDescending(group => group.Count())
            .ThenBy(group => group.Key)
            .Select(group => (double?)group.Key)
            .FirstOrDefault();
    }

    private static void SimplifyLevelLoops(List<TakeoffRoomShape> rooms)
    {
        var pitch = DeriveGridPitch(rooms.SelectMany(room => room.Holes.Prepend(room.Outer)));
        if (pitch is not <= MaxRasterPitchFeet)
            return;
        foreach (var room in rooms)
        {
            var (outer, holes) = SimplifyShape(room.Outer, room.Holes, pitch.Value);
            room.Outer.Clear();
            room.Outer.AddRange(outer);
            room.Holes.Clear();
            room.Holes.AddRange(holes);
        }
    }

    /// <summary>
    /// Simplifies a room shape, adaptively: Douglas-Peucker at one grid cell, halving the
    /// tolerance while the shape's net area (outer minus holes — the exported truth RawSqft
    /// cross-checks against) drifts past the gate (max of 0.5 sqft and 1%). Sawtooth slivers no
    /// tolerance can straighten honestly fall back to an area-exact collinear collapse.
    /// </summary>
    private static (List<double[]> Outer, List<List<double[]>> Holes) SimplifyShape(
        List<double[]> outer,
        List<List<double[]>> holes,
        double pitch
    )
    {
        static double NetArea(List<double[]> o, List<List<double[]>> hs) =>
            Math.Abs(SignedArea(o)) - hs.Sum(hole => Math.Abs(SignedArea(hole)));

        var rawArea = NetArea(outer, holes);
        var gate = Math.Max(0.5, 0.01 * Math.Abs(rawArea));
        foreach (var tolerance in new[] { pitch, pitch / 2, pitch / 4 })
        {
            var simpleOuter = SimplifyOnce(outer, pitch, tolerance);
            if (simpleOuter.Count < 3)
                continue;
            var simpleHoles = holes
                .Select(hole => SimplifyOnce(hole, pitch, tolerance))
                .Where(hole => hole.Count >= 3)
                .ToList();
            if (Math.Abs(NetArea(simpleOuter, simpleHoles) - rawArea) <= gate)
                return (simpleOuter, simpleHoles);
        }

        var exactOuter = CollapseCollinear(outer);
        var exactHoles = holes.Select(CollapseCollinear).Where(hole => hole.Count >= 3).ToList();
        return exactOuter.Count >= 3 ? (exactOuter, exactHoles) : (outer, holes);
    }

    /// <summary>
    /// One simplification attempt. Staircase edges (a few cells or shorter) are replaced by their
    /// midpoints — for a uniform marching-squares staircase those lie exactly on the true wall
    /// line, so straightening is area-unbiased (anchoring Douglas-Peucker on staircase corners
    /// instead shaves ~pitch/2 x length off every diagonal). Long edges keep their endpoints, so
    /// real corners stay exact. Then collinear runs collapse and Douglas-Peucker runs on the two
    /// chains between vertex 0 and the vertex farthest from it (the split makes DP well-defined
    /// on a ring).
    /// </summary>
    private static List<double[]> SimplifyOnce(List<double[]> ring, double pitch, double tolerance)
    {
        var stairMax = StairEdgeCells * pitch;
        var mid = new List<double[]>(ring.Count);
        for (var i = 0; i < ring.Count; i++)
        {
            var a = ring[i];
            var b = ring[(i + 1) % ring.Count];
            if (Math.Sqrt(((b[0] - a[0]) * (b[0] - a[0])) + ((b[1] - a[1]) * (b[1] - a[1]))) <= stairMax)
                mid.Add(new[] { (a[0] + b[0]) / 2, (a[1] + b[1]) / 2 });
            else
            {
                mid.Add(a);
                mid.Add(b);
            }
        }

        var pts = CollapseCollinear(mid);
        if (pts.Count < 4)
            return pts;

        var far = 0;
        var farDist = -1.0;
        for (var i = 1; i < pts.Count; i++)
        {
            var d = Math.Sqrt(
                ((pts[i][0] - pts[0][0]) * (pts[i][0] - pts[0][0]))
                + ((pts[i][1] - pts[0][1]) * (pts[i][1] - pts[0][1]))
            );
            if (d > farDist)
            {
                farDist = d;
                far = i;
            }
        }

        var chainA = SimplifyChain(pts.GetRange(0, far + 1), tolerance);
        var chainB = SimplifyChain(pts.GetRange(far, pts.Count - far).Append(pts[0]).ToList(), tolerance);
        var result = chainA.Take(chainA.Count - 1).Concat(chainB.Take(chainB.Count - 1)).ToList();
        return result.Count >= 3 ? result : pts;
    }

    /// <summary>Drops consecutive duplicates and exactly-collinear vertices — area-exact.</summary>
    private static List<double[]> CollapseCollinear(List<double[]> ring)
    {
        var deduped = ring
            .Where((p, i) =>
            {
                var prev = ring[(i + ring.Count - 1) % ring.Count];
                return Math.Abs(p[0] - prev[0]) > 1e-9 || Math.Abs(p[1] - prev[1]) > 1e-9;
            })
            .ToList();
        return deduped
            .Where((p, i) =>
            {
                var prev = deduped[(i + deduped.Count - 1) % deduped.Count];
                var next = deduped[(i + 1) % deduped.Count];
                return Deviation(p, prev, next) > 1e-9;
            })
            .ToList();
    }

    /// <summary>Douglas-Peucker over an open chain; endpoints are always kept.</summary>
    private static List<double[]> SimplifyChain(List<double[]> pts, double tolerance)
    {
        var keep = new bool[pts.Count];
        keep[0] = keep[pts.Count - 1] = true;
        var spans = new Stack<(int First, int Last)>();
        spans.Push((0, pts.Count - 1));
        while (spans.Count > 0)
        {
            var (first, last) = spans.Pop();
            var maxDeviation = tolerance;
            var split = -1;
            for (var i = first + 1; i < last; i++)
            {
                var d = Deviation(pts[i], pts[first], pts[last]);
                if (d > maxDeviation)
                {
                    maxDeviation = d;
                    split = i;
                }
            }

            if (split >= 0)
            {
                keep[split] = true;
                spans.Push((first, split));
                spans.Push((split, last));
            }
        }

        return pts.Where((_, i) => keep[i]).ToList();
    }

    /// <summary>Perpendicular distance from p to the (a, b) line; plain distance when a≈b.</summary>
    private static double Deviation(double[] p, double[] a, double[] b)
    {
        var abx = b[0] - a[0];
        var aby = b[1] - a[1];
        var apx = p[0] - a[0];
        var apy = p[1] - a[1];
        var len = Math.Sqrt((abx * abx) + (aby * aby));
        return len < 1e-9
            ? Math.Sqrt((apx * apx) + (apy * apy))
            : Math.Abs((abx * apy) - (aby * apx)) / len;
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
