using Pe.Shared.HostContracts.RevitData;
using Pe.Revit.Global.Revit.Lib.Families.LoadedFamilies.Models;
using Pe.Shared.RevitData.Families;
using Pe.Shared.RevitData.Parameters;

namespace Pe.Revit.Global.Revit.Lib.Families.LoadedFamilies.Collectors;

internal static class LoadedFamiliesCollectorSupport {
    public static IEnumerable<CollectedLoadedFamilyRecord> ApplyFilter(
        IEnumerable<CollectedLoadedFamilyRecord> families,
        LoadedFamiliesFilter? filter
    ) {
        if (filter == null)
            return families;

        var selectedFamilyNames = ToFilterSet(filter.FamilyNames);
        var selectedCategoryNames = ToFilterSet(filter.CategoryNames);

        return families.Where(family => MatchesFilter(family, filter, selectedFamilyNames, selectedCategoryNames));
    }

    public static CollectedLoadedFamilyRecord MapProjectFamily(ProjectLoadedFamilyRecord record) =>
        new() {
            FamilyId = record.FamilyId,
            FamilyUniqueId = record.FamilyUniqueId,
            FamilyName = record.FamilyName,
            CategoryName = record.CategoryName,
            PlacedInstanceCount = record.PlacedInstanceCount,
            Types = record.Types
                .Select(type => new CollectedLoadedFamilyTypeRecord(type.TypeName))
                .OrderBy(type => type.TypeName, StringComparer.Ordinal)
                .ToList(),
            Parameters = record.Parameters
                .Select(parameter => MapProjectParameter(record, parameter))
                .OrderBy(parameter => parameter.Name, StringComparer.OrdinalIgnoreCase)
                .ThenByDescending(parameter => parameter.IsInstance)
                .ToList(),
            Issues = record.Issues.Select(MapProjectIssue).ToList()
        };

    public static CollectedIssue MapProjectIssue(ProjectLoadedFamilyIssue issue) =>
        new(
            issue.Code,
            issue.Severity switch {
                ProjectLoadedFamilyIssueSeverity.Info => CollectedIssueSeverity.Info,
                ProjectLoadedFamilyIssueSeverity.Warning => CollectedIssueSeverity.Warning,
                _ => CollectedIssueSeverity.Error
            },
            issue.Message,
            issue.FamilyName,
            issue.TypeName,
            issue.ParameterName
        );

    public static RevitDataIssue ToContractIssue(CollectedIssue issue) =>
        new(
            issue.Code,
            issue.Severity switch {
                CollectedIssueSeverity.Info => RevitDataIssueSeverity.Info,
                CollectedIssueSeverity.Warning => RevitDataIssueSeverity.Warning,
                _ => RevitDataIssueSeverity.Error
            },
            issue.Message,
            issue.FamilyName,
            issue.TypeName,
            issue.ParameterName
        );

    public static FormulaState ToContractFormulaState(CollectedFormulaState formulaState) =>
        formulaState switch {
            CollectedFormulaState.None => FormulaState.None,
            CollectedFormulaState.Present => FormulaState.Present,
            CollectedFormulaState.NotApplicable => FormulaState.NotApplicable,
            _ => FormulaState.Unknown
        };

    public static ExcludedParameterReason ToContractExcludedReason(CollectedExcludedParameterReason excludedReason) =>
        excludedReason switch {
            CollectedExcludedParameterReason.UnresolvedClassification => ExcludedParameterReason
                .UnresolvedClassification,
            CollectedExcludedParameterReason.ProjectObservedBuiltIn => ExcludedParameterReason.ProjectObservedBuiltIn,
            _ => ExcludedParameterReason.UnresolvedClassification
        };

    public static LoadedFamilyParameterKind ToContractParameterKind(CollectedParameterKind kind) =>
        kind switch {
            CollectedParameterKind.FamilyParameter => LoadedFamilyParameterKind.FamilyParameter,
            CollectedParameterKind.SharedParameter => LoadedFamilyParameterKind.SharedParameter,
            CollectedParameterKind.ProjectParameter => LoadedFamilyParameterKind.ProjectParameter,
            CollectedParameterKind.ProjectSharedParameter => LoadedFamilyParameterKind.ProjectSharedParameter,
            _ => LoadedFamilyParameterKind.Unknown
        };

