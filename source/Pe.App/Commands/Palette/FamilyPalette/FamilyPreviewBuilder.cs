using Pe.Extensions.FamDocument;
using Pe.Extensions.FamDocument.GetValue;
using Pe.Extensions.FamParameter;
using Pe.Global.Services.Document;
using Pe.Global.PolyFill;

namespace Pe.App.Commands.Palette.FamilyPalette;

/// <summary>
///     Builds FamilyPreviewData from Family, FamilySymbol, or FamilyInstance.
///     Centralizes parameter collection logic with optimizations for each source type.
/// </summary>
public static class FamilyPreviewBuilder {
    /// <summary>
    ///     Builds preview data from a Family (project document context).
    ///     Shows basic family info and type names. Parameters are NOT collected for performance.
    ///     Use <see cref="BuildFromFamilyWithParameters" /> to load parameters on demand.
    /// </summary>
    public static FamilyPreviewData BuildFromFamily(Family family, Document doc) {
        // Only get symbol names - skip expensive parameter collection
        var symbolIds = family.GetFamilySymbolIds();
        var typeNames = symbolIds
            .Select(id => doc.GetElement(id) as FamilySymbol)
            .Where(s => s != null)
            .Select(s => s!.Name)
            .OrderBy(n => n)
            .ToList();

        return new FamilyPreviewData {
            Source = FamilyPreviewSource.Family,
            FamilyName = family.Name,
            CategoryName = family.FamilyCategory?.Name ?? string.Empty,
            TypeCount = typeNames.Count,
            TypeNames = typeNames,
            Parameters = [] // Skip parameter collection for performance
        };
    }

    /// <summary>
    ///     Builds preview data from a Family WITH full parameter collection.
    ///     This is expensive - use only when user explicitly requests parameters.
    /// </summary>
    public static FamilyPreviewData BuildFromFamilyWithParameters(Family family, Document doc) {
        var symbols = GetFamilySymbols(family, doc);
        var typeNames = symbols.Select(s => s.Name).OrderBy(n => n).ToList();

        var parameters = CollectParametersFromFamily(doc, symbols, typeNames);

        return new FamilyPreviewData {
            Source = FamilyPreviewSource.Family,
            FamilyName = family.Name,
            CategoryName = family.FamilyCategory?.Name ?? string.Empty,
            TypeCount = symbols.Count,
            TypeNames = typeNames,
            Parameters = parameters
        };
    }

    private static List<FamilySymbol> GetFamilySymbols(Family family, Document doc) {
        var symbolIds = family.GetFamilySymbolIds();
        if (symbolIds == null || symbolIds.Count == 0)
            return [];

        return symbolIds
            .Select(id => doc.GetElement(id) as FamilySymbol)
            .Where(s => s != null)
            .OrderBy(s => s!.Name)
            .ToList()!;
    }

    private static List<FamilyParameterPreview> CollectParametersFromFamily(
        Document doc,
        List<FamilySymbol> symbols,
        List<string> typeNames
    ) {
        if (symbols.Count == 0)
            return [];

        var results = new Dictionary<string, FamilyParameterPreview>(StringComparer.Ordinal);

        // Collect type parameters from all symbols
        foreach (var symbol in symbols) {
            foreach (Parameter param in symbol.Parameters) {
                if (param.Definition == null) continue;

                var key = GetParamKey(param.Definition.Name, isInstance: false);
                var preview = GetOrCreatePreview(results, key, param, isInstance: false, typeNames);
                preview.ValuesPerType[symbol.Name] = GetParameterValueString(param, doc);
            }
        }

        return [.. results.Values.OrderBy(p => p.Name).ThenByDescending(p => p.IsInstance)];
    }

    /// <summary>
    ///     Builds preview data from a FamilySymbol (single type).
    ///     Shows parameter values for this specific type, including instance values
    ///     when a matching instance exists in the document.
    /// </summary>
    public static FamilyPreviewData BuildFromFamilySymbol(FamilySymbol symbol, Document doc) {
        var family = symbol.Family;
        var typeCount = family.GetFamilySymbolIds().Count;
        var typeNames = new List<string> { symbol.Name }; // Only this type, not all types

        var instance = FindInstanceForSymbol(doc, symbol);
        var parameters = instance != null
            ? CollectParametersFromInstance(instance, doc, typeNames)
            : CollectParametersFromFamilyDocument(family, doc, typeNames, symbol.Name)
              ?? CollectParametersFromSymbol(symbol, doc, typeNames);

        return new FamilyPreviewData {
            Source = FamilyPreviewSource.FamilySymbol,
            FamilyName = family.Name,
            TypeName = symbol.Name,
            CategoryName = family.FamilyCategory?.Name ?? string.Empty,
            TypeCount = typeCount,
            TypeNames = typeNames,
            Parameters = parameters
        };
    }

