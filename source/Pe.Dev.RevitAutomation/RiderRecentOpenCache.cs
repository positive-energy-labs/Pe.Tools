using System.Text.Json;
using System.Text.Json.Serialization;
using System.IO;
using Pe.Shared.StorageRuntime;

namespace Pe.Dev.RevitAutomation;

public sealed class RiderRecentOpenCache {
    private static readonly JsonSerializerOptions JsonOptions = new() {
        DefaultIgnoreCondition = JsonIgnoreCondition.WhenWritingNull,
        WriteIndented = true
    };

    private readonly string _cachePath = StorageClient.Default.Global()
        .ResolveGlobalFragmentPath("dev/rider-hot-reload-recent-opens.json");

    public IReadOnlyDictionary<string, RiderRecentOpenCacheEntry> Load() {
        if (!File.Exists(this._cachePath))
            return new Dictionary<string, RiderRecentOpenCacheEntry>(StringComparer.OrdinalIgnoreCase);

        try {
            var content = File.ReadAllText(this._cachePath);
            if (string.IsNullOrWhiteSpace(content))
                return new Dictionary<string, RiderRecentOpenCacheEntry>(StringComparer.OrdinalIgnoreCase);

            var entries = JsonSerializer.Deserialize<List<RiderRecentOpenCacheEntry>>(content, JsonOptions) ?? [];
            return entries
                .Where(entry => !string.IsNullOrWhiteSpace(entry.Path))
                .ToDictionary(entry => entry.Path, StringComparer.OrdinalIgnoreCase);
        } catch {
            return new Dictionary<string, RiderRecentOpenCacheEntry>(StringComparer.OrdinalIgnoreCase);
        }
    }

    public void Save(IReadOnlyDictionary<string, RiderRecentOpenCacheEntry> cacheEntries) {
        Directory.CreateDirectory(Path.GetDirectoryName(this._cachePath)!);
        var cutoffUtc = DateTime.UtcNow.AddDays(-1);
        var entries = cacheEntries.Values
            .Where(entry => entry.LastOpenedUtc >= cutoffUtc)
            .OrderByDescending(entry => entry.LastOpenedUtc)
            .ToArray();

        var content = JsonSerializer.Serialize(entries, JsonOptions);
        File.WriteAllText(this._cachePath, content);
    }
}

public sealed record RiderRecentOpenCacheEntry(
    string Path,
    DateTime LastOpenedUtc,
    int? RevitPid,
    DateTime? RevitStartUtc
);
