namespace Pe.Shared.Scripting.Pods.Standards;

public static class PodLayout {
    public const string ManifestFile = "pod.json";
    public const string FileIndexFile = "manifest.json";
    public const string SettingsRoot = "settings";
    public const string ComposedRoot = "composed";
    public const string SourceRoot = "src";

    /// <summary>Verdict 10: schema by suffix. A settings document with no known suffix has no schema.</summary>
    public static IReadOnlyDictionary<string, string> DocumentSuffixes { get; } =
        new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase) {
            [".patch.json"] = "https://pe.tools/schemas/family-patch.json",
            [".family.json"] = "https://pe.tools/schemas/family-model.json"
        };

    public static string? SuffixOf(PodPath path) =>
        DocumentSuffixes.Keys.FirstOrDefault(suffix => path.Value.EndsWith(suffix, StringComparison.OrdinalIgnoreCase));
}

/// <summary>
///     What the build knows about another pod. It started as metadata only — id, version, and the
///     file names the manifest claims — because verdict 3 (one version per id) leaves nothing to
///     solve. It could not stay metadata: verdicts 4 and 8 require the build to inline another
///     pod's composed bytes, so the entry has to carry contents. See the adversary report finding 1.
/// </summary>
public sealed record PodWorldEntry(PodId Id, PodVersion Version, IReadOnlyDictionary<string, string> ComposedFiles) {
    public IReadOnlySet<string> FileNames { get; } = ComposedFiles.Keys.ToHashSet(StringComparer.OrdinalIgnoreCase);
}

public sealed record PodWorld(IReadOnlyDictionary<PodId, PodWorldEntry> Pods) {
    public static PodWorld Empty { get; } = new(new Dictionary<PodId, PodWorldEntry>());

    /// <summary>
    ///     Verdict 3's one-version-per-id rule lives here, in the constructor of the set, because it
    ///     is a property of the machine and never of a pod.
    /// </summary>
    public static bool TryCreate(IEnumerable<PodWorldEntry> entries, out PodWorld world, out string? reason) {
        var map = new Dictionary<PodId, PodWorldEntry>();
        foreach (var entry in entries) {
            if (map.TryGetValue(entry.Id, out var existing)) {
                world = Empty;
                reason = $"Pod '{entry.Id}' is installed twice, at {existing.Version} and {entry.Version}. One version per id; upgrade replaces in place.";
                return false;
            }

            map[entry.Id] = entry;
        }

        world = new PodWorld(map);
        reason = null;
        return true;
    }
}

/// <summary>Everything the deterministic gates read. No filesystem, no network, no Revit.</summary>
public sealed record PodBuildSubject(
    PodHeader Header,
    PodSnapshot Snapshot,
    PodWorld World,
    IReadOnlyDictionary<string, ComposedDocument> FreshCompose,
    IReadOnlyList<string> ComposeErrors,
    bool OnlineChecksRan
);
