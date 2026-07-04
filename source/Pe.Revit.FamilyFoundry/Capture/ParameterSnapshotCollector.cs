using Pe.Revit.DocumentData.Families.Extraction;
using Pe.Revit.Extensions.FamDocument;
using Pe.Revit.Extensions.FamManager;
using Pe.Shared.RevitData.Families;

namespace Pe.Revit.FamilyFoundry.Capture;

/// <summary>
///     Collects parameter snapshots with strategy-based source selection. Both paths ride
///     FamilySnapshotExtractor (one FamilyType.As* pass, no transactions): the project path resolves the
///     family document via FindOpenFamilyDocument/EditFamily; the family-doc path reads the already-open
///     document directly.
/// </summary>
///
public class ParameterSnapshotCollector : IProjectSnapshotCollector, IFamilySnapshotCollector {
    // IFamilySnapshotCollector implementation (supplements or provides full collection)
    bool IFamilySnapshotCollector.ShouldCollect(FamilySnapshot snapshot) =>
        snapshot.Parameters == null ||
        snapshot.Parameters.Data?.Count == 0 ||
        snapshot.Parameters.IsPartial;

    // IFamilySnapshotCollector implementation (supplements project data with formulas, or collects everything)
    void IFamilySnapshotCollector.Collect(FamilySnapshot snapshot, FamilyDocument famDoc) {
        // Check if we have project data to supplement - explicit null checks for flow analysis
        if (snapshot.Parameters?.Data is { Count: > 0 } data) {
            // Keep only parameters that still have a family-doc counterpart before supplementing formulas.
            snapshot.Parameters.Data =
                [.. data.Where(s => famDoc.FamilyManager.FindParameter(s.Name) != null)];
            SupplementWithFormulas(snapshot, famDoc);
        } else
            snapshot.Parameters = this.CollectFromFamilyDoc(famDoc);
    }

    // IProjectSnapshotCollector implementation (preferred - runs first)
    bool IProjectSnapshotCollector.ShouldCollect(FamilySnapshot snapshot) =>
        snapshot.Parameters?.Data?.Count == 0 || snapshot.Parameters == null;

    public void Collect(FamilySnapshot snapshot, Document projectDoc, Family family) =>
        snapshot.Parameters = CollectFromProject(projectDoc, family);

    /// <summary>
    ///     Supplements partially-collected project data with formulas from the already-open family document.
    ///     The primary project path already tries this through the loaded-families collector stack, but this
    ///     fallback keeps the snapshot pipeline resilient when formula lookup stayed partial.Please 
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

    private static CapturedCollection<ParameterSnapshot> CollectFromProject(Document doc, Family family) {
        // One extractor pass over the family document (reuses the pipeline's already-open famDoc when
        // present). Replaces the old temp-placement value pass + formula-only EditFamily pass — the
        // authored family-doc truth is the right basis for FamilyFoundry's edit/reload cycle.
        var record = FamilySnapshotExtractor.ExtractFromProjectFamily(doc, family);

        return new CapturedCollection<ParameterSnapshot> {
            Source = SnapshotSource.Project,
            IsPartial = record.IsPartial,
            Data = ToSnapshots(record)
        };
    }

    private CapturedCollection<ParameterSnapshot> CollectFromFamilyDoc(FamilyDocument famDoc) {
        // FamilyType.As* accessors read any type's value directly — no CurrentType switching,
        // no transaction, no rollback sandbox.
        var record = FamilySnapshotExtractor.ExtractFromFamilyDocument(famDoc.Document);

        return new CapturedCollection<ParameterSnapshot> {
            Source = SnapshotSource.FamilyDoc,
            IsPartial = record.IsPartial,
            Data = ToSnapshots(record)
        };
    }

    private static List<ParameterSnapshot> ToSnapshots(FamilySnapshotRecord record) => [
        .. record.Parameters
            .Where(parameter => !IsInternalHelperParameter(parameter.Definition.Identity.Name))
            .Select(ParameterSnapshot.FromCanonical)
    ];

    // ==================== Helpers ====================

    private static string GetKey(string name, bool? isInstance) => $"{name}|{isInstance}";

    private static bool IsInternalHelperParameter(string? parameterName) =>
        !string.IsNullOrWhiteSpace(parameterName) &&
        parameterName.StartsWith("FF_Internal_", StringComparison.Ordinal);
}
