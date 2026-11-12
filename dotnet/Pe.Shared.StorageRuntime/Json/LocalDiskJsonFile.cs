using Newtonsoft.Json;
using System.Text;

namespace Pe.Shared.StorageRuntime.Json;

public sealed class LocalDiskJsonFile<T>(string filePath, StoredPolicy policy, string place) : JsonReadWriter<T> where T : class, new() {
    private static readonly JsonSerializerSettings SerializerSettings =
        JsonFormatting.CreateIndentedSettings();

    private T? _cachedData;
    private DateTimeOffset _cachedModifiedUtc;
    private bool _kept;

    public string FilePath { get; } = Initialize(filePath);

    public T Read() {
        var data = StoredFile.Read(this.FilePath, policy, place,
            content => JsonConvert.DeserializeObject<T>(content, SerializerSettings)
                ?? throw new JsonSerializationException("Expected a JSON value."), out var kept);
        if (data != null || kept) this._kept = kept;
        data ??= new T();
        this.UpdateCache(data);
        return data;
    }

    public string Write(T data) {
        if (this._kept)
            throw new InvalidOperationException($"kept: {place} could not be read; not overwriting");
        StorageFileUtils.EnsureDirectoryExists(this.FilePath);
        var content = JsonConvert.SerializeObject(data, SerializerSettings);
        content = JsonFormatting.NormalizeTrailingNewline(content);
        StoredFile.WriteAtomic(this.FilePath, Encoding.UTF8.GetBytes(content), overwrite: true);
        this.UpdateCache(data);
        return this.FilePath;
    }

    public bool IsCacheValid(int maxAgeMinutes, Func<T, bool>? contentValidator = null) {
        if (this._cachedData == null || !File.Exists(this.FilePath))
            return false;

        var fileModifiedUtc = new DateTimeOffset(File.GetLastWriteTimeUtc(this.FilePath), TimeSpan.Zero);
        if (fileModifiedUtc > this._cachedModifiedUtc)
            return false;

        var age = DateTimeOffset.UtcNow - this._cachedModifiedUtc;
        if (age.TotalMinutes > maxAgeMinutes)
            return false;

        return contentValidator?.Invoke(this._cachedData) ?? true;
    }

    private static string Initialize(string filePath) {
        StorageFileUtils.ValidateFileNameAndExtension(filePath, ".json");
        StorageFileUtils.EnsureDirectoryExists(filePath);
        return filePath;
    }

    private void UpdateCache(T data) {
        this._cachedData = data;
        this._cachedModifiedUtc = File.Exists(this.FilePath)
            ? new DateTimeOffset(File.GetLastWriteTimeUtc(this.FilePath), TimeSpan.Zero)
            : DateTimeOffset.UtcNow;
    }
}
