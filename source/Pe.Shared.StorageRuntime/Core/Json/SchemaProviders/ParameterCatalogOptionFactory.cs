using Pe.Shared.RevitData.Families;
using Pe.Shared.RevitData.Parameters;
using Pe.Shared.StorageRuntime.Json.FieldOptions;
using Pe.Shared.StorageRuntime.Json.SchemaProviders;

namespace Pe.Shared.StorageRuntime.Core.Json.SchemaProviders;

public static class ParameterCatalogOptionFactory {
    public static List<ParameterCatalogOption> Build(FieldOptionsExecutionContext context) {
        var doc = context.GetActiveDocument();
        if (doc == null)
            return [];

        var selectedFamilyNames = context.TryGetContextValue(OptionContextKeys.SelectedFamilyNames, out var rawNames)
            ? ParseDelimitedFamilyNames(rawNames)
            : [];
        var apsGuids = ApsParameterCacheReader.ReadEntries()
            .Select(entry => entry.SharedGuid)
            .Where(guid => guid.HasValue)
            .Select(guid => guid!.Value)
            .ToHashSet();

        return ProjectParameterCatalogCollector.Collect(doc, selectedFamilyNames)
            .Select(entry => new ParameterCatalogOption(
                entry.Identity,
                entry.StorageType.ToString(),
                entry.DataType.TypeId,
                entry.IsInstance,
                entry.Identity.SharedGuid.HasValue && apsGuids.Contains(entry.Identity.SharedGuid.Value),
                entry.FamilyNames.OrderBy(name => name, StringComparer.OrdinalIgnoreCase).ToList(),
                entry.ValuesPerType.Keys.OrderBy(name => name, StringComparer.Ordinal).ToList()
            ))
            .ToList();
    }

    private static HashSet<string> ParseDelimitedFamilyNames(string rawNames) =>
        rawNames
            .Trim()
            .Trim('[', ']')
            .Split([',', ';', '|'], StringSplitOptions.RemoveEmptyEntries)
            .Select(name => name.Trim().Trim('"'))
            .Where(name => !string.IsNullOrWhiteSpace(name))
            .ToHashSet(StringComparer.OrdinalIgnoreCase);
}

public sealed record ParameterCatalogOption(
    RevitParameterIdentity Identity,
    string StorageType,
    string? DataType,
    bool IsInstance,
    bool IsParamService,
    List<string> FamilyNames,
    List<string> TypeNames
);
