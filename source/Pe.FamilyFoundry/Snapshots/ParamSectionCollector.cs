using Pe.Extensions.FamDocument;
using Pe.Extensions.FamDocument.GetValue;
using Pe.Extensions.FamManager;
using Pe.Extensions.FamParameter;
using Pe.FamilyFoundry.Aggregators.Snapshots;
using Pe.Global.Services.Storage.Core.Json.SchemaProviders;

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
        // Check if we have project data to supplement - explicit null checks for flow analysis
        if (snapshot.Parameters?.Data is { Count: > 0 } data) {
            // Filter out project parameters (which don't have a counterpart in the family, this is an unusual-ish case)
            snapshot.Parameters.Data =
                [.. data.Where(s => famDoc.FamilyManager.FindParameter(s.Name) != null)];
            SupplementWithFormulas(snapshot, famDoc);
        } else {
            snapshot.Parameters = this.CollectFromFamilyDoc(famDoc);
        }
    }

    // IProjectCollector implementation (preferred - runs first)
    bool IProjectCollector.ShouldCollect(FamilySnapshot snapshot) => 
        snapshot.Parameters?.Data?.Count == 0 || snapshot.Parameters == null;

    public void Collect(FamilySnapshot snapshot, Document projectDoc, Family family) =>
        snapshot.Parameters = CollectFromProject(projectDoc, family);

    /// <summary>
    ///     Supplements existing project-collected data with formulas from family document.
    ///     ValuesPerType already exist from project collection, we just add Formula field.
    ///     The collected shape is later serialized into split settings-compatible form
    ///     (Parameters + PerTypeValuesTable) by snapshot output builders.
    /// </summary>
    private static void SupplementWithFormulas(FamilySnapshot snapshot, FamilyDocument famDoc) {
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

    private static SnapshotSection<ParamSnapshot> CollectFromProject(Document doc, Family family) {
        var selectedFamilyNames = new HashSet<string>(StringComparer.OrdinalIgnoreCase) { family.Name };
        var collected = ProjectFamilyParameterCollector.Collect(doc, selectedFamilyNames);

        // Always mark as partial - project collection cannot get formulas.
        // Family doc collector will supplement with formulas.
        return new SnapshotSection<ParamSnapshot> {
            Source = SnapshotSource.Project,
            IsPartial = true,
            Data = [
                .. collected.Select(item => new ParamSnapshot {
                    Name = item.Name,
                    IsInstance = item.IsInstance,
                    PropertiesGroup = item.PropertiesGroup,
                    DataType = item.DataType,
                    Formula = null,
                    ValuesPerType = item.ValuesPerType,
                    IsBuiltIn = item.IsBuiltIn,
                    SharedGuid = item.SharedGuid,
                    StorageType = item.StorageType,
                    IsProjectParameter = item.IsProjectParameter
                })
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

        return new SnapshotSection<ParamSnapshot> {
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
}