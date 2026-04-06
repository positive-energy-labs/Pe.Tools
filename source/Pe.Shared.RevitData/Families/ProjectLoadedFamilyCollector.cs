using Autodesk.Revit.DB.Structure;
using Pe.Shared.RevitData.PolyFill;
using Pe.Shared.RevitData.Parameters;
using System.Diagnostics;

namespace Pe.Shared.RevitData.Families;

public static class ProjectLoadedFamilyCollector {
    public static IReadOnlyList<ProjectLoadedFamilyRecord> Collect(
        Document doc,
        HashSet<string>? selectedFamilyNames = null,
        HashSet<long>? selectedFamilyIds = null,
        Action<ProjectLoadedFamilyRecord, TimeSpan>? onFamilyCollected = null
    ) {
        if (doc == null)
            throw new ArgumentNullException(nameof(doc));
        if (doc.IsFamilyDocument)
            return [];

        selectedFamilyNames ??= new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        var families = GetSelectedFamilies(doc, selectedFamilyNames, selectedFamilyIds);
        if (families.Count == 0)
            return [];

        using var context = LoadedFamiliesTempPlacementEngine.CreateEvaluationContext(
            doc,
            families.Select(family => family.Id.Value()).ToHashSet()
        );
        context.BeginTransaction("Collect Loaded Family Parameter Values");

        try {
            LoadedFamiliesTempPlacementEngine.PlaceOneTempInstancePerPlaceableSymbol(context);
            return CollectFromPlacedInstances(context, onFamilyCollected);
        } finally {
            context.RollBackTransaction();
        }
    }

    public static IReadOnlyList<ProjectLoadedFamilyRecord> CollectFromPlacedInstances(
        LoadedFamiliesMatrixEvaluationContext context,
        Action<ProjectLoadedFamilyRecord, TimeSpan>? onFamilyCollected = null
    ) {
        if (context == null)
            throw new ArgumentNullException(nameof(context));

        var placedInstanceCounts = GetPlacedInstanceCounts(context.ProjectDocument);
        var records = context.Families.ToDictionary(
            family => family.Id.Value(),
            family => CreateFamilyRecord(family, placedInstanceCounts)
        );

        foreach (var family in context.Families) {
            if (!records.TryGetValue(family.Id.Value(), out var familyRecord))
                continue;

            var stopwatch = Stopwatch.StartNew();
            CollectFamilyValuesFromContext(context, family, familyRecord);
            onFamilyCollected?.Invoke(familyRecord, stopwatch.Elapsed);
        }

        return records.Values
            .OrderBy(record => record.FamilyName, StringComparer.OrdinalIgnoreCase)
            .ToList();
    }

    private static List<Family> GetSelectedFamilies(
        Document doc,
        HashSet<string> selectedFamilyNames,
        HashSet<long>? selectedFamilyIds
    ) {
        var includeAllFamilies = selectedFamilyNames.Count == 0;
        var includeAllFamilyIds = selectedFamilyIds == null || selectedFamilyIds.Count == 0;

        return new FilteredElementCollector(doc)
            .OfClass(typeof(Family))
            .Cast<Family>()
            .Where(family => !family.IsInPlace)
            .Where(family => !string.IsNullOrWhiteSpace(family.Name))
            .Where(family => includeAllFamilyIds || selectedFamilyIds!.Contains(family.Id.Value()))
            .Where(family => includeAllFamilies || selectedFamilyNames.Contains(family.Name))
            .OrderBy(family => family.Name, StringComparer.OrdinalIgnoreCase)
            .ToList();
    }

    private static Dictionary<long, int> GetPlacedInstanceCounts(Document doc) =>
        new FilteredElementCollector(doc)
            .OfClass(typeof(FamilyInstance))
            .Cast<FamilyInstance>()
            .Where(instance => instance.Symbol?.Family != null)
            .GroupBy(instance => instance.Symbol.Family.Id.Value())
            .ToDictionary(group => group.Key, group => group.Count());

