using Pe.Revit.Parameters;
using Pe.Revit.DocumentData.Parameters;
using Pe.Revit.Extensions.FamDocument;
using Pe.Revit.Extensions.ProjDocument;
using Pe.Shared.RevitData;
using Pe.Shared.RevitData.Families;
using Newtonsoft.Json.Linq;

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
    ///     Extracts a loaded family's authored truth from its exact project via EditFamily (outside any transaction), always
    ///     Close(false) when we opened it. Failure degrades to an IsPartial record with an issue.
    /// </summary>
    public static FamilySnapshotRecord ExtractFromProjectFamily(Document projectDocument, Family family) {
        var issues = new List<RevitDataIssue>();
        IReadOnlyList<FamilyParameterSnapshot> parameters = [];
        IReadOnlyList<string> typeNames = [];

        Document? familyDocument = null;
        try {
            familyDocument = projectDocument.EditFamily(family);

            var famDoc = new FamilyDocument(familyDocument);
            parameters = ExtractParameters(famDoc, issues, out typeNames);
        } catch (Exception ex) {
            issues.Add(new RevitDataIssue(
                "FamilySnapshotExtractionFailed",
                RevitDataIssueSeverity.Error,
                $"Could not extract family document truth for '{family.Name}': {ex.Message}"
            ));
        } finally {
            if (familyDocument != null) {
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
                snapshots.Add(ExtractParameter(famDoc, familyParameter, types, issues));
            } catch (Exception ex) {
                issues.Add(new RevitDataIssue(
                    "FamilyParameterSnapshotReadFailed",
                    RevitDataIssueSeverity.Error,
                    $"Could not read required fields for family parameter '{familyParameter.Definition?.Name}': {ex.GetType().FullName}: {ex.Message}",
                    ParameterName: familyParameter.Definition?.Name
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
        IReadOnlyList<FamilyType> types,
        List<RevitDataIssue> issues
    ) {
        var identity = ParameterIdentityFactory.FromFamilyParameter(familyParameter);
        var dataType = NormalizeForgeTypeId(familyParameter.Definition.GetDataType());
        var groupType = NormalizeForgeTypeId(familyParameter.Definition.GetGroupTypeId());
        var formula = string.IsNullOrWhiteSpace(familyParameter.Formula) ? null : familyParameter.Formula;

        var valuesPerType = new Dictionary<string, string?>(StringComparer.Ordinal);
        var spec = familyParameter.Definition.GetDataType();
        var format = familyParameter.StorageType == StorageType.Double ? ParameterPortableFormat.ForSpec(spec) : null;
        foreach (var type in types)
            valuesPerType[type.Name] = format is not null && type.HasValue(familyParameter) && type.AsDouble(familyParameter) is { } value
                ? format(value) : famDoc.GetValueString(type, familyParameter);

        return new FamilyParameterSnapshot(
            new ParameterDefinitionDescriptor(
                identity,
                familyParameter.IsInstance,
                dataType,
                dataType == null ? null : RevitLabelCatalog.GetLabelForSpec(familyParameter.Definition.GetDataType()),
                groupType,
                groupType == null
                    ? null
                    : RevitLabelCatalog.GetLabelForPropertyGroup(familyParameter.Definition.GetGroupTypeId()),
                (familyParameter.Definition as InternalDefinition)?.Visible,
                familyParameter.UserModifiable,
                ReadDescription(famDoc.Document, familyParameter, issues)
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

    private static string? ReadDescription(Document document, FamilyParameter parameter, List<RevitDataIssue> issues) {
        if (Autodesk.Revit.DB.ParameterUtils.IsBuiltInParameter(parameter.Id)) return null;
        try {
            var getSchema = typeof(Autodesk.Revit.DB.ParameterUtils).GetMethod(
                "GetParameterSchema",
                [typeof(ElementId), typeof(Document)]
            ) ?? throw new MissingMethodException(typeof(Autodesk.Revit.DB.ParameterUtils).FullName, "GetParameterSchema");
            var json = (string)getSchema.Invoke(null, [parameter.Id, document])!;
            return JObject.Parse(json)["description"]?.Value<string>();
        } catch (Exception ex) {
            var cause = ex is System.Reflection.TargetInvocationException { InnerException: { } inner } ? inner : ex;
            issues.Add(new RevitDataIssue(
                "FamilyParameterDescriptionReadFailed",
                RevitDataIssueSeverity.Warning,
                $"Could not read optional description for family parameter '{parameter.Definition.Name}' via ParameterUtils.GetParameterSchema: {cause.GetType().FullName}: {cause.Message}",
                ParameterName: parameter.Definition.Name
            ));
            return null;
        }
    }
}
