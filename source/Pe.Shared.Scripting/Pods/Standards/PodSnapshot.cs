using System.Security.Cryptography;
using System.Text;

namespace Pe.Shared.Scripting.Pods.Standards;

/// <summary>
///     Spike: the build subject. An in-memory, path-keyed view of one pod directory.
///     Pe.Shared.Scripting stays filesystem-free (package AGENTS.md "no filesystem-runtime
///     assumptions"), so the build takes a snapshot and an adapter owns reading the disk.
///     A snapshot is a claim about disk at one instant; nothing downstream may outlive it.
/// </summary>
public sealed class PodSnapshot {
    private readonly IReadOnlyDictionary<string, string> files;

    private PodSnapshot(string directoryName, IReadOnlyDictionary<string, string> files) {
        this.DirectoryName = directoryName;
        this.files = files;
    }

    /// <summary>The name of the directory the snapshot was taken from. Ambient, not authored.</summary>
    public string DirectoryName { get; }

    public IEnumerable<PodPath> Paths => this.files.Keys.Select(PodPath.Parse);

    public static PodSnapshot Create(string directoryName, IEnumerable<KeyValuePair<string, string>> files) {
        var map = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
        foreach (var (rawPath, content) in files) {
            if (!PodPath.TryParse(rawPath, out var path, out var reason))
                throw new ArgumentException(reason, nameof(files));
            map[path.Value] = content;
        }

        return new PodSnapshot(directoryName, map);
    }

    public bool Contains(PodPath path) => this.files.ContainsKey(path.Value);

    public string? Read(PodPath path) => this.files.TryGetValue(path.Value, out var content) ? content : null;

    public IEnumerable<PodPath> Under(string rootSegment) =>
        this.files.Keys
            .Where(p => p.StartsWith(rootSegment + "/", StringComparison.OrdinalIgnoreCase))
            .Select(PodPath.Parse)
            .OrderBy(p => p.Value, StringComparer.Ordinal);

    public static string Sha256(string content) =>
        Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(content))).ToLowerInvariant();
}