    private static ProjectLoadedFamilyRecord CreateFamilyRecord(
        Family family,
        IReadOnlyDictionary<long, int> placedInstanceCounts
    ) {
        var types = GetAllSymbols(family)
            .Select(symbol => new ProjectLoadedFamilyType(
                symbol.Id.Value(),
                symbol.UniqueId,
                symbol.Name
            ))
            .OrderBy(type => type.TypeName, StringComparer.Ordinal)
            .ToList();

        return new ProjectLoadedFamilyRecord {
            FamilyId = family.Id.Value(),
            FamilyUniqueId = family.UniqueId,
            FamilyName = family.Name,
            CategoryName = family.FamilyCategory?.Name,
            PlacedInstanceCount = placedInstanceCounts.TryGetValue(family.Id.Value(), out var count) ? count : 0,
            Types = types
        };
    }

    private static void CollectFamilyValues(
        Document doc,
        Family family,
        ProjectLoadedFamilyRecord familyRecord
    ) {
        var familyTypeNames = familyRecord.Types
            .Select(type => type.TypeName)
            .Distinct(StringComparer.Ordinal)
            .ToList();

        foreach (var symbol in GetAllSymbols(family)) {
            TryActivateSymbol(symbol, familyRecord);
            CollectTypeParameters(symbol, familyRecord, familyTypeNames);

            var tempInstanceResult = TryCreateTempInstance(doc, symbol);
            if (!tempInstanceResult.Ok) {
                familyRecord.Issues.Add(new ProjectLoadedFamilyIssue(
                    "TempInstanceCreationFailed",
                    ProjectLoadedFamilyIssueSeverity.Warning,
                    tempInstanceResult.Message ?? "Failed to create temporary instance.",
                    familyRecord.FamilyName,
                    symbol.Name,
                    null
                ));
                continue;
            }

            if (tempInstanceResult.Instance != null)
                CollectInstanceParameters(tempInstanceResult.Instance, familyRecord, familyTypeNames);
        }

        familyRecord.Parameters = familyRecord.Parameters
            .OrderBy(parameter => parameter.Identity.Name, StringComparer.OrdinalIgnoreCase)
            .ThenByDescending(parameter => parameter.IsInstance)
            .ToList();
    }

    private static void CollectFamilyValuesFromContext(
        LoadedFamiliesMatrixEvaluationContext context,
        Family family,
        ProjectLoadedFamilyRecord familyRecord
    ) {
        var familyTypeNames = familyRecord.Types
            .Select(type => type.TypeName)
            .Distinct(StringComparer.Ordinal)
            .ToList();

        if (context.SymbolsByFamilyId.TryGetValue(family.Id.Value(), out var symbols)) {
            foreach (var symbol in symbols) {
                CollectTypeParameters(symbol, familyRecord, familyTypeNames);

                if (!context.TempPlacementsBySymbolId.TryGetValue(symbol.Id.Value(), out var placement))
                    continue;

                CollectInstanceParameters(placement.Instance, familyRecord, familyTypeNames);
            }
        }

        if (context.IssuesByFamilyId.TryGetValue(family.Id.Value(), out var issues))
            familyRecord.Issues.AddRange(issues);

        familyRecord.Parameters = familyRecord.Parameters
            .OrderBy(parameter => parameter.Identity.Name, StringComparer.OrdinalIgnoreCase)
            .ThenByDescending(parameter => parameter.IsInstance)
            .ToList();
    }

    private static void TryActivateSymbol(
        FamilySymbol symbol,
        ProjectLoadedFamilyRecord familyRecord
    ) {
        if (symbol.IsActive)
            return;

        try {
            symbol.Activate();
        } catch (Exception ex) {
            familyRecord.Issues.Add(new ProjectLoadedFamilyIssue(
                "TypeActivationFailed",
                ProjectLoadedFamilyIssueSeverity.Warning,
                ex.Message,
                familyRecord.FamilyName,
                symbol.Name,
                null
            ));
        }
    }

