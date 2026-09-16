namespace Pe.Shared.Scripting.Pods.Standards;

/// <summary>
///     Verdict 2: `@global/` dies, @&lt;podId&gt;/ replaces it, `@local/` stays and means "this pod".
///     A reference is a closed union over those two shapes; a third shape is unrepresentable.
/// </summary>
public abstract record PodReference {
    private PodReference() { }

    public abstract PodPath Path { get; }

    /// <summary>`@local/x` â€” resolves inside the authoring pod.</summary>
    public sealed record Local(PodPath Path) : PodReference {
        public override PodPath Path { get; } = Path;

        public override string ToString() => $"@local/{this.Path}";
    }

    /// <summary>`@mep-base/x` â€” resolves against another pod's `composed/`.</summary>
    public sealed record Foreign(PodId PodId, PodPath Path) : PodReference {
        public override PodPath Path { get; } = Path;

        public override string ToString() => $"@{this.PodId}/{this.Path}";
    }

    /// <summary>
    ///     Ids the reference grammar burns. `local` cannot be a pod id because `@local/` already
    ///     means "this pod"; `global` is retired and refused loudly so stale authored files say why.
    /// </summary>
    public static HashSet<string> ReservedIds { get; } =
        new HashSet<string>(StringComparer.Ordinal) { "local", "global" };

    public static bool TryParse(string? raw, out PodReference reference, out string? reason) {
        reference = null!;
        if (string.IsNullOrWhiteSpace(raw) || raw[0] != '@') {
            reason = $"Reference '{raw}' must start with '@local/' or '@<podId>/'.";
            return false;
        }

        var slash = raw.IndexOf('/');
        if (slash < 2) {
            reason = $"Reference '{raw}' must name a scope and a path, as in '@local/patches/hp'.";
            return false;
        }

        var scope = raw[1..slash];
        var rest = raw[(slash + 1)..];

        if (!PodPath.TryParse(rest, out var path, out var pathReason)) {
            reason = $"Reference '{raw}': {pathReason}";
            return false;
        }

        if (string.Equals(scope, "local", StringComparison.Ordinal)) {
            reference = new Local(path);
            reason = null;
            return true;
        }

        if (string.Equals(scope, "global", StringComparison.OrdinalIgnoreCase)) {
            reason = $"Reference '{raw}' uses the retired '@global/' scope. Name the pod that owns the file, as in '@default/{path}'.";
            return false;
        }

        if (!PodId.TryParse(scope, out var podId, out var idReason)) {
            reason = $"Reference '{raw}': {idReason}";
            return false;
        }

        reference = new Foreign(podId, path);
        reason = null;
        return true;
    }
}

