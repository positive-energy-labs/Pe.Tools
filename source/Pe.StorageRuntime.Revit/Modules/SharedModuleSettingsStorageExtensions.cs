using Newtonsoft.Json;
using Newtonsoft.Json.Converters;
using Pe.StorageRuntime.Revit.Core.Json;
using Pe.StorageRuntime.Revit.Core.Json.ContractResolvers;

namespace Pe.StorageRuntime.Revit.Modules;

public static class SharedModuleSettingsStorageExtensions {
    private static readonly JsonSerializerSettings DeserializerSettings = new() {
        Formatting = Formatting.Indented,
        Converters = [new StringEnumConverter()],
        ContractResolver = new RevitTypeContractResolver(),
        NullValueHandling = NullValueHandling.Ignore
    };

    public static TSettings ReadRequired<TSettings>(
        this SharedModuleSettingsStorage storage,
        string relativePath,
        string? rootKey = null
    ) where TSettings : class, new() {
        var snapshot = storage.OpenAsync(relativePath, true, rootKey).GetAwaiter().GetResult();
        if (!snapshot.Validation.IsValid) {
            throw new JsonValidationException(
                storage.ResolveDocumentPath(relativePath, rootKey),
                snapshot.Validation.Issues.Select(issue => $"{issue.Path}: {issue.Message}")
            );
        }

        var content = snapshot.ComposedContent ?? snapshot.RawContent;
        return JsonConvert.DeserializeObject<TSettings>(content, DeserializerSettings) ?? new TSettings();
    }
}
