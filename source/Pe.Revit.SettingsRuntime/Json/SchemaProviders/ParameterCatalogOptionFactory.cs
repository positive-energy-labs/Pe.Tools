using Pe.Revit.SettingsRuntime.Json.ValueDomains;
using Pe.Shared.RevitData;

namespace Pe.Revit.SettingsRuntime.Json.SchemaProviders;

public static class ParameterCatalogOptionFactory {
    public static List<ParameterCatalogOption> Build(ValueDomainExecutionContext context) {
        var doc = context.GetActiveDocument();
        if (doc == null)
            return [];

        var selectedFamilyNames = context.TryGetContextValue(ValueDomainContextKeys.SelectedFamilyNames, out var rawNames)
            ? ParseDelimitedFamilyNames(rawNames)
            : [];
        var apsGuids = ApsParameterCacheReader.ReadEntries()
            .Select(entry => entry.SharedGuid)
            .Where(guid => guid.HasValue)
            .Select(guid => guid!.Value)
            .ToHashSet();

        return ProjectParameterCatalogCollector.Collect(doc, selectedFamilyNames)
            .Select(entry => new ParameterCatalogOption(
                entry.Definition,
                entry.StorageType.ToString(),
                Guid.TryParse(entry.Identity.SharedGuid, out var sharedGuid) && apsGuids.Contains(sharedGuid),
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
    ParameterDefinitionDescriptor Definition,
    string StorageType,
    bool IsParamService,
    List<string> FamilyNames,
    List<string> TypeNames
) {
    public ParameterIdentity Identity => this.Definition.Identity;
}

