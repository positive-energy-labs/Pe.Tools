using Autodesk.Revit.DB;
using Autodesk.Revit.DB.Structure;
using Pe.Global.PolyFill;

namespace Pe.Global.Services.Storage.Core.Json.SchemaProviders;

/// <summary>
///     Collects project-side family parameter metadata and per-type values without snapshot coupling.
/// </summary>
public static class ProjectFamilyParameterCollector {
    public static HashSet<string> ParseDelimitedFamilyNames(string rawNames) {
        var values = rawNames
            .Trim()
            .Trim('[', ']')
            .SplitAndTrim([',', ';', '|'], StringSplitOptions.RemoveEmptyEntries)
            .Select(name => name.Trim('"'))
            .Where(name => !string.IsNullOrWhiteSpace(name));

        return values.ToHashSet(StringComparer.OrdinalIgnoreCase);
    }

    public static IReadOnlyList<ProjectCollectedParameter> Collect(
        Autodesk.Revit.DB.Document doc,
        HashSet<string> selectedFamilyNames
    ) {
        var includeAllFamilies = selectedFamilyNames.Count == 0;
        var families = new FilteredElementCollector(doc)
            .OfClass(typeof(Family))
            .Cast<Family>()
            .Where(family =>
                !string.IsNullOrWhiteSpace(family.Name) &&
                (includeAllFamilies || selectedFamilyNames.Contains(family.Name)))
            .ToList();

        if (families.Count == 0)
            return [];

        var typeNames = families
            .SelectMany(GetAllSymbols)
            .Select(symbol => symbol.Name)
            .Where(name => !string.IsNullOrWhiteSpace(name))
            .Distinct(StringComparer.Ordinal)
            .ToList();

        if (typeNames.Count == 0)
            return [];

        var projectParamNames = GetProjectParameterNames(doc);
        var collected = new Dictionary<string, ProjectCollectedParameter>(StringComparer.Ordinal);

        using var tx = new Transaction(doc, "Temp Instance for Param Collection");
        _ = tx.Start();

        try {
            foreach (var family in families) {
                var familyName = family.Name;
                var symbols = GetAllSymbols(family);
                foreach (var symbol in symbols) {
                    if (!symbol.IsActive)
                        symbol.Activate();

                    var typeName = symbol.Name;
                    CollectTypeParams(symbol, typeName, familyName, typeNames, collected, projectParamNames);

                    var tempInstance = doc.Create.NewFamilyInstance(
                        XYZ.Zero,
                        symbol,
                        StructuralType.NonStructural);

                    if (tempInstance is not null)
                        CollectInstanceParams(tempInstance, typeName, familyName, typeNames, collected, projectParamNames);
                }
            }
        } finally {
            if (tx.HasStarted())
                _ = tx.RollBack();
        }

        return collected.Values
            .OrderBy(p => p.Name, StringComparer.OrdinalIgnoreCase)
            .ThenByDescending(p => p.IsInstance)
            .ToList();
    }

    private static void CollectTypeParams(
        FamilySymbol symbol,
        string typeName,
        string familyName,
        List<string> allTypeNames,
        Dictionary<string, ProjectCollectedParameter> collected,
        HashSet<string> projectParamNames
    ) {
        foreach (var parameter in symbol.Parameters.OfType<Parameter>().Where(p => p.Definition != null)) {
            var key = GetKey(parameter.Definition.Name, false);
            var item = GetOrCreateCollectedParameter(parameter, false, allTypeNames, collected, key, projectParamNames);
            _ = item.FamilyNames.Add(familyName);
            item.ValuesPerType[typeName] = GetParameterValueString(parameter, symbol.Document);
        }
    }

    private static void CollectInstanceParams(
        FamilyInstance instance,
        string typeName,
        string familyName,
        List<string> allTypeNames,
        Dictionary<string, ProjectCollectedParameter> collected,
        HashSet<string> projectParamNames
    ) {
        foreach (var parameter in instance.Parameters.OfType<Parameter>().Where(p => p.Definition != null)) {
            var key = GetKey(parameter.Definition.Name, true);
            var item = GetOrCreateCollectedParameter(parameter, true, allTypeNames, collected, key, projectParamNames);
            _ = item.FamilyNames.Add(familyName);
            item.ValuesPerType[typeName] = GetParameterValueString(parameter, instance.Document);
        }
    }

