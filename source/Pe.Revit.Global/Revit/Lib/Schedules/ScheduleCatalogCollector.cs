using Pe.Global.Revit.Lib.Parameters;
using Pe.Global.Revit.Lib.Schedules.Fields;
using Pe.Global.Revit.Lib.Schedules.Filters;
using Pe.Global.Revit.Lib.Schedules.SortGroup;
using Pe.Global.Revit.Lib.Schedules.TitleStyle;
using Pe.Host.Contracts.RevitData;
using ContractScheduleDefinition = Pe.Host.Contracts.RevitData.ScheduleDefinition;

namespace Pe.Global.Revit.Lib.Schedules;

public static class ScheduleCatalogCollector {
    public static ScheduleCatalogData Collect(
        Document doc,
        ScheduleCatalogRequest? request = null
    ) {
        var categoryNames = ToFilterSet(request?.CategoryNames);
        var scheduleNames = ToFilterSet(request?.ScheduleNames);
        var includeTemplates = request?.IncludeTemplates ?? false;
        var issues = new List<RevitDataIssue>();

        var entries = new FilteredElementCollector(doc)
            .OfClass(typeof(ViewSchedule))
            .Cast<ViewSchedule>()
            .Where(schedule => includeTemplates || !schedule.IsTemplate)
            .Where(schedule => !schedule.Name.Contains("<Revision Schedule>", StringComparison.OrdinalIgnoreCase))
            .Where(schedule => MatchesFilter(schedule, categoryNames, scheduleNames))
            .OrderBy(schedule => schedule.Name, StringComparer.OrdinalIgnoreCase)
            .Select(schedule => TryCollectEntry(doc, schedule, issues))
            .Where(entry => entry != null)
            .Cast<ScheduleCatalogEntry>()
            .ToList();

        return new ScheduleCatalogData(entries, issues);
    }

    private static ScheduleCatalogEntry? TryCollectEntry(
        Document doc,
        ViewSchedule schedule,
        List<RevitDataIssue> issues
    ) {
        try {
            var spec = ScheduleHelper.SerializeSchedule(schedule);

            return new ScheduleCatalogEntry(
                schedule.Id.Value(),
                schedule.UniqueId,
                schedule.Name,
                Category.GetCategory(doc, schedule.Definition.CategoryId)?.Name,
                schedule.IsTemplate,
                ToContractDefinition(spec),
                CollectParameterUsages(doc, schedule)
            );
        } catch (Exception ex) {
            issues.Add(new RevitDataIssue(
                "ScheduleCatalogSerializationFailed",
                RevitDataIssueSeverity.Warning,
                ex.Message,
                TypeName: schedule.Name
            ));
            return null;
        }
    }

    private static ContractScheduleDefinition ToContractDefinition(ScheduleSpec spec) =>
        new(
            spec.Name,
            spec.CategoryName.ToString(),
            spec.ViewTemplateName,
            ToContractTitleStyle(spec.TitleStyle),
            spec.IsItemized,
            spec.FilterBySheet,
            spec.Fields.Select(ToContractField).ToList(),
            spec.SortGroup.Select(ToContractSortGroup).ToList(),
            spec.Filters.Select(ToContractFilter).ToList(),
            spec.OnFinishSettings == null ? null : new ScheduleOnFinishSettings(spec.OnFinishSettings.OpenScheduleOnFinish)
        );

    private static ScheduleTitleStyleDefinition ToContractTitleStyle(ScheduleTitleStyleSpec spec) =>
        new(
            spec.HorizontalAlignment.ToString(),
            new ScheduleTitleBorderStyleDefinition(
                spec.BorderStyle.TopLineStyleName,
                spec.BorderStyle.BottomLineStyleName,
                spec.BorderStyle.LeftLineStyleName,
                spec.BorderStyle.RightLineStyleName
            )
        );

    private static ScheduleFieldDefinition ToContractField(ScheduleFieldSpec spec) =>
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

    private static ScheduleFieldFormatDefinition ToContractFieldFormat(ScheduleFieldFormatSpec spec) =>
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

    private static CombinedParameterDefinition ToContractCombinedParameter(CombinedParameterSpec spec) =>
        new(
            spec.ParameterName,
            spec.Prefix,
            spec.Suffix,
            spec.Separator
        );

    private static ScheduleSortGroupDefinition ToContractSortGroup(ScheduleSortGroupSpec spec) =>
        new(
            spec.FieldName,
            spec.SortOrder.ToString(),
            spec.ShowHeader,
            spec.ShowFooter,
            spec.ShowBlankLine
        );

    private static ScheduleFilterDefinition ToContractFilter(ScheduleFilterSpec spec) =>
        new(
            spec.FieldName,
            spec.FilterType.ToString(),
            spec.Value
        );

    private static List<ScheduleParameterUsageEntry> CollectParameterUsages(
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

    private static bool MatchesFilter(
        ViewSchedule schedule,
        HashSet<string> categoryNames,
        HashSet<string> scheduleNames
    ) {
        if (scheduleNames.Count != 0 && !scheduleNames.Contains(schedule.Name))
            return false;

        if (categoryNames.Count == 0)
            return true;

        var categoryName = Category.GetCategory(schedule.Document, schedule.Definition.CategoryId)?.Name;
        return !string.IsNullOrWhiteSpace(categoryName) && categoryNames.Contains(categoryName);
    }

    private static HashSet<string> ToFilterSet(IEnumerable<string>? values) =>
        values == null
            ? new HashSet<string>(StringComparer.OrdinalIgnoreCase)
            : values
                .Where(value => !string.IsNullOrWhiteSpace(value))
                .Select(value => value.Trim())
                .ToHashSet(StringComparer.OrdinalIgnoreCase);
}