    public static LoadedFamilyParameterScope ToContractParameterScope(CollectedParameterScope scope) =>
        scope switch {
            CollectedParameterScope.Family => LoadedFamilyParameterScope.Family,
            CollectedParameterScope.FamilyAndProjectBinding => LoadedFamilyParameterScope.FamilyAndProjectBinding,
            CollectedParameterScope.ProjectBindingOnly => LoadedFamilyParameterScope.ProjectBindingOnly,
            _ => LoadedFamilyParameterScope.Unresolved
        };

    public static string GetParameterKey(string name, bool isInstance) =>
        $"{name}|{isInstance}";

    public static bool IsFamilyScoped(CollectedFamilyParameterRecord parameter) =>
        parameter.Kind is CollectedParameterKind.FamilyParameter or CollectedParameterKind.SharedParameter;

    public static bool IsVisibleInMatrix(CollectedFamilyParameterRecord parameter) =>
        parameter.Scope != CollectedParameterScope.Unresolved;

    private static CollectedFamilyParameterRecord MapProjectParameter(
        ProjectLoadedFamilyRecord family,
        ProjectLoadedFamilyParameter parameter
    ) {
        var dataTypeId = NormalizeForgeTypeId(parameter.DataType);
        var groupTypeId = NormalizeForgeTypeId(parameter.PropertiesGroup);
        return new CollectedFamilyParameterRecord {
            FamilyId = family.FamilyId,
            FamilyUniqueId = family.FamilyUniqueId,
            FamilyName = family.FamilyName,
            CategoryName = family.CategoryName,
            TypeNames = parameter.TypeNames.ToList(),
            Identity = parameter.Identity,
            IsInstance = parameter.IsInstance,
            StorageType = parameter.StorageType.ToString(),
            DataTypeId = dataTypeId,
            DataTypeLabel = dataTypeId == null ? null : RevitTypeLabelCatalog.GetLabelForSpec(parameter.DataType),
            GroupTypeId = groupTypeId,
            GroupTypeLabel =
                groupTypeId == null ? null : RevitTypeLabelCatalog.GetLabelForPropertyGroup(parameter.PropertiesGroup),
            Kind = CollectedParameterKind.Unknown,
            Scope = CollectedParameterScope.Unresolved,
            FormulaState = CollectedFormulaState.Unknown,
            Formula = null,
            ValuesByType = new Dictionary<string, string?>(parameter.ValuesByType, StringComparer.Ordinal),
            ExcludedReason = null
        };
    }

    private static bool MatchesFilter(
        CollectedLoadedFamilyRecord family,
        LoadedFamiliesFilter filter,
        HashSet<string> selectedFamilyNames,
        HashSet<string> selectedCategoryNames
    ) {
        if (selectedFamilyNames.Count != 0 && !selectedFamilyNames.Contains(family.FamilyName))
            return false;

        if (selectedCategoryNames.Count != 0 &&
            !selectedCategoryNames.Contains(family.CategoryName ?? string.Empty))
            return false;

        return filter.PlacementScope switch {
            LoadedFamilyPlacementScope.PlacedOnly => family.PlacedInstanceCount > 0,
            LoadedFamilyPlacementScope.UnplacedOnly => family.PlacedInstanceCount == 0,
            _ => true
        };
    }

    private static HashSet<string> ToFilterSet(IEnumerable<string>? values) =>
        values == null
            ? new HashSet<string>(StringComparer.OrdinalIgnoreCase)
            : values
                .Where(value => !string.IsNullOrWhiteSpace(value))
                .Select(value => value.Trim())
                .ToHashSet(StringComparer.OrdinalIgnoreCase);

    private static string? NormalizeForgeTypeId(ForgeTypeId forgeTypeId) =>
        string.IsNullOrWhiteSpace(forgeTypeId?.TypeId) ? null : forgeTypeId.TypeId;
}
