using Pe.Revit.DocumentData.Parameters;
using Pe.Shared.RevitData;
using Pe.Shared.RevitData.Parameters;
using Pe.Shared.RevitData.Schedules;
using ContractCombinedParameterSpec = Pe.Shared.RevitData.Schedules.CombinedParameterSpec;
using ContractScheduleFilterSpec = Pe.Shared.RevitData.Schedules.ScheduleFilterSpec;
using InternalCombinedParameterSpec = Pe.Revit.DocumentData.Schedules.Runtime.Fields.CombinedParameterSpec;
using InternalScheduleFilterSpec = Pe.Revit.DocumentData.Schedules.Runtime.Filters.ScheduleFilterSpec;

namespace Pe.Revit.DocumentData.Schedules.Collect;

internal static class ScheduleCollectorSupport {
    public static HashSet<string> ToFilterSet(IEnumerable<string>? values) =>
        values == null
            ? new HashSet<string>(StringComparer.OrdinalIgnoreCase)
            : values
                .Where(value => !string.IsNullOrWhiteSpace(value))
                .Select(value => value.Trim())
                .ToHashSet(StringComparer.OrdinalIgnoreCase);

    public static string? GetCategoryName(Document doc, ViewSchedule schedule) =>
        Category.GetCategory(doc, schedule.Definition.CategoryId)?.Name;

    public static List<ScheduleCatalogSheetPlacement> CollectSheetPlacements(Document doc, ViewSchedule schedule) =>
        schedule.GetScheduleInstances(-1)
            .Select(instanceId => doc.GetElement(instanceId))
            .Where(instance => instance?.OwnerViewId != null && instance.OwnerViewId != ElementId.InvalidElementId)
            .Select(instance => doc.GetElement(instance!.OwnerViewId) as ViewSheet)
            .Where(sheet => sheet != null)
            .Cast<ViewSheet>()
            .GroupBy(sheet => sheet.Id.Value())
            .Select(group => group.First())
            .OrderBy(sheet => sheet.SheetNumber, StringComparer.OrdinalIgnoreCase)
            .ThenBy(sheet => sheet.Name, StringComparer.OrdinalIgnoreCase)
            .Select(sheet => new ScheduleCatalogSheetPlacement(sheet.SheetNumber, sheet.Name))
            .ToList();

    public static List<ScheduleCatalogCustomParameterValue> CollectCustomParameters(ViewSchedule schedule) =>
        schedule.Parameters
            .Cast<Parameter>()
            .Where(parameter => parameter.Definition != null)
            .Where(IsNonBuiltInParameter)
            .OrderBy(parameter => parameter.Definition.Name, StringComparer.OrdinalIgnoreCase)
            .Select(parameter => new ScheduleCatalogCustomParameterValue(
                parameter.Definition.Name,
                NullIfWhiteSpace(parameter.AsString()) ?? NullIfWhiteSpace(parameter.AsValueString()),
                NullIfWhiteSpace(parameter.AsValueString()) ?? NullIfWhiteSpace(parameter.AsString()),
                ToRequestedParameterStorageType(parameter.StorageType)
            ))
            .ToList();

    public static bool MatchesCustomParameterFilters(
        ViewSchedule schedule,
        IEnumerable<ScheduleCustomParameterFilter>? filters
    ) {
        var requestedFilters = filters?
            .Where(filter => !string.IsNullOrWhiteSpace(filter.ParameterName))
            .ToList() ?? [];
        if (requestedFilters.Count == 0)
            return true;

        var customParameters = CollectCustomParameters(schedule);
        foreach (var filter in requestedFilters) {
            var matchedParameter = customParameters
                .FirstOrDefault(parameter =>
                    string.Equals(parameter.Name, filter.ParameterName, StringComparison.OrdinalIgnoreCase));
            if (matchedParameter == null)
                return false;

            if (!MatchesCustomParameterFilter(matchedParameter, filter))
                return false;
        }

        return true;
    }

    public static List<ScheduleFilterSpec> ToContractFilters(IEnumerable<InternalScheduleFilterSpec> filters) =>
        filters
            .Select(ToContractFilter)
            .ToList();