    /// <summary>
    ///     Builds preview data from a FamilyInstance.
    ///     Shows both instance parameter values and type parameter values.
    /// </summary>
    public static FamilyPreviewData BuildFromFamilyInstance(FamilyInstance instance, Document doc) {
        var symbol = instance.Symbol;
        var family = symbol.Family;
        var typeCount = family.GetFamilySymbolIds().Count;
        var typeNames = new List<string> { symbol.Name }; // Only this type, not all types

        var parameters = CollectParametersFromInstance(instance, doc, typeNames);

        // Get location info
        (double X, double Y, double Z)? location = null;
        if (instance.Location is LocationPoint locPoint) {
            var pt = locPoint.Point;
            location = (pt.X, pt.Y, pt.Z);
        } else if (instance.Location is LocationCurve locCurve) {
            var midpoint = locCurve.Curve.Evaluate(0.5, true);
            location = (midpoint.X, midpoint.Y, midpoint.Z);
        }

        // Get level
        var level = instance.get_Parameter(BuiltInParameter.INSTANCE_REFERENCE_LEVEL_PARAM)?.AsValueString()
                    ?? instance.get_Parameter(BuiltInParameter.INSTANCE_SCHEDULE_ONLY_LEVEL_PARAM)?.AsValueString();

        // Get host
        string? hostInfo = null;
        if (instance.Host != null)
            hostInfo = $"{instance.Host.Name} (ID: {instance.Host.Id})";

        return new FamilyPreviewData {
            Source = FamilyPreviewSource.FamilyInstance,
            FamilyName = family.Name,
            TypeName = symbol.Name,
            CategoryName = family.FamilyCategory?.Name ?? string.Empty,
            TypeCount = typeCount,
            TypeNames = typeNames,
            InstanceId = instance.Id.ToString(),
            InstanceLevel = level,
            InstanceHost = hostInfo,
            InstanceLocation = location,
            Parameters = parameters
        };
    }

    // ==================== Parameter Collection ====================

    private static List<FamilyParameterPreview> CollectParametersFromSymbol(
        FamilySymbol symbol,
        Document doc,
        List<string> typeNames
    ) {
        var results = new Dictionary<string, FamilyParameterPreview>(StringComparer.Ordinal);

        // Collect type parameters from this symbol
        foreach (Parameter param in symbol.Parameters) {
            if (param.Definition == null) continue;

            var key = GetParamKey(param.Definition.Name, isInstance: false);
            var preview = GetOrCreatePreview(results, key, param, isInstance: false, typeNames);
            preview.ValuesPerType[symbol.Name] = GetParameterValueString(param, doc);
        }

        return [.. results.Values.OrderBy(p => p.Name).ThenByDescending(p => p.IsInstance)];
    }

    private static List<FamilyParameterPreview> CollectParametersFromInstance(
        FamilyInstance instance,
        Document doc,
        List<string> typeNames
    ) {
        var results = new Dictionary<string, FamilyParameterPreview>(StringComparer.Ordinal);
        var symbol = instance.Symbol;

        // Collect instance parameters from the actual instance
        foreach (Parameter param in instance.Parameters) {
            if (param.Definition == null) continue;

            var key = GetParamKey(param.Definition.Name, isInstance: true);
            var preview = GetOrCreatePreview(results, key, param, isInstance: true, typeNames);
            var value = GetParameterValueString(param, doc);

            // For instance source, store in InstanceValue and also in ValuesPerType for display
            var previewWithValue = preview with { InstanceValue = value };
            previewWithValue.ValuesPerType[symbol.Name] = value;
            results[key] = previewWithValue;
        }

        // Collect type parameters from the symbol
        foreach (Parameter param in symbol.Parameters) {
            if (param.Definition == null) continue;

            var key = GetParamKey(param.Definition.Name, isInstance: false);
            var preview = GetOrCreatePreview(results, key, param, isInstance: false, typeNames);
            preview.ValuesPerType[symbol.Name] = GetParameterValueString(param, doc);
        }

        return [.. results.Values.OrderBy(p => p.Name).ThenByDescending(p => p.IsInstance)];
    }

