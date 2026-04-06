using Autodesk.Revit.DB;
using Pe.Shared.StorageRuntime.Capabilities;
using Pe.Shared.StorageRuntime.Json.FieldOptions;
using Pe.Shared.StorageRuntime.Json.SchemaDefinitions;
using Pe.Shared.StorageRuntime.Revit.Core.Json;

namespace Pe.Shared.StorageRuntime.Revit.Core.Json.SchemaProviders;

public sealed class FamilyManagerTypesSchemaUiDynamicColumnOrderSource : ISchemaUiDynamicColumnOrderSource {
    public string Key => "familyManagerTypes";

    public SettingsRuntimeMode RequiredRuntimeMode => SettingsRuntimeMode.LiveDocument;

    public ValueTask<IReadOnlyList<string>> GetValuesAsync(
        FieldOptionsExecutionContext context,
        CancellationToken cancellationToken = default
    ) {
        var document = context.GetActiveDocument();
        if (document == null || !document.IsFamilyDocument)
            return new ValueTask<IReadOnlyList<string>>([]);

        try {
            var typeNames = document.FamilyManager.Types
                .Cast<FamilyType>()
                .Select(type => type.Name?.Trim())
                .Where(name => !string.IsNullOrWhiteSpace(name))
                .Distinct(StringComparer.Ordinal)
                .Cast<string>()
                .ToList();

            return new ValueTask<IReadOnlyList<string>>(typeNames);
        } catch {
            return new ValueTask<IReadOnlyList<string>>([]);
        }
    }
}
