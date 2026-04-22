using Newtonsoft.Json;

namespace Pe.Shared.StorageRuntime.Json;

public sealed class LocalDiskJsonFile<T>(string filePath) : JsonReadWriter<T> where T : class, new() {
    private static readonly JsonSerializerSettings SerializerSettings =
        JsonFormatting.CreateIndentedSettings();

    private T? _cachedData;
    private DateTimeOffset _cachedModifiedUtc;

    public string FilePath { get; } = Initialize(filePath);

    public T Read() {
        this.EnsureFileExists();
        var content = File.ReadAllText(this.FilePath);
        var data = JsonConvert.DeserializeObject<T>(content, SerializerSettings) ?? new T();
        this.UpdateCache(data);
        return data;
    }

    public string Write(T data) {
        StorageFileUtils.EnsureDirectoryExists(this.FilePath);
        var content = JsonConvert.SerializeObject(data, SerializerSettings);
        content = JsonFormatting.NormalizeTrailingNewline(content);
        File.WriteAllText(this.FilePath, content);
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

    private void EnsureFileExists() {
        if (File.Exists(this.FilePath))
            return;

        _ = this.Write(new T());
    }

    private void UpdateCache(T data) {
        this._cachedData = data;
        this._cachedModifiedUtc = File.Exists(this.FilePath)
            ? new DateTimeOffset(File.GetLastWriteTimeUtc(this.FilePath), TimeSpan.Zero)
            : DateTimeOffset.UtcNow;
    }
}