using Pe.StorageRuntime.Capabilities;
using Pe.StorageRuntime.Json.FieldOptions;
using Pe.StorageRuntime.Json.SchemaProviders;

namespace Pe.StorageRuntime.Revit.Core.Json.SchemaProviders;

public static class ParameterCatalogOptionFactory {
    public static List<ParameterCatalogOption> Build(FieldOptionsExecutionContext context) {
        var doc = context.GetActiveDocument();
        if (doc == null)
            return [];

        var selectedFamilyNames = context.TryGetContextValue(OptionContextKeys.SelectedFamilyNames, out var rawNames)
            ? ProjectFamilyParameterCollector.ParseDelimitedFamilyNames(rawNames)
            : [];
        var apsGuids = ApsParameterCacheReader.ReadEntries()
            .Select(entry => entry.SharedGuid)
            .Where(guid => guid.HasValue)
            .Select(guid => guid!.Value)
            .ToHashSet();

        return ProjectFamilyParameterCollector.Collect(doc, selectedFamilyNames)
            .Select(entry => new ParameterCatalogOption(
                entry.Name,
                entry.StorageType.ToString(),
                entry.DataType.TypeId,
                entry.IsShared,
                entry.IsInstance,
                entry.IsBuiltIn,
                entry.IsProjectParameter,
                entry.IsShared && entry.SharedGuid.HasValue && apsGuids.Contains(entry.SharedGuid.Value),
                entry.SharedGuid?.ToString(),
                entry.FamilyNames.OrderBy(name => name, StringComparer.OrdinalIgnoreCase).ToList(),
                entry.ValuesPerType.Keys.OrderBy(name => name, StringComparer.Ordinal).ToList()
            ))
            .ToList();
    }
}

public sealed record ParameterCatalogOption(
    string Name,
    string StorageType,
    string? DataType,
    bool IsShared,
    bool IsInstance,
    bool IsBuiltIn,
    bool IsProjectParameter,
    bool IsParamService,
    string? SharedGuid,
    List<string> FamilyNames,
    List<string> TypeNames
);
