using Autodesk.Revit.DB;
using Pe.StorageRuntime.Capabilities;
using Pe.StorageRuntime.Json.FieldOptions;
using Pe.StorageRuntime.Json.SchemaDefinitions;
using Pe.StorageRuntime.Revit.Core.Json;

namespace Pe.StorageRuntime.Revit.Core.Json.SchemaProviders;

public sealed class FamilyManagerTypesSchemaUiDynamicColumnOrderSource : ISchemaUiDynamicColumnOrderSource {
    public string Key => "familyManagerTypes";

    public SettingsRuntimeCapabilities RequiredCapabilities =>
        SettingsRuntimeCapabilityProfiles.LiveDocument;

    public ValueTask<IReadOnlyList<string>> GetValuesAsync(
        FieldOptionsExecutionContext context,
        CancellationToken cancellationToken = default
    ) {
        var document = context.GetActiveDocument();
        if (document == null || !document.IsFamilyDocument)
            return ValueTask.FromResult<IReadOnlyList<string>>([]);

        try {
            var typeNames = document.FamilyManager.Types
                .Cast<FamilyType>()
                .Select(type => type.Name?.Trim())
                .Where(name => !string.IsNullOrWhiteSpace(name))
                .Distinct(StringComparer.Ordinal)
                .Cast<string>()
                .ToList();

            return ValueTask.FromResult<IReadOnlyList<string>>(typeNames);
        } catch {
            return ValueTask.FromResult<IReadOnlyList<string>>([]);
        }
    }
}
