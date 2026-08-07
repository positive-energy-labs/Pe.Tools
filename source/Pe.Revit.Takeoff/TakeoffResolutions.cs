using Newtonsoft.Json;

namespace Pe.Revit.Takeoff;

/// <summary>Resolved levels plus loss accounting for every sidecar decision.</summary>
public sealed record ResolutionApplyResult(
    List<LevelTakeoff> Levels,
    int Applied,
    int Remapped,
    int Orphaned
);

public static class TakeoffResolutions
{
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

    private static bool InsideLoop(List<double[]> loop, double x, double y)
    {
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
}
