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
        ResolutionAnchor? Anchor
    );
    private sealed record ResolutionAnchor(double[] Label, double Sqft);
    private sealed record RoomReference(string LevelName, string Key, TakeoffRoomShape Room);

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
            // split/merge/claim-residue are RETIRED (geometry is authored in Revit now). They stay
            // in the accepted vocabulary so a pre-pivot sidecar still loads, but they can no
            // longer be replayed — the loop below counts each one as an orphan so the loss is
            // reported rather than silently dropped. The TS twin does the same.
            if (resolution.Action is not
                ("accept" or "reject" or "split" or "merge" or "claim-residue"))
                throw new InvalidDataException($"{resolutionsPath}: unknown action '{resolution.Action}'.");
            if (resolution.Anchor is not null)
            {
                ValidatePoint(resolution.Anchor.Label, resolutionsPath);
                if (!resolution.Anchor.Sqft.IsFinite() || resolution.Anchor.Sqft <= 0)
                    throw new InvalidDataException($"{resolutionsPath}: anchor sqft must be positive and finite.");
            }
        }

        var rooms = levels.SelectMany(level => level.Rooms.Select(room => new RoomReference(
            level.LevelName, $"{level.LevelName}:{room.Id}", room))).ToList();
        var byKey = new Dictionary<string, List<FlagResolution>>(StringComparer.Ordinal);
        var applied = 0;
        var remapped = 0;
        var orphaned = 0;
        foreach (var resolution in file.Resolutions)
        {
            if (resolution.Action is not ("accept" or "reject"))
            {
                orphaned++;
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
            if (sourceResolution.Remapped) remapped++;
            else applied++;
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
                Rooms = level.Rooms
                    .SelectMany(room => ApplyRoomResolutions(level.LevelName, room, byKey, rejected))
                    .ToList(),
                Residues = level.Residues.Concat(rejected).ToList(),
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

    private static bool Contains(TakeoffRoomShape room, double[] point) =>
        InsideLoop(room.Outer, point[0], point[1])
        && room.Holes.All(hole => !InsideLoop(hole, point[0], point[1]));

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
        var remaining = room.Flags.Where(flag => !accepted.Contains(flag)).ToList();

        if (resolutions.Any(resolution => resolution.Action == "reject"))
        {
            rejected.Add(new TakeoffResidueShape(
                room.Id, ResidueReason.Rejected, room.RawSqft, room.MeanCeilingFt,
                room.Label, room.Outer, room.Holes) { Claimed = true });
            return Array.Empty<TakeoffRoomShape>();
        }

        return remaining.Count == room.Flags.Count
            ? new[] { room }
            : new[] { room with { Flags = remaining } };
    }

    private static void ValidatePoint(double[]? point, string path)
    {
        if (point is not { Length: 2 } || point.Any(value => !value.IsFinite()))
            throw new InvalidDataException($"{path}: anchor labels must be finite [x, y] pairs.");
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
}
