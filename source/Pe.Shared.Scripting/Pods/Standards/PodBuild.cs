namespace Pe.Shared.Scripting.Pods.Standards;

/// <summary>
///     The pod state model. Ownership is the union, not a flag: a write API takes
///     <see cref="Owned" /> and the read-only-installed rule needs no runtime check.
/// </summary>
public abstract record Pod {
    private Pod() { }

    public abstract PodHeader Header { get; }

    /// <summary>A claim about disk at one instant. Nothing derived from it may outlive it.</summary>
    public abstract PodSnapshot Snapshot { get; }

    public sealed record Owned(PodHeader Header, PodSnapshot Snapshot) : Pod {
        public override PodHeader Header { get; } = Header;
        public override PodSnapshot Snapshot { get; } = Snapshot;
    }

    public sealed record Installed(PodHeader Header, PodSnapshot Snapshot, PodOrigin Origin) : Pod {
        public override PodHeader Header { get; } = Header;
        public override PodSnapshot Snapshot { get; } = Snapshot;
    }

    public static Pod From(PodHeader header, PodSnapshot snapshot) => header.Ownership switch {
        PodOwnership.Installed installed => new Installed(header, snapshot, installed.Origin),
        _ => new Owned(header, snapshot)
    };
}

/// <summary>
///     "Built" is not a stored state; it is a proof carrying the snapshot it was proven against.
///     Constructible only by <see cref="PodBuilder" /> on a clean deterministic report, so a
///     drifted pod cannot be typed as built. It can still be *stale*: see report finding 2.
/// </summary>
public sealed class BuiltPod {
    private BuiltPod(Pod.Owned pod, PodBuildReceipt receipt) {
        this.Pod = pod;
        this.Receipt = receipt;
    }

    public Pod.Owned Pod { get; }
    public PodBuildReceipt Receipt { get; }

    internal static BuiltPod Prove(Pod.Owned pod, PodBuildReceipt receipt) => new(pod, receipt);
}

/// <summary>Verdict 4: the receipt records order and each podId@version+hash.</summary>
public sealed record PodBuildReceipt(
    PodId Id,
    PodVersion Version,
    string ComposedHash,
    IReadOnlyList<PodLayerStamp> Layers,
    IReadOnlyList<PodGateFinding> Warnings
);

public sealed record PodLayerStamp(PodId Id, PodVersion Version, string Hash) {
    public override string ToString() => $"{this.Id}@{this.Version}+{this.Hash[..Math.Min(12, this.Hash.Length)]}";
}

public abstract record PodBuildOutcome {
    private PodBuildOutcome() { }

    public sealed record Built(BuiltPod Pod) : PodBuildOutcome;

    public sealed record Refused(PodBuildReport Report) : PodBuildOutcome;
}

public static class PodBuilder {
    /// <summary>
    ///     Verdict 5: publishing is composing and composing is the build. One entry point;
    ///     the header parse is the only thing that runs before the gate list.
    /// </summary>
    public static PodBuildOutcome Build(PodSnapshot snapshot, PodWorld world, bool online) {
        var manifestJson = snapshot.Read(PodPath.Parse(PodLayout.ManifestFile));
        if (manifestJson is null)
            return new PodBuildOutcome.Refused(new PodBuildReport([
                new PodGateFinding("pod.manifest", PodGateLane.Deterministic, PodGateSeverity.Error, PodLayout.ManifestFile,
                    $"'{snapshot.DirectoryName}' has no pod.json; it is a loose workspace, not a pod.")
            ]));

        var read = PodHeaderReader.Read(manifestJson);
        if (read.Header is null)
            return new PodBuildOutcome.Refused(new PodBuildReport(read.Findings));

        var (fresh, composeErrors, layers) = ComposeAll(read.Header, snapshot, world);
        var subject = new PodBuildSubject(read.Header, snapshot, world, fresh, composeErrors, online);
        var report = new PodBuildReport([.. read.Findings, .. PodGateRunner.Run(subject, PodGateCatalog.All, online).Findings]);

        if (!report.Passed || Pod.From(read.Header, snapshot) is not Pod.Owned owned)
            return new PodBuildOutcome.Refused(report);

        var composedHash = PodSnapshot.Sha256(string.Concat(fresh.OrderBy(p => p.Key, StringComparer.Ordinal).Select(p => p.Key + ":" + PodSnapshot.Sha256(p.Value.Serialize()))));
        return new PodBuildOutcome.Built(BuiltPod.Prove(owned, new PodBuildReceipt(read.Header.Id, read.Header.Version, composedHash, layers, [.. report.Findings])));
    }

