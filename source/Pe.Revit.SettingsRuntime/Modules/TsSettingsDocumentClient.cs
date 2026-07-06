using Pe.Revit.SettingsRuntime.Json;
using Pe.Shared.Product;
using Pe.Shared.StorageRuntime;
using Pe.Shared.StorageRuntime.Capabilities;
using Pe.Shared.StorageRuntime.Documents;

namespace Pe.Revit.SettingsRuntime.Modules;

internal static class TsSettingsDocumentClient {
    private const string OpenWithModuleKey = "settings.document.open-with-module";
    private static readonly TimeSpan CallTimeout = TimeSpan.FromSeconds(10);

    public static SettingsDocumentSnapshot OpenRequired<TSettings>(
        ModuleDocumentStorage documents,
        string relativePath,
        string rootKey
    ) where TSettings : class {
        var documentId = documents.CreateDocumentId(relativePath, rootKey);
        var request = new TsSettingsOpenRequest(
            new OpenSettingsDocumentRequest(
                documentId,
                true
            ),
            new TsSettingsModuleDescriptor(
                documents.ModuleKey,
                documents.DefaultRootKey,
                [new TsSettingsRootDescriptor(rootKey, rootKey)],
                new TsSettingsStorageOptions(
                    [.. documents.StorageOptions.IncludeRoots],
                    [.. documents.StorageOptions.PresetRoots]
                )
            ),
            RevitJsonSchemaFactory
                .BuildAuthoringSchema(typeof(TSettings), documents.RuntimeMode, resolveFieldOptionSamples: false)
                .ToJson()
        );

        try {
            return TsHostCallClient.Call<SettingsDocumentSnapshot>(OpenWithModuleKey, request, CallTimeout);
        }
        catch (TsHostCallException error) when (error.Status == 404) {
            throw new FileNotFoundException($"Settings document '{documentId.StableId}' was not found.");
        }
    }

    private sealed record TsSettingsOpenRequest(
        OpenSettingsDocumentRequest Request,
        TsSettingsModuleDescriptor Module,
        string SchemaJson
    );

    private sealed record TsSettingsModuleDescriptor(
        string ModuleKey,
        string DefaultRootKey,
        IReadOnlyCollection<TsSettingsRootDescriptor> Roots,
        TsSettingsStorageOptions StorageOptions
    );

    private sealed record TsSettingsRootDescriptor(
        string RootKey,
        string DisplayName
    );

    private sealed record TsSettingsStorageOptions(
        IReadOnlyCollection<string> IncludeRoots,
        IReadOnlyCollection<string> PresetRoots
    );
}
