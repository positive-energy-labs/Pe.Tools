using Pe.Revit.DocumentData.Parameters;
using Pe.Revit.Extensions.FamDocument;
using Pe.Revit.Extensions.ProjDocument;
using Pe.Shared.RevitData;
using Pe.Shared.RevitData.Families;

namespace Pe.Revit.DocumentData.Families.Extraction;

/// <summary>
///     One-pass family truth extraction: all types × all parameters (values + formulas) read via
///     <c>FamilyType.As*(FamilyParameter)</c> accessors — no <c>FamilyManager.CurrentType</c> switching,
///     no transaction. This is the single reader behind both the loaded-families matrix and FamilyFoundry
///     snapshot capture; both speak <see cref="FamilySnapshotRecord" />.
/// </summary>
public static class FamilySnapshotExtractor {
    /// <summary>
    ///     Extracts from an already-open family document (FamilyFoundry pipeline path). No EditFamily,
    ///     no transaction, read-only. Family identity fields are best-effort here (a standalone family doc
    ///     has no project-side Family element); callers with project context should prefer
    ///     <see cref="ExtractFromProjectFamily" /> or overwrite identity afterwards.
    /// </summary>
    public static FamilySnapshotRecord ExtractFromFamilyDocument(Document familyDocument) {
        var famDoc = new FamilyDocument(familyDocument);
        var issues = new List<RevitDataIssue>();
        var parameters = ExtractParameters(famDoc, issues, out var typeNames);

        return new FamilySnapshotRecord(
            FamilyId: -1,
            FamilyUniqueId: string.Empty,
            FamilyName: familyDocument.Title,
            CategoryName: familyDocument.OwnerFamily?.FamilyCategory?.Name,
            VersionGuid: null, // stamped only at save boundaries by the persistence layer
            TypeNames: typeNames,
            Parameters: parameters,
            Issues: issues,
            IsPartial: issues.Any(issue => issue.Severity == RevitDataIssueSeverity.Error)
        );
    }

    /// <summary>
    ///     Extracts a loaded family's authored truth from a project document: reuses an already-open family
    ///     document when present, otherwise EditFamily (must be called outside any transaction), always
    ///     Close(false) when we opened it. Failure degrades to an IsPartial record with an issue.
    /// </summary>
    public static FamilySnapshotRecord ExtractFromProjectFamily(Document projectDocument, Family family) {
        var issues = new List<RevitDataIssue>();
        IReadOnlyList<FamilyParameterSnapshot> parameters = [];
        IReadOnlyList<string> typeNames = [];

        Document? familyDocument = null;
        var shouldClose = false;
        try {
            var existingFamilyDocument = projectDocument.Application.FindOpenFamilyDocument(family);
            familyDocument = existingFamilyDocument ?? projectDocument.EditFamily(family);
            shouldClose = existingFamilyDocument == null;

            var famDoc = new FamilyDocument(familyDocument);
            parameters = ExtractParameters(famDoc, issues, out typeNames);
        } catch (Exception ex) {
            issues.Add(new RevitDataIssue(
                "FamilySnapshotExtractionFailed",
                RevitDataIssueSeverity.Error,
                $"Could not extract family document truth for '{family.Name}': {ex.Message}"
            ));
        } finally {
            if (shouldClose && familyDocument != null) {
                try {
                    _ = familyDocument.Close(false);
                } catch {
                    // Best effort only; extraction must not fail because a temp family doc could not close.
                }
            }
        }

        return new FamilySnapshotRecord(
            family.Id.Value(),
            family.UniqueId,
            family.Name,
            family.FamilyCategory?.Name,
            VersionGuid: null,
            typeNames,
            parameters,
            issues,
            IsPartial: issues.Any(issue => issue.Severity == RevitDataIssueSeverity.Error)
        );
    }

    private static IReadOnlyList<FamilyParameterSnapshot> ExtractParameters(
        FamilyDocument famDoc,
        List<RevitDataIssue> issues,
        out IReadOnlyList<string> typeNames
    ) {
        var fm = famDoc.FamilyManager;
        var types = fm.Types.Cast<FamilyType>().ToList();
        typeNames = types
            .Select(type => type.Name)
            .Distinct(StringComparer.Ordinal)
            .ToList();

        var snapshots = new List<FamilyParameterSnapshot>();
        foreach (var familyParameter in fm.GetParameters()) {
            try {
                snapshots.Add(ExtractParameter(famDoc, familyParameter, types));
            } catch (Exception ex) {
                issues.Add(new RevitDataIssue(
                    "FamilyParameterSnapshotReadFailed",
                    RevitDataIssueSeverity.Warning,
                    $"Could not read family parameter '{familyParameter.Definition?.Name}': {ex.Message}"
                ));
            }
        }

        return snapshots
            .OrderBy(snapshot => snapshot.Definition.Identity.Name, StringComparer.OrdinalIgnoreCase)
            .ThenByDescending(snapshot => snapshot.Definition.IsInstance)
            .ToList();
    }

    private static FamilyParameterSnapshot ExtractParameter(
        FamilyDocument famDoc,
        FamilyParameter familyParameter,
        IReadOnlyList<FamilyType> types
    ) {
        var identity = ParameterIdentityFactory.FromFamilyParameter(familyParameter);
        var dataType = NormalizeForgeTypeId(familyParameter.Definition.GetDataType());
        var groupType = NormalizeForgeTypeId(familyParameter.Definition.GetGroupTypeId());
        var formula = string.IsNullOrWhiteSpace(familyParameter.Formula) ? null : familyParameter.Formula;

        var valuesPerType = new Dictionary<string, string?>(StringComparer.Ordinal);
        foreach (var type in types)
            valuesPerType[type.Name] = famDoc.GetValueString(type, familyParameter);

        return new FamilyParameterSnapshot(
            new ParameterDefinitionDescriptor(
                identity,
                familyParameter.IsInstance,
                dataType,
                dataType == null ? null : RevitLabelCatalog.GetLabelForSpec(familyParameter.Definition.GetDataType()),
                groupType,
                groupType == null
                    ? null
                    : RevitLabelCatalog.GetLabelForPropertyGroup(familyParameter.Definition.GetGroupTypeId())
            ),
            familyParameter.IsShared ? LoadedFamilyParameterKind.SharedParameter : LoadedFamilyParameterKind.FamilyParameter,
            LoadedFamilyParameterPresence.Family,
            familyParameter.StorageType.ToString(),
            formula == null ? FormulaState.None : FormulaState.Present,
            formula,
            valuesPerType
        );
    }

    private static string? NormalizeForgeTypeId(ForgeTypeId forgeTypeId) =>
        string.IsNullOrWhiteSpace(forgeTypeId?.TypeId) ? null : forgeTypeId.TypeId;
}
