using Autodesk.Revit.DB;
using Autodesk.Revit.DB.Structure;
using Pe.Extensions.FamDocument;
using Pe.Extensions.FamDocument.GetValue;
using Pe.Extensions.FamManager;
using Pe.Extensions.FamParameter;
using Pe.FamilyFoundry.Aggregators.Snapshots;
using Pe.Global.PolyFill;

namespace Pe.FamilyFoundry.Snapshots;

/// <summary>
///     Collects parameter snapshots with strategy-based source selection.
///     Prefers project document (faster - no type cycling), uses family document to supplement with formulas.
///     Family doc collection runs if: no data exists, data is empty, or data is partial (missing formulas).
/// </summary>
public class ParamSectionCollector : IProjectCollector, IFamilyDocCollector {
    // IFamilyDocCollector implementation (supplements or provides full collection)
    bool IFamilyDocCollector.ShouldCollect(FamilySnapshot snapshot) =>
        snapshot.Parameters == null ||
        snapshot.Parameters.Data?.Count == 0 ||
        snapshot.Parameters.IsPartial;

    // IFamilyDocCollector implementation (supplements project data with formulas, or collects everything)
    void IFamilyDocCollector.Collect(FamilySnapshot snapshot, FamilyDocument famDoc) {
        // Check if we have project data to supplement
        var hasProjectData = snapshot.Parameters?.Data?.Count > 0;

        if (hasProjectData) {
            // Filter out project parameters (which don't have a counterpart in the family, this is an unusual-ish case)
            snapshot.Parameters.Data =
                [.. snapshot.Parameters.Data.Where(s => famDoc.FamilyManager.FindParameter(s.Name) != null)];
            this.SupplementWithFormulas(snapshot, famDoc);
        } else
            snapshot.Parameters = this.CollectFromFamilyDoc(famDoc);
    }

    // IProjectCollector implementation (preferred - runs first)
    bool IProjectCollector.ShouldCollect(FamilySnapshot snapshot) =>
        snapshot.Parameters?.Data?.Count == 0 || snapshot.Parameters == null;

    public void Collect(FamilySnapshot snapshot, Document projectDoc, Family family) =>
        snapshot.Parameters = this.CollectFromProject(projectDoc, family);

    /// <summary>
    ///     Supplements existing project-collected data with formulas from family document.
    ///     ValuesPerType already exist from project collection, we just add Formula field.
    /// </summary>
    private void SupplementWithFormulas(FamilySnapshot snapshot, FamilyDocument famDoc) {
        if (snapshot.Parameters?.Data == null || snapshot.Parameters.Data.Count == 0)
            return;

        var fm = famDoc.FamilyManager;

        // Create lookup for family parameters by key for O(1) access
        var familyParamLookup = fm.GetParameters()
            .ToDictionary(p => GetKey(p.Definition.Name, p.IsInstance), StringComparer.Ordinal);

        var updatedData = new List<ParamSnapshot>();

        foreach (var existingSnap in snapshot.Parameters.Data) {
            var key = GetKey(existingSnap.Name, existingSnap.IsInstance);

            // O(1) lookup instead of O(n) FirstOrDefault
            if (familyParamLookup.TryGetValue(key, out var matchingParam)
                && !string.IsNullOrWhiteSpace(matchingParam.Formula)) {
                // Create updated snapshot with formula
                updatedData.Add(existingSnap with { Formula = matchingParam.Formula });
            } else {
                // Keep existing snapshot unchanged
                updatedData.Add(existingSnap);
            }
        }

        // Replace the data list with updated snapshots
        snapshot.Parameters.Data = updatedData;
    }

