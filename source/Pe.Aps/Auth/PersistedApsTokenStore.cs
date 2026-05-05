using Newtonsoft.Json;
using System.Security.Cryptography;
using System.Text;

namespace Pe.Aps.Auth;

internal sealed class PersistedApsTokenStore {
    private static readonly object FileLock = new();
    private readonly string _filePath;

    public PersistedApsTokenStore(string? filePathOverride = null) {
        if (!string.IsNullOrWhiteSpace(filePathOverride)) {
            this._filePath = Path.GetFullPath(filePathOverride);
            var directory = Path.GetDirectoryName(this._filePath);
            if (!string.IsNullOrWhiteSpace(directory))
                Directory.CreateDirectory(directory);
            return;
        }

        var root = Path.Combine(
            Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
            "Positive Energy",
            "Pe.Tools",
            "ApsAuth"
        );
        Directory.CreateDirectory(root);
        this._filePath = Path.Combine(root, "tokens.json");
    }

    public PersistedTokenRecord? Load(string key) {
        lock (FileLock) {
            var map = this.ReadMap();
            return map.TryGetValue(key, out var record) ? record : null;
        }
    }

    public void Save(string key, PersistedTokenRecord record) {
        lock (FileLock) {
            var map = this.ReadMap();
            map[key] = record;
            this.WriteMap(map);
        }
    }

    public void DeleteByClientId(string clientId) {
        lock (FileLock) {
            var map = this.ReadMap();
            var removed = map.Keys
                .Where(key => key.StartsWith(clientId + "|", StringComparison.OrdinalIgnoreCase))
                .ToArray();
            if (removed.Length == 0)
                return;

            foreach (var key in removed)
                _ = map.Remove(key);

            this.WriteMap(map);
        }
    }

    private Dictionary<string, PersistedTokenRecord> ReadMap() {
        if (!File.Exists(this._filePath))
            return new Dictionary<string, PersistedTokenRecord>(StringComparer.Ordinal);

        var content = File.ReadAllText(this._filePath);
        if (string.IsNullOrWhiteSpace(content))
            return new Dictionary<string, PersistedTokenRecord>(StringComparer.Ordinal);

        var file = JsonConvert.DeserializeObject<PersistedTokenFile>(content);
        if (file?.Entries == null)
            return new Dictionary<string, PersistedTokenRecord>(StringComparer.Ordinal);

        var result = new Dictionary<string, PersistedTokenRecord>(StringComparer.Ordinal);
        foreach (var entry in file.Entries) {
            if (string.IsNullOrWhiteSpace(entry.Key) || string.IsNullOrWhiteSpace(entry.ProtectedPayload))
                continue;

            try {
                var payloadBytes = ProtectedData.Unprotect(
                    Convert.FromBase64String(entry.ProtectedPayload),
                    null,
                    DataProtectionScope.CurrentUser
                );
                var payloadJson = Encoding.UTF8.GetString(payloadBytes);
                var record = JsonConvert.DeserializeObject<PersistedTokenRecord>(payloadJson);
                if (record != null)
                    result[entry.Key] = record;
            } catch {
                // Ignore unreadable persisted entries. The caller will fall back to browser auth.
            }
        }

        return result;
    }

    private void WriteMap(IReadOnlyDictionary<string, PersistedTokenRecord> map) {
        var file = new PersistedTokenFile {
            Entries = map
                .Select(item => new PersistedTokenFileEntry {
                    Key = item.Key,
                    ProtectedPayload = Convert.ToBase64String(
                        ProtectedData.Protect(
                            Encoding.UTF8.GetBytes(JsonConvert.SerializeObject(item.Value)),
                            null,
                            DataProtectionScope.CurrentUser
                        )
                    )
                })
                .OrderBy(entry => entry.Key, StringComparer.Ordinal)
                .ToList()
        };

        File.WriteAllText(this._filePath, JsonConvert.SerializeObject(file, Formatting.Indented));
    }

    private sealed class PersistedTokenFile {
        [JsonProperty("entries")]
        public List<PersistedTokenFileEntry> Entries { get; init; } = [];
    }

    private sealed class PersistedTokenFileEntry {
        [JsonProperty("key")]
        public string Key { get; init; } = "";

        [JsonProperty("protectedPayload")]
        public string ProtectedPayload { get; init; } = "";
    }
}

internal sealed class PersistedTokenRecord {
    [JsonProperty("accessToken")]
    public string AccessToken { get; init; } = "";

    [JsonProperty("refreshToken")]
    public string RefreshToken { get; init; } = "";

    [JsonProperty("expiresAtUtc")]
    public DateTime ExpiresAtUtc { get; init; }
}