    public static List<ScheduleParameterUsageEntry> CollectParameterUsages(
        Document doc,
        ViewSchedule schedule
    ) {
        var usages = new List<ScheduleParameterUsageEntry>();
        var definition = schedule.Definition;

        for (var i = 0; i < definition.GetFieldCount(); i++) {
            var field = definition.GetField(i);
            usages.AddRange(CollectFieldUsages(doc, field));
        }

        return usages;
    }

    public static RevitDataIssue Warning(string code, string message, string? elementName = null) =>
        new(code, RevitDataIssueSeverity.Warning, message, TypeName: elementName);

    public static string? NullIfWhiteSpace(string? value) =>
        string.IsNullOrWhiteSpace(value) ? null : value;

    public static T? SafeGet<T>(Func<T> func) {
        try {
            return func();
        } catch {
            return default;
        }
    }

    public static View? GetViewTemplate(ViewSchedule schedule) {
        var templateId = schedule.ViewTemplateId;
        return templateId == ElementId.InvalidElementId
            ? null
            : schedule.Document.GetElement(templateId) as View;
    }

    public static string BuildFieldKey(
        Document doc,
        ScheduleField field,
        string fallbackName
    ) {
        if (field.IsCombinedParameterField)
            return $"combined:{fallbackName}";

        if (!field.HasSchedulableField)
            return $"field:{fallbackName}";

        var schedulableField = field.GetSchedulableField();
        return ParameterIdentityEngine.GetParameterKey(doc, schedulableField.ParameterId, fallbackName);
    }

    private static bool MatchesCustomParameterFilter(
        ScheduleCatalogCustomParameterValue parameter,
        ScheduleCustomParameterFilter filter
    ) {
        var actualValue = NullIfWhiteSpace(parameter.DisplayValue) ?? NullIfWhiteSpace(parameter.Value);
        var expectedValue = NullIfWhiteSpace(filter.ExpectedValue);
        return filter.MatchKind switch {
            ScheduleCustomParameterMatchKind.Equals => string.Equals(
                actualValue,
                expectedValue,
                StringComparison.OrdinalIgnoreCase
            ),
            _ => false
        };
    }

    private static IEnumerable<ScheduleParameterUsageEntry> CollectFieldUsages(
        Document doc,
        ScheduleField field
    ) {
        var columnHeading = field.ColumnHeading ?? string.Empty;
        var fieldName = field.GetName();

        if (field.IsCombinedParameterField) {
            foreach (var combinedParameter in field.GetCombinedParameters()) {
                yield return new ScheduleParameterUsageEntry(
                    fieldName,
                    columnHeading,
                    ParameterIdentityEngine.GetParameterKey(doc, combinedParameter.ParamId, fieldName)
                );
            }

            yield break;
        }

        if (!field.HasSchedulableField)
            yield break;

        var schedulableField = field.GetSchedulableField();
        yield return new ScheduleParameterUsageEntry(
            fieldName,
            columnHeading,
            ParameterIdentityEngine.GetParameterKey(doc, schedulableField.ParameterId, fieldName)
        );
    }

    private static ContractCombinedParameterSpec ToContractCombinedParameter(InternalCombinedParameterSpec spec) =>
        new(
            spec.ParameterName,
            spec.Prefix,
            spec.Suffix,
            spec.Separator
        );

    private static ContractScheduleFilterSpec ToContractFilter(InternalScheduleFilterSpec spec) =>
        new(
            spec.FieldName,
            spec.FilterType.ToString(),
            spec.Value
        );

    private static bool IsNonBuiltInParameter(Parameter parameter) =>
        RevitParameterIdentityFactory.FromParameter(parameter).Kind != RevitParameterIdentityKind.BuiltInParameter;

    private static RequestedParameterStorageType ToRequestedParameterStorageType(StorageType storageType) =>
        storageType switch {
            StorageType.String => RequestedParameterStorageType.String,
            StorageType.Integer => RequestedParameterStorageType.Integer,
            StorageType.Double => RequestedParameterStorageType.Double,
            StorageType.ElementId => RequestedParameterStorageType.ElementId,
            _ => RequestedParameterStorageType.None
        };
}