    private SnapshotSection<ParamSnapshot> CollectFromProject(Document doc, Family family) {
        var symbols = GetAllSymbols(family);
        if (symbols.Count == 0)
            return new SnapshotSection<ParamSnapshot> { Source = SnapshotSource.Project, IsPartial = true };

        var typeNames = symbols
            .Select(s => s.Name)
            .Distinct(StringComparer.Ordinal)
            .ToList();

        // Build set of project parameter names from ParameterBindings
        var projectParamNames = GetProjectParameterNames(doc);

        var snapshots = new Dictionary<string, ParamSnapshot>(StringComparer.Ordinal);
        var instanceCollectionCount = 0;

        using var tx = new Transaction(doc, "Temp Instance for Param Snapshot Collection");
        _ = tx.Start();

        try {
            foreach (var symbol in symbols) {
                if (!symbol.IsActive)
                    symbol.Activate();

                var typeName = symbol.Name;

                // Collect type parameters from FamilySymbol (IsInstance = false)
                CollectTypeParams(symbol, typeName, typeNames, snapshots, projectParamNames);

                // Collect instance parameters from temp FamilyInstance (IsInstance = true)
                var tempInstance = doc.Create.NewFamilyInstance(
                    XYZ.Zero,
                    symbol,
                    StructuralType.NonStructural);

                if (tempInstance is not null) {
                    CollectInstanceParams(tempInstance, typeName, typeNames, snapshots, projectParamNames);
                    instanceCollectionCount++;
                }
            }
        } finally {
            if (tx.HasStarted())
                _ = tx.RollBack();
        }

        // Always mark as partial - project collection cannot get formulas
        // Family doc collector will supplement with formulas
        // Also partial if we couldn't create temp instances for all symbols
        // Allow for better filterting out of Proj Parameters in the family collector counterpart
        return new SnapshotSection<ParamSnapshot> {
            Source = SnapshotSource.Project,
            IsPartial = true,
            Data = [
                .. snapshots.Values
                    .OrderBy(s => s.Name, StringComparer.OrdinalIgnoreCase)
                    .ThenByDescending(s => s.IsInstance)
            ]
        };
    }

    private SnapshotSection<ParamSnapshot> CollectFromFamilyDoc(FamilyDocument famDoc) {
        var fm = famDoc.FamilyManager;

        var types = fm.Types.Cast<FamilyType>().ToList();
        var typeNames = types.Select(t => t.Name).Distinct(StringComparer.Ordinal).ToList();

        var familyParameters = fm.GetParameters().ToList();
        var snapshots = new Dictionary<string, ParamSnapshot>(StringComparer.Ordinal);

        foreach (var p in familyParameters) {
            var key = GetKey(p.Definition.Name, p.IsInstance);

            var isBuiltIn = p.IsBuiltInParameter();
            Guid? sharedGuid = null;
            if (p.IsShared) {
                try { sharedGuid = p.GUID; } catch {
                    /* GUID access can throw */
                }
            }


            snapshots[key] = new ParamSnapshot {
                Name = p.Definition.Name,
                IsInstance = p.IsInstance,
                PropertiesGroup = p.Definition.GetGroupTypeId(),
                DataType = p.Definition.GetDataType(),
                Formula = string.IsNullOrWhiteSpace(p.Formula) ? null : p.Formula,
                // temp create dict so we can assign to it below
                ValuesPerType = typeNames.ToDictionary(t => t, _ => (string)null, StringComparer.Ordinal),
                IsBuiltIn = isBuiltIn,
                SharedGuid = sharedGuid,
                StorageType = p.StorageType
            };
        }

        // Wrap in transaction since fm.CurrentType setter uses a sub-transaction internally
        using var tx = new Transaction(famDoc.Document, "Snapshot Collection");
        _ = tx.Start();

        try {
            foreach (var t in types) {
                fm.CurrentType = t;

                foreach (var p in familyParameters) {
                    var key = GetKey(p.Definition.Name, p.IsInstance);
                    if (!snapshots.TryGetValue(key, out var snap))
                        continue;

                    snap.ValuesPerType[t.Name] = famDoc.GetValueString(p); // must support this in SetValue.
                }
            }
        } finally {
            // Rollback to restore original CurrentType and avoid any side effects
            if (tx.HasStarted())
                _ = tx.RollBack();
        }

        return new SnapshotSection<ParamSnapshot> {
            Source = SnapshotSource.FamilyDoc,
            Data = snapshots.Values
                .OrderBy(s => s.Name, StringComparer.OrdinalIgnoreCase)
                .ThenByDescending(s => s.IsInstance)
                .ToList()
        };
    }

    // ==================== Helpers ====================

