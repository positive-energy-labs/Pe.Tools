using Microsoft.AspNetCore.SignalR;
using Newtonsoft.Json;
using Newtonsoft.Json.Linq;
using Pe.Global.Services.Storage;
using Pe.Global.Services.Storage.Core;
using Pe.Global.Services.Storage.Core.Json;

namespace Pe.Global.Services.SignalR.Hubs;

/// <summary>
///     SignalR hub for settings file CRUD operations.
/// </summary>
public class SettingsHub : Hub {
    private readonly RevitTaskQueue _taskQueue;
    private readonly SettingsTypeRegistry _typeRegistry;

    public SettingsHub(RevitTaskQueue taskQueue, SettingsTypeRegistry typeRegistry) {
        this._taskQueue = taskQueue;
        this._typeRegistry = typeRegistry;
    }

    /// <summary>
    ///     List available settings files for a type.
    /// </summary>
    public Task<List<SettingsFile>> ListSettings(ListSettingsRequest request) {
        var storageName = this._typeRegistry.GetStorageName(request.SettingsTypeName);
        var storage = new Storage.Storage(storageName);
        var dir = storage.SettingsDir();

        if (!string.IsNullOrEmpty(request.SubDirectory))
            dir = dir.SubDir(request.SubDirectory);

        var files = dir.ListJsonFilesShallow()
            .Select(relativePath => new FileInfo(Path.Combine(dir.DirectoryPath, relativePath)))
            .Select(f => new SettingsFile(
                f.FullName,
                Path.GetFileNameWithoutExtension(f.Name),
                f.LastWriteTimeUtc,
                f.Name.Contains("-fragment", StringComparison.OrdinalIgnoreCase) || f.Name.Contains("_fragment", StringComparison.OrdinalIgnoreCase)
            ))
            .ToList();

        return Task.FromResult(files);
    }

    /// <summary>
    ///     Read a settings file, optionally resolving $extends and $include.
    /// </summary>
    public async Task<ReadSettingsResponse> ReadSettings(ReadSettingsRequest request) => await this._taskQueue.EnqueueAsync(uiApp => {
        var storageName = this._typeRegistry.GetStorageName(request.SettingsTypeName);
        var storage = new Storage.Storage(storageName);
        var settingsDir = storage.SettingsDir();

        var filePath = Path.Combine(settingsDir.DirectoryPath, $"{request.FileName}.json");

        if (!File.Exists(filePath)) {
            return new ReadSettingsResponse("", "", [$"File not found: {request.FileName}.json"]);
        }

        var rawJson = File.ReadAllText(filePath);
        var resolvedJson = rawJson;
        var errors = new List<string>();

        if (request.ResolveComposition) {
            try {
                var type = this._typeRegistry.ResolveType(request.SettingsTypeName);
                var composableType = typeof(ComposableJson<>).MakeGenericType(type);

                // Create instance and resolve
                var composable = Activator.CreateInstance(composableType, settingsDir, request.FileName);
                var readRawMethod = composableType.GetMethod("ReadRaw");
                if (readRawMethod != null) {
                    var resolved = readRawMethod.Invoke(composable, null) as JObject;
                    if (resolved != null) {
                        resolvedJson = resolved.ToString(Formatting.Indented);
                    }
                }
            } catch (Exception ex) {
                errors.Add($"Composition resolution failed: {ex.Message}");
            }
        }

        return new ReadSettingsResponse(rawJson, resolvedJson, errors);
    });

    /// <summary>
    ///     Write settings to a file with optional validation.
    /// </summary>
    public async Task<WriteSettingsResponse> WriteSettings(WriteSettingsRequest request) => await this._taskQueue.EnqueueAsync(uiApp => {
        var storageName = this._typeRegistry.GetStorageName(request.SettingsTypeName);
        var storage = new Storage.Storage(storageName);
        var settingsDir = storage.SettingsDir();
        var errors = new List<string>();

        if (request.Validate) {
            try {
                var type = this._typeRegistry.ResolveType(request.SettingsTypeName);
                var schema = JsonSchemaFactory.CreateSchema(type, out var processor);
                processor.Finalize(schema);

                var validationErrors = schema.Validate(request.Json);
                errors.AddRange(validationErrors.Select(e => e.ToString()));

                if (errors.Count > 0)
                    return new WriteSettingsResponse(false, errors);
            } catch (Exception ex) {
                errors.Add($"Validation failed: {ex.Message}");
                return new WriteSettingsResponse(false, errors);
            }
        }

        try {
            var filePath = Path.Combine(settingsDir.DirectoryPath, $"{request.FileName}.json");
            File.WriteAllText(filePath, request.Json);
            return new WriteSettingsResponse(true, []);
        } catch (Exception ex) {
            errors.Add($"Write failed: {ex.Message}");
            return new WriteSettingsResponse(false, errors);
        }
    });

    /// <summary>
    ///     Resolve $extends and $include without saving.
    ///     Used for preview and "run without saving" scenarios.
    /// </summary>
    public async Task<ReadSettingsResponse> ResolveComposition(string settingsTypeName, string json) => await this._taskQueue.EnqueueAsync(uiApp => {
        var errors = new List<string>();

        try {
            var storageName = this._typeRegistry.GetStorageName(settingsTypeName);
            var storage = new Storage.Storage(storageName);
            var settingsDir = storage.SettingsDir();

            var jObject = JObject.Parse(json);

            // Check for $extends and resolve
            if (jObject.TryGetValue("$extends", out var extendsToken)) {
                var extendsPath = extendsToken.Value<string>();
                if (!string.IsNullOrEmpty(extendsPath)) {
                    var basePath = Path.Combine(settingsDir.DirectoryPath, extendsPath);
                    if (File.Exists(basePath)) {
                        var baseJson = JObject.Parse(File.ReadAllText(basePath));
                        // Merge base into current (current overrides base)
                        baseJson.Merge(jObject, new JsonMergeSettings {
                            MergeArrayHandling = MergeArrayHandling.Replace,
                            MergeNullValueHandling = MergeNullValueHandling.Merge
                        });
                        jObject = baseJson;
                    } else {
                        errors.Add($"Base file not found: {extendsPath}");
                    }
                }
            }

            // Remove composition directives from output
            _ = jObject.Remove("$extends");
            _ = jObject.Remove("$schema");

            return new ReadSettingsResponse(json, jObject.ToString(Formatting.Indented), errors);
        } catch (Exception ex) {
            errors.Add($"Resolution failed: {ex.Message}");
            return new ReadSettingsResponse(json, json, errors);
        }
    });

    /// <summary>
    ///     Get list of available fragment files for $include.
    /// </summary>
    public Task<List<SettingsFile>> ListFragments(string settingsTypeName, string? subDirectory) {
        var storageName = this._typeRegistry.GetStorageName(settingsTypeName);
        var storage = new Storage.Storage(storageName);
        var dir = storage.SettingsDir();

        if (!string.IsNullOrEmpty(subDirectory))
            dir = dir.SubDir(subDirectory);

        var files = dir.ListJsonFilesShallow()
            .Where(relativePath => relativePath.Contains("-fragment", StringComparison.OrdinalIgnoreCase))
            .Select(relativePath => new FileInfo(Path.Combine(dir.DirectoryPath, relativePath)))
            .Select(f => new SettingsFile(
                f.FullName,
                Path.GetFileNameWithoutExtension(f.Name),
                f.LastWriteTimeUtc,
                true
            ))
            .ToList();

        return Task.FromResult(files);
    }
}
