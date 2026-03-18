using Autodesk.Revit.DB.Structure;

namespace Pe.StorageRuntime.Revit.Core.Json.SchemaProviders;

/// <summary>
///     Collects project-side family parameter metadata and per-type values.
/// </summary>
public static class ProjectFamilyParameterCollector {
    public static HashSet<string> ParseDelimitedFamilyNames(string rawNames) =>
        rawNames
            .Trim()
            .Trim('[', ']')
            .Split([',', ';', '|'], StringSplitOptions.RemoveEmptyEntries)
            .Select(name => name.Trim().Trim('"'))
            .Where(name => !string.IsNullOrWhiteSpace(name))
            .ToHashSet(StringComparer.OrdinalIgnoreCase);

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

        using var transaction = new Transaction(doc, "Temp Instance for Param Collection");
        _ = transaction.Start();

        try {
            foreach (var family in families) {
                var familyName = family.Name;
                foreach (var symbol in GetAllSymbols(family)) {
                    if (!symbol.IsActive)
                        symbol.Activate();

                    var typeName = symbol.Name;
                    CollectTypeParams(symbol, typeName, familyName, typeNames, collected, projectParamNames);

                    var tempInstance = doc.Create.NewFamilyInstance(
                        XYZ.Zero,
                        symbol,
                        StructuralType.NonStructural
                    );
                    if (tempInstance != null) {
                        CollectInstanceParams(
                            tempInstance,
                            typeName,
                            familyName,
                            typeNames,
                            collected,
                            projectParamNames
                        );
                    }
                }
            }
        } finally {
            if (transaction.HasStarted())
                _ = transaction.RollBack();
        }

        return collected.Values
            .OrderBy(parameter => parameter.Name, StringComparer.OrdinalIgnoreCase)
            .ThenByDescending(parameter => parameter.IsInstance)
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

    private static string? GetParameterValueString(Parameter parameter, Autodesk.Revit.DB.Document doc) {
        if (!parameter.HasValue)
            return null;

        return parameter.StorageType switch {
            StorageType.String => parameter.AsString(),
            StorageType.Integer => GetIntegerValueString(parameter),
            StorageType.Double => parameter.AsValueString(),
            StorageType.ElementId => GetElementIdValueString(parameter, doc),
            _ => null
        };
    }

    private static string GetIntegerValueString(Parameter parameter) {
        var intValue = parameter.AsInteger();
        var dataType = parameter.Definition.GetDataType();
        if (dataType == SpecTypeId.Boolean.YesNo)
            return intValue == 1 ? "Yes" : "No";

        return intValue.ToString();
    }

    private static string? GetElementIdValueString(Parameter parameter, Autodesk.Revit.DB.Document doc) {
        var elementId = parameter.AsElementId();
        if (elementId == null || elementId == ElementId.InvalidElementId)
            return null;

        var element = doc.GetElement(elementId);
        if (element != null)
            return $"{element.Name} [ID:{elementId.Value()}]";

        return $"[ID:{elementId.Value()}]";
    }

    private static ProjectCollectedParameter GetOrCreateCollectedParameter(
        Parameter parameter,
        bool isInstance,
        List<string> allTypeNames,
        Dictionary<string, ProjectCollectedParameter> collected,
        string key,
        HashSet<string> projectParamNames
    ) {
        if (collected.TryGetValue(key, out var existing))
            return existing;

        var definition = parameter.Definition ?? throw new InvalidOperationException("Parameter.Definition is null.");
        Guid? sharedGuid = null;
        if (parameter.IsShared) {
            try {
                sharedGuid = parameter.GUID;
            } catch {
            }
        }

        var created = new ProjectCollectedParameter {
            Name = definition.Name,
            IsInstance = isInstance,
            PropertiesGroup = definition.GetGroupTypeId(),
            DataType = definition.GetDataType(),
            StorageType = parameter.StorageType,
            IsBuiltIn = parameter.Id != null &&
                        parameter.Id != ElementId.InvalidElementId &&
                        parameter.Id.Value() < 0,
            IsShared = parameter.IsShared,
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

        try {
            var bindings = doc.ParameterBindings;
            var iterator = bindings.ForwardIterator();
            var names = new HashSet<string>(StringComparer.Ordinal);
            for (iterator.Reset(); iterator.MoveNext();) {
                if (iterator.Key is Definition definition &&
                    !string.IsNullOrWhiteSpace(definition.Name)) {
                    _ = names.Add(definition.Name);
                }
            }

            return names;
        } catch {
            return new HashSet<string>(StringComparer.Ordinal);
        }
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