    private static void CollectTypeParams(
        FamilySymbol symbol,
        string typeName,
        List<string> allTypeNames,
        Dictionary<string, ParamSnapshot> snapshots,
        HashSet<string> projectParamNames
    ) {
        foreach (var p in symbol.Parameters.OfType<Parameter>().Where(p => p.Definition != null)) {
            var key = GetKey(p.Definition.Name, false);
            var snap = GetOrCreateSnapshot(p, false, allTypeNames, snapshots, key, projectParamNames);
            snap.ValuesPerType[typeName] = GetParameterValueString(p, symbol.Document);
        }
    }

    private static void CollectInstanceParams(
        FamilyInstance instance,
        string typeName,
        List<string> allTypeNames,
        Dictionary<string, ParamSnapshot> snapshots,
        HashSet<string> projectParamNames
    ) {
        foreach (var p in instance.Parameters.OfType<Parameter>().Where(p => p.Definition != null)) {
            var key = GetKey(p.Definition.Name, true);
            var snap = GetOrCreateSnapshot(p, true, allTypeNames, snapshots, key, projectParamNames);
            snap.ValuesPerType[typeName] = GetParameterValueString(p, instance.Document);
        }
    }

    /// <summary>
    ///     Gets the string value of a Parameter, handling all storage types correctly.
    ///     - Double: Returns unit-formatted string (e.g., "10'", "120 V")
    ///     - String: Returns the raw string value
    ///     - Integer (Yes/No): Returns "Yes" or "No"
    ///     - Integer (other): Returns the integer as string
    ///     - ElementId: Returns the element name if available, otherwise null
    /// </summary>
    private static string GetParameterValueString(Parameter param, Document doc) {
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

        // Yes/No parameters should return "Yes" or "No" for human readability
        if (dataType == SpecTypeId.Boolean.YesNo)
            return intValue == 1 ? "Yes" : "No";

        return intValue.ToString();
    }

    private static string GetElementIdValueString(Parameter param, Document doc) {
        var elementId = param.AsElementId();
        if (elementId == null || elementId == ElementId.InvalidElementId)
            return null;

        // Try to get the element name from the document
        var element = doc.GetElement(elementId);
        if (element != null) {
            // Format: "ElementName [ID:12345]" - human-readable and parseable
            return $"{element.Name} [ID:{elementId.Value()}]";
        }

        // Fallback to ID-only format if element not found
        return $"[ID:{elementId.Value()}]";
    }

    private static ParamSnapshot GetOrCreateSnapshot(
        Parameter param,
        bool isInstance,
        List<string> allTypeNames,
        Dictionary<string, ParamSnapshot> snapshots,
        string key,
        HashSet<string> projectParamNames
    ) {
        if (snapshots.TryGetValue(key, out var existing))
            return existing;

        var def = param.Definition ?? throw new InvalidOperationException("Parameter.Definition is null.");

        var isBuiltIn = param.IsBuiltInParameter();
        Guid? sharedGuid = null;
        if (param.IsShared) {
            try { sharedGuid = param.GUID; } catch {
                /* GUID access can still throw sometimes */
            }
        }

        var values = allTypeNames.ToDictionary(t => t, _ => (string)null, StringComparer.Ordinal);

        var created = new ParamSnapshot {
            Name = def.Name,
            IsInstance = isInstance,
            PropertiesGroup = def.GetGroupTypeId(),
            DataType = def.GetDataType(),
            Formula = null, // Formula not available in project context
            ValuesPerType = values,
            IsBuiltIn = isBuiltIn,
            SharedGuid = sharedGuid,
            StorageType = param.StorageType,
            IsProjectParameter = projectParamNames.Contains(def.Name)
        };

        snapshots[key] = created;
        return created;
    }

    private static string GetKey(string name, bool isInstance) => $"{name}|{isInstance}";

    private static List<FamilySymbol> GetAllSymbols(Family family) {
        var symbolIds = family.GetFamilySymbolIds();
        if (symbolIds == null || symbolIds.Count == 0)
            return [];

        return symbolIds
            .Select(id => family.Document.GetElement(id) as FamilySymbol)
            .Where(s => s != null)
            .ToList()!;
    }

    /// <summary>
    ///     Gets the names of all project parameters from Document.ParameterBindings.
    ///     Returns empty set if doc is a family document (ParameterBindings throws for family docs).
    /// </summary>
    private static HashSet<string> GetProjectParameterNames(Document doc) {
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
            // ParameterBindings can throw InvalidOperationException for family documents
            // or other edge cases - return empty set
        }

        return projectParamNames;
    }
}