    private static List<FamilyParameterPreview>? CollectParametersFromFamilyDocument(
        Family family,
        Document hostDocument,
        List<string> typeNames,
        string typeName
    ) {
        Document? famDoc = null;
        var shouldClose = false;

        try {
            famDoc = DocumentManager.FindOpenFamilyDocument(family);
            if (famDoc == null) {
                famDoc = hostDocument.EditFamily(family);
                shouldClose = famDoc != null;
            }

            if (famDoc == null || !famDoc.IsFamilyDocument)
                return null;

            var familyDoc = new FamilyDocument(famDoc);
            var fm = familyDoc.FamilyManager;
            var parameters = fm.Parameters.OfType<FamilyParameter>().ToList();
            if (parameters.Count == 0)
                return [];

            var targetType = fm.Types.Cast<FamilyType>().FirstOrDefault(t => t.Name == typeName);
            if (targetType == null)
                return [];

            var results = new Dictionary<string, FamilyParameterPreview>(StringComparer.Ordinal);

            // Wrap in transaction since fm.CurrentType setter uses a sub-transaction internally
            using var tx = new Transaction(famDoc, "Collect Family Parameters");
            _ = tx.Start();

            try {
                fm.CurrentType = targetType;

                foreach (var param in parameters) {
                    var key = GetParamKey(param.Definition.Name, param.IsInstance);
                    var preview = GetOrCreatePreview(results, key, param, typeNames);
                    preview.ValuesPerType[typeName] = familyDoc.GetValueString(param);
                }
            } finally {
                if (tx.HasStarted())
                    _ = tx.RollBack();
            }

            return [.. results.Values.OrderBy(p => p.Name).ThenByDescending(p => p.IsInstance)];
        } catch {
            return null;
        } finally {
            if (famDoc != null && shouldClose)
                _ = famDoc.Close(false);
        }
    }

    private static FamilyParameterPreview GetOrCreatePreview(
        Dictionary<string, FamilyParameterPreview> results,
        string key,
        FamilyParameter param,
        List<string> typeNames
    ) {
        if (results.TryGetValue(key, out var existing))
            return existing;

        Guid? sharedGuid = null;
        if (param.IsShared) {
            try { sharedGuid = param.GUID; } catch { /* GUID access can throw */ }
        }

        var created = new FamilyParameterPreview {
            Name = param.Definition.Name,
            IsInstance = param.IsInstance,
            DataType = SafeGetLabel(() => param.Definition.GetDataType().ToLabel()),
            StorageType = param.StorageType.ToString(),
            Group = SafeGetLabel(() => param.Definition.GetGroupTypeId().ToLabel()),
            IsBuiltIn = param.IsBuiltInParameter(),
            IsShared = param.IsShared,
            SharedGuid = sharedGuid,
            Formula = string.IsNullOrWhiteSpace(param.Formula) ? null : param.Formula,
            ValuesPerType = typeNames.ToDictionary(t => t, _ => (string?)null, StringComparer.Ordinal)
        };

        results[key] = created;
        return created;
    }

    private static FamilyInstance? FindInstanceForSymbol(Document doc, FamilySymbol symbol) =>
        new FilteredElementCollector(doc)
            .OfClass(typeof(FamilyInstance))
            .Cast<FamilyInstance>()
            .FirstOrDefault(i => i.Symbol.Id == symbol.Id);

    // ==================== Helpers ====================

    private static string GetParamKey(string name, bool isInstance) => $"{name}|{isInstance}";

    private static FamilyParameterPreview GetOrCreatePreview(
        Dictionary<string, FamilyParameterPreview> results,
        string key,
        Parameter param,
        bool isInstance,
        List<string> typeNames
    ) {
        if (results.TryGetValue(key, out var existing))
            return existing;

        var def = param.Definition;

        Guid? sharedGuid = null;
        if (param.IsShared) {
            try { sharedGuid = param.GUID; } catch { /* GUID access can throw */ }
        }

        var created = new FamilyParameterPreview {
            Name = def.Name,
            IsInstance = isInstance,
            DataType = SafeGetLabel(() => def.GetDataType().ToLabel()),
            StorageType = param.StorageType.ToString(),
            Group = SafeGetLabel(() => def.GetGroupTypeId().ToLabel()),
            IsBuiltIn = param.IsBuiltInParameter(),
            IsShared = param.IsShared,
            SharedGuid = sharedGuid,
            ValuesPerType = typeNames.ToDictionary(t => t, _ => (string?)null, StringComparer.Ordinal)
        };

        results[key] = created;
        return created;
    }

    /// <summary>
    ///     Safely gets a label, returning empty string if the ForgeTypeId isn't valid for label lookup.
    /// </summary>
    private static string SafeGetLabel(Func<string> getLabel) {
        try {
            return getLabel();
        } catch (Autodesk.Revit.Exceptions.ArgumentException) {
            return string.Empty;
        }
    }

    /// <summary>
    ///     Gets the string value of a Parameter, handling all storage types correctly.
    /// </summary>
    private static string? GetParameterValueString(Parameter param, Document doc) {
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

    private static string? GetElementIdValueString(Parameter param, Document doc) {
        var elementId = param.AsElementId();
        if (elementId == null || elementId == ElementId.InvalidElementId)
            return null;

        var element = doc.GetElement(elementId);
        if (element != null)
            return $"{element.Name} [ID:{elementId.Value()}]";

        return $"[ID:{elementId.Value()}]";
    }
}
