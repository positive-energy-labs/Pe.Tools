using Pe.Revit.Global.Revit.Lib.Parameters;
using Pe.Shared.HostContracts.RevitData;
using Pe.Shared.RevitData.Parameters;
using ContractCombinedParameterSpec = Pe.Shared.HostContracts.RevitData.CombinedParameterSpec;
using ContractScheduleFieldFormatSpec = Pe.Shared.HostContracts.RevitData.ScheduleFieldFormatSpec;
using ContractScheduleFieldSpec = Pe.Shared.HostContracts.RevitData.ScheduleFieldSpec;
using ContractScheduleFilterSpec = Pe.Shared.HostContracts.RevitData.ScheduleFilterSpec;
using ContractScheduleSortGroupSpec = Pe.Shared.HostContracts.RevitData.ScheduleSortGroupSpec;
using ContractScheduleProfile = Pe.Shared.HostContracts.RevitData.ScheduleProfile;
using ContractScheduleTitleBorderSpec = Pe.Shared.HostContracts.RevitData.ScheduleTitleBorderSpec;
using ContractScheduleTitleStyleSpec = Pe.Shared.HostContracts.RevitData.ScheduleTitleStyleSpec;
using InternalCombinedParameterSpec = Pe.Revit.Global.Revit.Lib.Schedules.Fields.CombinedParameterSpec;
using InternalScheduleFieldFormatSpec = Pe.Revit.Global.Revit.Lib.Schedules.Fields.ScheduleFieldFormatSpec;
using InternalScheduleFieldSpec = Pe.Revit.Global.Revit.Lib.Schedules.Fields.ScheduleFieldSpec;
using InternalScheduleFilterSpec = Pe.Revit.Global.Revit.Lib.Schedules.Filters.ScheduleFilterSpec;
using InternalScheduleProfile = Pe.Revit.Global.Revit.Lib.Schedules.ScheduleProfile;
using InternalScheduleSortGroupSpec = Pe.Revit.Global.Revit.Lib.Schedules.SortGroup.ScheduleSortGroupSpec;
using InternalScheduleTitleStyleSpec = Pe.Revit.Global.Revit.Lib.Schedules.TitleStyle.ScheduleTitleStyleSpec;

namespace Pe.Revit.Global.Revit.Lib.Schedules;

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

    public static List<string> CollectFieldParameterNames(InternalScheduleProfile profile) {
        var orderedNames = new List<string>();
        var seen = new HashSet<string>(StringComparer.OrdinalIgnoreCase);

        foreach (var field in profile.Fields) {
            if (field.CombinedParameters is { Count: > 0 }) {
                foreach (var combinedParameter in field.CombinedParameters) {
                    AddName(combinedParameter.ParameterName);
                }

                continue;
            }

            if (field.CalculatedType.HasValue)
                continue;

            AddName(field.ParameterName);
        }

        return orderedNames;

        void AddName(string? parameterName) {
            if (string.IsNullOrWhiteSpace(parameterName))
                return;

            var trimmed = parameterName.Trim();
            if (seen.Add(trimmed))
                orderedNames.Add(trimmed);
        }
    }

    public static List<ContractScheduleFilterSpec> ToContractFilters(IEnumerable<InternalScheduleFilterSpec> filters) =>
        filters
            .Select(ToContractFilter)
            .ToList();

    public static ContractScheduleProfile ToContractProfile(InternalScheduleProfile profile) =>
        new(
            profile.Name,
            profile.CategoryName.ToString(),
            profile.ViewTemplateName,
            ToContractTitleStyle(profile.TitleStyle),
            profile.IsItemized,
            profile.FilterBySheet,
            profile.Fields.Select(ToContractField).ToList(),
            profile.SortGroup.Select(ToContractSortGroup).ToList(),
            profile.Filters.Select(ToContractFilter).ToList(),
            profile.OnFinishSettings == null ? null : new ScheduleOnFinishSettings(profile.OnFinishSettings.OpenScheduleOnFinish)
        );

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

    private static IEnumerable<ScheduleParameterUsageEntry> CollectFieldUsages(
        Document doc,
        Autodesk.Revit.DB.ScheduleField field
    ) {
        var columnHeading = field.ColumnHeading ?? string.Empty;
        var fieldName = field.GetName();

        if (field.IsCombinedParameterField) {
            foreach (var combinedParameter in field.GetCombinedParameters()) {
                yield return new ScheduleParameterUsageEntry(
                    fieldName,
                    columnHeading,
                    field.IsHidden,
                    ScheduleParameterUsageKind.CombinedComponent,
                    ParameterIdentityEngine.FromParameterId(doc, combinedParameter.ParamId, fieldName)
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
            field.IsHidden,
            ScheduleParameterUsageKind.Field,
            ParameterIdentityEngine.FromParameterId(doc, schedulableField.ParameterId, fieldName)
        );
    }

    private static ContractScheduleTitleStyleSpec ToContractTitleStyle(InternalScheduleTitleStyleSpec spec) =>
        new(
            spec.HorizontalAlignment.ToString(),
            new ContractScheduleTitleBorderSpec(
                spec.BorderStyle.TopLineStyleName,
                spec.BorderStyle.BottomLineStyleName,
                spec.BorderStyle.LeftLineStyleName,
                spec.BorderStyle.RightLineStyleName
            )
        );

    private static ContractScheduleFieldSpec ToContractField(InternalScheduleFieldSpec spec) =>
        new(
            spec.ParameterName,
            spec.ColumnHeaderOverride,
            spec.HeaderGroup,
            spec.IsHidden,
            spec.DisplayType.ToString(),
            spec.ColumnWidth,
            spec.HorizontalAlignment.ToString(),
            spec.CalculatedType?.ToString(),
            spec.PercentageOfField,
            spec.FormatOptions == null ? null : ToContractFieldFormat(spec.FormatOptions),
            spec.CombinedParameters?.Select(ToContractCombinedParameter).ToList()
        );

    private static ContractScheduleFieldFormatSpec ToContractFieldFormat(InternalScheduleFieldFormatSpec spec) =>
        new(
            spec.UnitTypeId,
            spec.SymbolTypeId,
            spec.Accuracy,
            spec.SuppressTrailingZeros,
            spec.SuppressLeadingZeros,
            spec.UsePlusPrefix,
            spec.UseDigitGrouping,
            spec.SuppressSpaces
        );

    private static ContractCombinedParameterSpec ToContractCombinedParameter(InternalCombinedParameterSpec spec) =>
        new(
            spec.ParameterName,
            spec.Prefix,
            spec.Suffix,
            spec.Separator
        );

    private static ContractScheduleSortGroupSpec ToContractSortGroup(InternalScheduleSortGroupSpec spec) =>
        new(
            spec.FieldName,
            spec.SortOrder.ToString(),
            spec.ShowHeader,
            spec.ShowFooter,
            spec.ShowBlankLine
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
