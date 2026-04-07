using Pe.Revit.Extensions.FamDocument;
using Pe.Revit.Extensions.FamDocument.GetValue;
using Pe.Revit.Extensions.FamManager;
using Pe.Revit.Extensions.FamParameter;
using Pe.Revit.FamilyFoundry.Aggregators.Snapshots;
using Pe.Revit.Global.Revit.Lib.Families.LoadedFamilies.Collectors;
using Pe.Revit.Global.Revit.Lib.Families.LoadedFamilies.Models;

namespace Pe.Revit.FamilyFoundry.Snapshots;

/// <summary>
///     Collects parameter snapshots with strategy-based source selection.
///     Prefers the project document path, which now runs the fast temp-instance value pass and then a
///     formula-only family-doc pass without iterating family types. Family-doc collection still exists as the
///     fallback when only a family document is available or when the project path remains partial.
/// </summary>
public class ParamSectionCollector : IProjectCollector, IFamilyDocCollector {
    // IFamilyDocCollector implementation (supplements or provides full collection)
    bool IFamilyDocCollector.ShouldCollect(FamilySnapshot snapshot) =>
        snapshot.Parameters == null ||
        snapshot.Parameters.Data?.Count == 0 ||
        snapshot.Parameters.IsPartial;

    // IFamilyDocCollector implementation (supplements project data with formulas, or collects everything)
    void IFamilyDocCollector.Collect(FamilySnapshot snapshot, FamilyDocument famDoc) {
        // Check if we have project data to supplement - explicit null checks for flow analysis
        if (snapshot.Parameters?.Data is { Count: > 0 } data) {
            // Keep only parameters that still have a family-doc counterpart before supplementing formulas.
            snapshot.Parameters.Data =
                [.. data.Where(s => famDoc.FamilyManager.FindParameter(s.Name) != null)];
            SupplementWithFormulas(snapshot, famDoc);
        } else
            snapshot.Parameters = this.CollectFromFamilyDoc(famDoc);
    }

    // IProjectCollector implementation (preferred - runs first)
    bool IProjectCollector.ShouldCollect(FamilySnapshot snapshot) =>
        snapshot.Parameters?.Data?.Count == 0 || snapshot.Parameters == null;

    public void Collect(FamilySnapshot snapshot, Document projectDoc, Family family) =>
        snapshot.Parameters = CollectFromProject(projectDoc, family);