    private static void CollectTypeParameters(
        FamilySymbol symbol,
        ProjectLoadedFamilyRecord familyRecord,
        IReadOnlyList<string> familyTypeNames
    ) {
        foreach (var parameter in symbol.Parameters.OfType<Parameter>()
                     .Where(parameter => parameter.Definition != null)) {
            var collectedParameter = GetOrCreateCollectedParameter(
                parameter,
                false,
                familyRecord,
                familyTypeNames
            );
            collectedParameter.ValuesByType[symbol.Name] = GetParameterValueString(parameter, symbol.Document);
        }
    }

    private static void CollectInstanceParameters(
        FamilyInstance instance,
        ProjectLoadedFamilyRecord familyRecord,
        IReadOnlyList<string> familyTypeNames
    ) {
        foreach (var parameter in instance.Parameters.OfType<Parameter>()
                     .Where(parameter => parameter.Definition != null)) {
            var collectedParameter = GetOrCreateCollectedParameter(
                parameter,
                true,
                familyRecord,
                familyTypeNames
            );
            collectedParameter.ValuesByType[instance.Symbol.Name] =
                GetParameterValueString(parameter, instance.Document);
        }
    }

    private static ProjectLoadedFamilyParameter GetOrCreateCollectedParameter(
        Parameter parameter,
        bool isInstance,
        ProjectLoadedFamilyRecord familyRecord,
        IReadOnlyList<string> familyTypeNames
    ) {
        var identity = RevitParameterIdentityFactory.FromParameter(parameter);
        var key = GetParameterKey(identity.Key, isInstance);
        if (familyRecord.ParametersByKey.TryGetValue(key, out var existing))
            return existing;

        var definition = parameter.Definition ?? throw new InvalidOperationException("Parameter.Definition is null.");
        var created = new ProjectLoadedFamilyParameter {
            Identity = identity,
            IsInstance = isInstance,
            PropertiesGroup = definition.GetGroupTypeId(),
            DataType = definition.GetDataType(),
            StorageType = parameter.StorageType,
            TypeNames = familyTypeNames.ToList(),
            ValuesByType =
                familyTypeNames.ToDictionary(typeName => typeName, _ => (string?)null, StringComparer.Ordinal)
        };

        familyRecord.ParametersByKey[key] = created;
        familyRecord.Parameters.Add(created);
        return created;
    }

    private static TempInstanceResult TryCreateTempInstance(Document doc, FamilySymbol symbol) {
        try {
            var instance = doc.Create.NewFamilyInstance(
                XYZ.Zero,
                symbol,
                StructuralType.NonStructural
            );
            return new TempInstanceResult(true, instance, null);
        } catch (Exception ex) {
            return new TempInstanceResult(false, null, ex.Message);
        }
    }

    private static string? GetParameterValueString(Parameter parameter, Document doc) {
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

    private static string? GetElementIdValueString(Parameter parameter, Document doc) {
        var elementId = parameter.AsElementId();
        if (elementId == null || elementId == ElementId.InvalidElementId)
            return null;

        var element = doc.GetElement(elementId);
        if (element != null)
            return $"{element.Name} [ID:{elementId.Value()}]";

        return $"[ID:{elementId.Value()}]";
    }

    private static string GetParameterKey(string identityKey, bool isInstance) =>
        $"{identityKey}|{isInstance}";

    private static List<FamilySymbol> GetAllSymbols(Family family) {
        var symbolIds = family.GetFamilySymbolIds();
        if (symbolIds == null || symbolIds.Count == 0)
            return [];

        return symbolIds
            .Select(id => family.Document.GetElement(id) as FamilySymbol)
            .Where(symbol => symbol != null)
            .Cast<FamilySymbol>()
            .ToList();
    }

    private sealed record TempInstanceResult(
        bool Ok,
        FamilyInstance? Instance,
        string? Message
    );
}