    private static string? GetParameterValueString(Parameter param, Autodesk.Revit.DB.Document doc) {
        if (!param.HasValue) return null;

        return param.StorageType switch {
            StorageType.String => param.AsString(),
            StorageType.Integer => GetIntegerValueString(param),
            StorageType.Double => param.AsValueString(),
            StorageType.ElementId => GetElementIdValueString(param, doc),
            _ => null
        };
    }

    private static string GetIntegerValueString(Parameter param) {
        var intValue = param.AsInteger();
        var dataType = param.Definition.GetDataType();

        if (dataType == SpecTypeId.Boolean.YesNo)
            return intValue == 1 ? "Yes" : "No";

        return intValue.ToString();
    }

    private static string? GetElementIdValueString(Parameter param, Autodesk.Revit.DB.Document doc) {
        var elementId = param.AsElementId();
        if (elementId == null || elementId == ElementId.InvalidElementId)
            return null;

        var element = doc.GetElement(elementId);
        if (element != null)
            return $"{element.Name} [ID:{elementId.Value()}]";

        return $"[ID:{elementId.Value()}]";
    }

    private static ProjectCollectedParameter GetOrCreateCollectedParameter(
        Parameter param,
        bool isInstance,
        List<string> allTypeNames,
        Dictionary<string, ProjectCollectedParameter> collected,
        string key,
        HashSet<string> projectParamNames
    ) {
        if (collected.TryGetValue(key, out var existing))
            return existing;

        var definition = param.Definition ?? throw new InvalidOperationException("Parameter.Definition is null.");

        Guid? sharedGuid = null;
        if (param.IsShared) {
            try { sharedGuid = param.GUID; } catch {
                // GUID access can still throw in edge cases.
            }
        }

        var created = new ProjectCollectedParameter {
            Name = definition.Name,
            IsInstance = isInstance,
            PropertiesGroup = definition.GetGroupTypeId(),
            DataType = definition.GetDataType(),
            StorageType = param.StorageType,
            IsBuiltIn = param.Id != null &&
                        param.Id != ElementId.InvalidElementId &&
                        param.Id.Value() < 0,
            IsShared = param.IsShared,
            SharedGuid = sharedGuid,
            IsProjectParameter = projectParamNames.Contains(definition.Name),
            ValuesPerType = allTypeNames.ToDictionary(typeName => typeName, _ => (string?)null, StringComparer.Ordinal)
        };

        collected[key] = created;
        return created;
    }

    private static string GetKey(string name, bool isInstance) => $"{name}|{isInstance}";

    private static List<FamilySymbol> GetAllSymbols(Family family) {
        var symbolIds = family.GetFamilySymbolIds();
        if (symbolIds == null || symbolIds.Count == 0)
            return [];

        return symbolIds
            .Select(id => family.Document.GetElement(id) as FamilySymbol)
            .Where(symbol => symbol != null)
            .ToList()!;
    }

    private static HashSet<string> GetProjectParameterNames(Autodesk.Revit.DB.Document doc) {
        if (doc.IsFamilyDocument)
            return new HashSet<string>(StringComparer.Ordinal);

        var projectParamNames = new HashSet<string>(StringComparer.Ordinal);

        try {
            var bindingMap = doc.ParameterBindings;
            var iterator = bindingMap.ForwardIterator();
            iterator.Reset();

            while (iterator.MoveNext()) {
                var definition = iterator.Key;
                if (definition != null)
                    _ = projectParamNames.Add(definition.Name);
            }
        } catch {
            // Return empty set when parameter bindings are not available.
        }

        return projectParamNames;
    }
}

public record ProjectCollectedParameter {
    public string Name { get; init; } = string.Empty;
    public bool IsInstance { get; init; }
    public ForgeTypeId PropertiesGroup { get; init; } = new("");
    public ForgeTypeId DataType { get; init; } = SpecTypeId.String.Text;
    public StorageType StorageType { get; init; }
    public bool IsBuiltIn { get; init; }
    public bool IsShared { get; init; }
    public Guid? SharedGuid { get; init; }
    public bool IsProjectParameter { get; init; }
    public HashSet<string> FamilyNames { get; init; } = new(StringComparer.OrdinalIgnoreCase);
    public Dictionary<string, string?> ValuesPerType { get; init; } = new(StringComparer.Ordinal);
}