    /// <summary>
    ///     Supplements partially-collected project data with formulas from the already-open family document.
    ///     The primary project path already tries this through the loaded-families collector stack, but this
    ///     fallback keeps the snapshot pipeline resilient when formula lookup stayed partial.
    /// </summary>
    private static void SupplementWithFormulas(FamilySnapshot snapshot, FamilyDocument famDoc) {
        if (snapshot.Parameters?.Data == null || snapshot.Parameters.Data.Count == 0)
            return;

        var fm = famDoc.FamilyManager;

        // Create lookup for family parameters by key for O(1) access
        var familyParamLookup = fm.GetParameters()
            .ToDictionary(p => GetKey(p.Definition.Name, p.IsInstance), StringComparer.Ordinal);

        var updatedData = new List<ParameterSnapshot>();

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

    private static SnapshotSection<ParameterSnapshot> CollectFromProject(Document doc, Family family) {
        var seededFamily = new CollectedLoadedFamilyRecord {
            FamilyId = family.Id.Value(),
            FamilyUniqueId = family.UniqueId,
            FamilyName = family.Name,
            CategoryName = family.FamilyCategory?.Name,
            Types = family.GetFamilySymbolIds()
                .Select(id => family.Document.GetElement(id) as FamilySymbol)
                .Where(symbol => symbol != null)
                .Select(symbol => new CollectedLoadedFamilyTypeRecord(symbol!.Name))
                .OrderBy(type => type.TypeName, StringComparer.Ordinal)
                .ToList()
        };
        var collectedFamily = LoadedFamiliesProjectValueCollector.Collect(
                                      doc,
                                      new List<CollectedLoadedFamilyRecord> { seededFamily }
                                  )
                                  .SingleOrDefault()
                              ?? seededFamily;
        var supplementedFamily = LoadedFamiliesFormulaCollector.Supplement(
                                         doc,
                                         new List<CollectedLoadedFamilyRecord> { collectedFamily }
                                     )
                                     .SingleOrDefault()
                                 ?? collectedFamily;
        var isPartial = supplementedFamily.Issues.Any(issue =>
            string.Equals(issue.Code, "FamilyFormulaCollectionFailed", StringComparison.Ordinal) ||
            string.Equals(issue.Code, "FamilyParameterFormulaReadFailed", StringComparison.Ordinal));

        return new SnapshotSection<ParameterSnapshot> {
            Source = SnapshotSource.Project,
            IsPartial = isPartial,
            Data = [
                .. supplementedFamily.Parameters
                    .Where(item =>
                        item.Kind is CollectedParameterKind.FamilyParameter or CollectedParameterKind.SharedParameter)
                    .Where(item => !IsInternalHelperParameter(item.Name))
                    .Select(item => new ParameterSnapshot {
                        Name = item.Name,
                        IsInstance = item.IsInstance,
                        PropertiesGroup = new ForgeTypeId(item.GroupTypeId ?? string.Empty),
                        DataType = new ForgeTypeId(item.DataTypeId ?? string.Empty),
                        Formula = item.Formula,
                        ValuesPerType = new Dictionary<string, string?>(item.ValuesByType, StringComparer.Ordinal),
                        IsBuiltIn = item.IsBuiltIn,
                        SharedGuid = Guid.TryParse(item.SharedGuid, out var sharedGuid) ? sharedGuid : null,
                        StorageType = Enum.TryParse<StorageType>(item.StorageType, out var storageType)
                            ? storageType
                            : StorageType.None
                    })
            ]
        };
    }

    private SnapshotSection<ParameterSnapshot> CollectFromFamilyDoc(FamilyDocument famDoc) {
        var fm = famDoc.FamilyManager;

        var types = fm.Types.Cast<FamilyType>().ToList();
        var typeNames = types.Select(t => t.Name).Distinct(StringComparer.Ordinal).ToList();

        var familyParameters = fm.GetParameters().ToList();
        var snapshots = new Dictionary<string, ParameterSnapshot>(StringComparer.Ordinal);

        foreach (var p in familyParameters) {
            if (IsInternalHelperParameter(p.Definition.Name))
                continue;

            var key = GetKey(p.Definition.Name, p.IsInstance);

            var isBuiltIn = p.IsBuiltInParameter();
            Guid? sharedGuid = null;
            if (p.IsShared) {
                try { sharedGuid = p.GUID; } catch {
                    /* GUID access can throw */
                }
            }

            snapshots[key] = new ParameterSnapshot {
                Name = p.Definition.Name,
                IsInstance = p.IsInstance,
                PropertiesGroup = p.Definition.GetGroupTypeId(),
                DataType = p.Definition.GetDataType(),
                Formula = string.IsNullOrWhiteSpace(p.Formula) ? null : p.Formula,
                // temp create dict so we can assign to it below
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

                    var value = famDoc.GetValueString(p); // must support this in SetValue.
                    if (IsDefaultNumericValue(famDoc, p))
                        value = null;

                    snap.ValuesPerType[t.Name] = value;
                }
            }
        } finally {
            // Rollback to restore original CurrentType and avoid any side effects
            if (tx.HasStarted())
                _ = tx.RollBack();
        }

        return new SnapshotSection<ParameterSnapshot> {
            Source = SnapshotSource.FamilyDoc,
            Data = snapshots.Values
                .OrderBy(s => s.Name, StringComparer.OrdinalIgnoreCase)
                .ThenByDescending(s => s.IsInstance)
                .ToList()
        };
    }

    // ==================== Helpers ====================

    private static bool IsDefaultNumericValue(FamilyDocument famDoc, FamilyParameter parameter) {
        var rawValue = famDoc.GetValue(parameter);
        if (rawValue == null) return true;

        if (parameter.StorageType == StorageType.Double)
            return rawValue is double doubleValue && Math.Abs(doubleValue) <= 1e-9;

        if (parameter.StorageType != StorageType.Integer)
            return false;

        // Keep Yes/No values explicit ("No"/"Yes") and only suppress numeric integer zero.
        if (parameter.Definition.GetDataType() == SpecTypeId.Boolean.YesNo)
            return false;

        return rawValue is int intValue && intValue == 0;
    }

    private static string GetKey(string name, bool isInstance) => $"{name}|{isInstance}";

    private static bool IsInternalHelperParameter(string? parameterName) =>
        !string.IsNullOrWhiteSpace(parameterName) &&
        parameterName.StartsWith("FF_Internal_", StringComparison.Ordinal);
}
