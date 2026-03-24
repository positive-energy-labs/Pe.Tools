using Pe.Global.Revit.Lib.Parameters;
using Pe.Global.Revit.Lib.Families.LoadedFamilies.Models;
using Pe.Host.Contracts;

namespace Pe.Global.Revit.Lib.Families.LoadedFamilies.Collectors;

public static class LoadedFamiliesMatrixCollector {
    public static LoadedFamiliesMatrixData Collect(
        Document doc,
        LoadedFamiliesFilter? filter = null,
        Action<string, TimeSpan>? onFamilyCollected = null
    ) {
        var catalogFamilies = LoadedFamiliesCatalogCollector.CollectCanonical(doc, filter);
        var projectValueFamilies = LoadedFamiliesProjectValueCollector.Collect(doc, catalogFamilies, onFamilyCollected);
        var supplementedFamilies = LoadedFamiliesFormulaCollector.Supplement(doc, projectValueFamilies);
        var scheduleFamilies = LoadedFamiliesScheduleCollector.Supplement(doc, supplementedFamilies);

        return new LoadedFamiliesMatrixData(
            scheduleFamilies.Select(ToMatrixFamily).ToList(),
            scheduleFamilies.SelectMany(family => family.Issues)
                .Select(LoadedFamiliesCollectorSupport.ToContractIssue)
                .Distinct()
                .ToList()
        );
    }

    private static LoadedFamilyMatrixFamily ToMatrixFamily(CollectedLoadedFamilyRecord family) =>
        new(
            family.FamilyId,
            family.FamilyUniqueId,
            family.FamilyName,
            family.CategoryName,
            family.PlacedInstanceCount,
            family.Types.Select(type => new LoadedFamilyTypeEntry(type.TypeName)).ToList(),
            family.ScheduleNames.ToList(),
            family.Parameters
                .Where(LoadedFamiliesCollectorSupport.IsVisibleInMatrix)
                .Select(ToVisibleParameter)
                .OrderBy(parameter => parameter.Identity.Name, StringComparer.OrdinalIgnoreCase)
                .ThenByDescending(parameter => parameter.IsInstance)
                .ToList(),
            family.Parameters
                .Where(parameter => parameter.ExcludedReason != null)
                .Select(ToExcludedParameter)
                .OrderBy(parameter => parameter.Identity.Name, StringComparer.OrdinalIgnoreCase)
                .ThenByDescending(parameter => parameter.IsInstance)
                .ToList(),
            family.Issues.Select(LoadedFamiliesCollectorSupport.ToContractIssue).ToList()
        );

    private static LoadedFamilyVisibleParameterEntry ToVisibleParameter(CollectedFamilyParameterRecord parameter) =>
        new(
            ParameterIdentityEngine.FromCanonical(parameter.Identity),
            parameter.IsInstance,
            LoadedFamiliesCollectorSupport.ToContractParameterKind(parameter.Kind),
            LoadedFamiliesCollectorSupport.ToContractParameterScope(parameter.Scope),
            parameter.StorageType,
            parameter.DataTypeId,
            parameter.DataTypeLabel,
            parameter.GroupTypeId,
            parameter.GroupTypeLabel,
            LoadedFamiliesCollectorSupport.ToContractFormulaState(parameter.FormulaState),
            parameter.Formula,
            new Dictionary<string, string?>(parameter.ValuesByType, StringComparer.Ordinal)
        );

    private static LoadedFamilyExcludedParameterEntry ToExcludedParameter(CollectedFamilyParameterRecord parameter) =>
        new(
            ParameterIdentityEngine.FromCanonical(parameter.Identity),
            parameter.IsInstance,
            LoadedFamiliesCollectorSupport.ToContractParameterKind(parameter.Kind),
            LoadedFamiliesCollectorSupport.ToContractParameterScope(parameter.Scope),
            LoadedFamiliesCollectorSupport.ToContractExcludedReason(
                parameter.ExcludedReason ?? CollectedExcludedParameterReason.UnresolvedClassification
            ),
            LoadedFamiliesCollectorSupport.ToContractFormulaState(parameter.FormulaState),
            parameter.Formula
        );
}
