namespace Pe.Shared.Scripting.Pods.Standards;

/// <summary>
///     Spike: pod identity primitives. Parse-only construction, so an invalid id or version
///     cannot exist as a value. Every failure returns a reason string, never an exception.
/// </summary>
public readonly record struct PodId {
    private PodId(string value) => this.Value = value;

    public string Value { get; }

    public override string ToString() => this.Value;

    public static bool TryParse(string? raw, out PodId id, out string? reason) {
        id = default;
        if (string.IsNullOrWhiteSpace(raw)) {
            reason = "Pod id is required.";
            return false;
        }

        var value = raw.Trim();
        if (value.Length > 64) {
            reason = $"Pod id '{value}' is longer than 64 characters.";
            return false;
        }

        var ok = value.All(c => (c >= 'a' && c <= 'z') || (c >= '0' && c <= '9') || c == '-')
                 && value[0] != '-'
                 && value[^1] != '-'
                 && !value.Contains("--", StringComparison.Ordinal);
        if (!ok) {
            reason = $"Pod id '{value}' must be a lowercase slug: a-z, 0-9, single interior hyphens.";
            return false;
        }

        id = new PodId(value);
        reason = null;
        return true;
    }

    public static PodId Parse(string raw) =>
        TryParse(raw, out var id, out var reason) ? id : throw new ArgumentException(reason, nameof(raw));
}

/// <summary>
///     Spike: an ordered version. `PodManifest.Version` is a free string today and is never compared
///     (census-pods-settings.md 1). Verdict 3 (upgrade replaces in place) and verdict 4 (receipt
///     records podId@version) both need an order, so the spike makes it comparable.
/// </summary>
public readonly record struct PodVersion : IComparable<PodVersion> {
    private PodVersion(int major, int minor, int patch) {
        this.Major = major;
        this.Minor = minor;
        this.Patch = patch;
    }

    public int Major { get; }
    public int Minor { get; }
    public int Patch { get; }

    public override string ToString() => $"{this.Major}.{this.Minor}.{this.Patch}";

    public int CompareTo(PodVersion other) =>
        this.Major != other.Major ? this.Major.CompareTo(other.Major)
        : this.Minor != other.Minor ? this.Minor.CompareTo(other.Minor)
        : this.Patch.CompareTo(other.Patch);

    public static bool TryParse(string? raw, out PodVersion version, out string? reason) {
        version = default;
        var parts = (raw ?? string.Empty).Trim().Split('.');
        if (parts.Length != 3 || !parts.All(p => int.TryParse(p, out var n) && n >= 0)) {
            reason = $"Pod version '{raw}' must be major.minor.patch with non-negative integers.";
            return false;
        }

        version = new PodVersion(int.Parse(parts[0]), int.Parse(parts[1]), int.Parse(parts[2]));
        reason = null;
        return true;
    }
}

/// <summary>Where an installed copy came from. Only an installed pod has one.</summary>
public sealed record PodOrigin(string Remote, string Commit);

/// <summary>
///     Closed union. `Owned` has no origin by type; `Installed` cannot exist without one.
///     "owned pod carrying an origin" and "installed pod missing an origin" are unrepresentable.
/// </summary>
public abstract record PodOwnership {
    private PodOwnership() { }

    public sealed record Owned : PodOwnership {
        public static Owned Instance { get; } = new();
    }

    public sealed record Installed(PodOrigin Origin) : PodOwnership;
}

/// <summary>A pod-relative forward-slash path. Escapes and rooted paths are unrepresentable.</summary>
public readonly record struct PodPath {
    private PodPath(string value) => this.Value = value;

    public string Value { get; }

    public string RootSegment => this.Value.Split('/')[0];

    public override string ToString() => this.Value;

    public static bool TryParse(string? raw, out PodPath path, out string? reason) {
        path = default;
        if (string.IsNullOrWhiteSpace(raw)) {
            reason = "Pod-relative path is required.";
            return false;
        }

        var normalized = raw.Replace('\\', '/').Trim('/');
        var segments = normalized.Split(new[] { '/' }, StringSplitOptions.RemoveEmptyEntries);
        if (segments.Length == 0) {
            reason = $"Pod-relative path '{raw}' is empty after normalization.";
            return false;
        }

        if (segments.Any(s => s is "." or "..")) {
            reason = $"Pod-relative path '{raw}' contains a '.' or '..' segment.";
            return false;
        }

        if (normalized.Contains(':') || raw.StartsWith("/", StringComparison.Ordinal) || raw.StartsWith("\\", StringComparison.Ordinal)) {
            reason = $"Pod-relative path '{raw}' looks rooted or machine-local; authored paths must be pod-relative.";
            return false;
        }

        path = new PodPath(string.Join("/", segments));
        reason = null;
        return true;
    }

    public static PodPath Parse(string raw) =>
        TryParse(raw, out var path, out var reason) ? path : throw new ArgumentException(reason, nameof(raw));
}