    private static (IReadOnlyDictionary<string, ComposedDocument> Fresh, IReadOnlyList<string> Errors, IReadOnlyList<PodLayerStamp> Layers) ComposeAll(
        PodHeader header,
        PodSnapshot snapshot,
        PodWorld world
    ) {
        var resolver = new SnapshotResolver(snapshot, world);
        var fresh = new Dictionary<string, ComposedDocument>(StringComparer.OrdinalIgnoreCase);
        var errors = new List<string>();

        foreach (var source in snapshot.Under(PodLayout.SettingsRoot)) {
            var relative = source.Value[(PodLayout.SettingsRoot.Length + 1)..];
            var target = PodPath.Parse($"{PodLayout.ComposedRoot}/{relative}");
            var result = PodComposer.Compose(target, snapshot.Read(source)!, resolver);
            errors.AddRange(result.Errors);
            if (result.Document is not null)
                fresh[target.Value] = result.Document;
        }

        // Verdict 4: the layer stamps are the pods whose bytes actually reached this build.
        var layers = resolver.Touched
            .Select(id => world.Pods[id])
            .Select(entry => new PodLayerStamp(entry.Id, entry.Version, PodSnapshot.Sha256(string.Concat(entry.ComposedFiles.OrderBy(f => f.Key, StringComparer.Ordinal).Select(f => f.Key + ":" + f.Value)))))
            .ToList();

        return (fresh, errors, layers);
    }

    private sealed class SnapshotResolver(PodSnapshot snapshot, PodWorld world) : IPodReferenceResolver {
        private readonly HashSet<PodId> touched = [];

        public IReadOnlyCollection<PodId> Touched => this.touched;

        public string? Resolve(PodReference reference, out string? reason) {
            switch (reference) {
            case PodReference.Local local: {
                foreach (var candidate in Candidates(PodLayout.SettingsRoot, local.Path)) {
                    if (snapshot.Read(candidate) is { } content) {
                        reason = null;
                        return content;
                    }
                }

                reason = $"'{local}' names no file in this pod. Expected '{PodLayout.SettingsRoot}/{local.Path}' with a known suffix.";
                return null;
            }
            case PodReference.Foreign foreign: {
                if (!world.Pods.TryGetValue(foreign.PodId, out var entry)) {
                    reason = $"Pod '{foreign.PodId}' is not installed, so '{foreign}' cannot resolve.";
                    return null;
                }

                foreach (var candidate in Candidates(PodLayout.ComposedRoot, foreign.Path)) {
                    if (entry.ComposedFiles.TryGetValue(candidate.Value, out var content)) {
                        this.touched.Add(foreign.PodId);
                        reason = null;
                        return content;
                    }
                }

                reason = $"'{foreign}' names no file in the manifest of '{foreign.PodId}' {entry.Version}.";
                return null;
            }
            default:
                reason = $"Unhandled reference shape '{reference}'.";
                return null;
            }
        }

        private static IEnumerable<PodPath> Candidates(string root, PodPath path) {
            yield return PodPath.Parse($"{root}/{path}");
            foreach (var suffix in PodLayout.DocumentSuffixes.Keys)
                yield return PodPath.Parse($"{root}/{path}{suffix}");
        }
    }
}
