using Newtonsoft.Json;
using Pe.Shared.StorageRuntime.Documents;
using Pe.Shared.StorageRuntime.Json;

namespace Pe.Shared.StorageRuntime.Modules;

public sealed record SettingsStorageModuleOptions(
    IReadOnlyCollection<string> IncludeRoots,
    IReadOnlyCollection<string> PresetRoots
) {
    public static SettingsStorageModuleOptions Empty { get; } = new([], []);
}

public sealed record SettingsStorageModuleRuntimeDefinition(
    string DefaultRootKey,
    IReadOnlyCollection<string> AllowedRootKeys,
    SettingsStorageModuleOptions StorageOptions,
    IReadOnlyDictionary<string, ISettingsDocumentValidator?> RootValidators,
    IReadOnlyDictionary<string, SettingsRootBootstrapDocument> BootstrapDocuments
) {
    public static SettingsStorageModuleRuntimeDefinition CreateSingleRoot(
        string defaultRootKey,
        SettingsStorageModuleOptions storageOptions,
        ISettingsDocumentValidator? validator = null,
        SettingsRootBootstrapDocument? bootstrapDocument = null
    ) => new(
        defaultRootKey,
        [defaultRootKey],
        storageOptions,
        new Dictionary<string, ISettingsDocumentValidator?>(StringComparer.OrdinalIgnoreCase) {
            [defaultRootKey] = validator
        },
        bootstrapDocument == null
            ? new Dictionary<string, SettingsRootBootstrapDocument>(StringComparer.OrdinalIgnoreCase)
            : new Dictionary<string, SettingsRootBootstrapDocument>(StringComparer.OrdinalIgnoreCase) {
                [defaultRootKey] = bootstrapDocument
            }
    );
}

public sealed record SettingsRootBootstrapDocument(
    string RelativePath,
    Func<string> CreateContent
) {
    public const string DefaultRelativePath = "default";

    public static SettingsRootBootstrapDocument Create<TSettings>(
        string relativePath = DefaultRelativePath
    ) where TSettings : class =>
        new(relativePath, CreateDefaultContent<TSettings>);

    private static string CreateDefaultContent<TSettings>() where TSettings : class {
        var serializerSettings = new JsonSerializerSettings {
            Formatting = Formatting.Indented,
            NullValueHandling = NullValueHandling.Ignore
        };
        var defaultValue = JsonConvert.DeserializeObject<TSettings>("{}", serializerSettings);
        defaultValue ??= Activator.CreateInstance(typeof(TSettings)) as TSettings;
        if (defaultValue == null) {
            throw new InvalidOperationException(
                $"Could not materialize a default settings value for '{typeof(TSettings).FullName}'."
            );
        }

        return JsonFormatting.NormalizeTrailingNewline(JsonConvert.SerializeObject(defaultValue, serializerSettings));
    }
}
