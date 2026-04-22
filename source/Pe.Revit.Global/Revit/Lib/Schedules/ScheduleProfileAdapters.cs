using Pe.Revit.Global.Revit.Lib.Schedules.TitleStyle;
using Pe.Revit.SettingsRuntime.Core.Json.SchemaProviders;
using Pe.Shared.RevitData.Schedules;
using ContractCombinedParameterSpec = Pe.Shared.RevitData.Schedules.CombinedParameterSpec;
using ContractScheduleFieldFormatSpec = Pe.Shared.RevitData.Schedules.ScheduleFieldFormatSpec;
using ContractScheduleFieldSpec = Pe.Shared.RevitData.Schedules.ScheduleFieldSpec;
using ContractScheduleFilterSpec = Pe.Shared.RevitData.Schedules.ScheduleFilterSpec;
using ContractScheduleProfile = Pe.Shared.RevitData.Schedules.ScheduleProfile;
using ContractScheduleSortGroupSpec = Pe.Shared.RevitData.Schedules.ScheduleSortGroupSpec;
using ContractScheduleTitleBorderSpec = Pe.Shared.RevitData.Schedules.ScheduleTitleBorderSpec;
using ContractScheduleTitleStyleSpec = Pe.Shared.RevitData.Schedules.ScheduleTitleStyleSpec;
using InternalCombinedParameterSpec = Pe.Revit.Global.Revit.Lib.Schedules.Fields.CombinedParameterSpec;
using InternalScheduleFieldFormatSpec = Pe.Revit.Global.Revit.Lib.Schedules.Fields.ScheduleFieldFormatSpec;
using InternalScheduleFieldSpec = Pe.Revit.Global.Revit.Lib.Schedules.Fields.ScheduleFieldSpec;
using InternalScheduleFilterSpec = Pe.Revit.Global.Revit.Lib.Schedules.Filters.ScheduleFilterSpec;
using InternalScheduleSortGroupSpec = Pe.Revit.Global.Revit.Lib.Schedules.SortGroup.ScheduleSortGroupSpec;
using InternalScheduleTitleStyleSpec = Pe.Revit.Global.Revit.Lib.Schedules.TitleStyle.ScheduleTitleStyleSpec;

namespace Pe.Revit.Global.Revit.Lib.Schedules;

internal static class ScheduleProfileAdapters {
    public static ScheduleProfile ToRuntimeProfile(this ContractScheduleProfile profile) =>
        new() {
            Name = profile.Name,
            CategoryName = ParseBuiltInCategory(profile.CategoryName),
            ViewTemplateName = profile.ViewTemplateName,
            TitleStyle = new InternalScheduleTitleStyleSpec {
                HorizontalAlignment = ParseEnum<TitleHorizontalAlignment>(profile.TitleStyle.HorizontalAlignment),
                BorderStyle =
                    new TitleBorderStyleSpec {
                        TopLineStyleName = profile.TitleStyle.BorderStyle.TopLineStyleName,
                        BottomLineStyleName = profile.TitleStyle.BorderStyle.BottomLineStyleName,
                        LeftLineStyleName = profile.TitleStyle.BorderStyle.LeftLineStyleName,
                        RightLineStyleName = profile.TitleStyle.BorderStyle.RightLineStyleName
                    }
            },
            IsItemized = profile.IsItemized,
            FilterBySheet = profile.FilterBySheet,
            Fields = profile.Fields.Select(ToRuntimeField).ToList(),
            SortGroup = profile.SortGroup.Select(ToRuntimeSortGroup).ToList(),
            Filters = profile.Filters.Select(ToRuntimeFilter).ToList(),
            OnFinishSettings = profile.OnFinishSettings == null
                ? null
                : new OnFinishSettings { OpenScheduleOnFinish = profile.OnFinishSettings.OpenScheduleOnFinish }
        };

    public static ContractScheduleProfile ToAuthoredProfile(this ScheduleProfile profile) =>
        new(
            profile.Name,
            profile.CategoryName.ToString(),
            profile.ViewTemplateName,
            ToAuthoredTitleStyle(profile.TitleStyle),
            profile.IsItemized,
            profile.FilterBySheet,
            profile.Fields.Select(ToAuthoredField).ToList(),
            profile.SortGroup.Select(ToAuthoredSortGroup).ToList(),
            profile.Filters.Select(ToAuthoredFilter).ToList(),
            profile.OnFinishSettings == null
                ? null
                : new ScheduleOnFinishSettings(profile.OnFinishSettings.OpenScheduleOnFinish)
        );

    private static InternalScheduleFieldSpec ToRuntimeField(ContractScheduleFieldSpec spec) =>
        new() {
            ParameterName = spec.ParameterName,
            ColumnHeaderOverride = spec.ColumnHeaderOverride,
            HeaderGroup = spec.HeaderGroup,
            IsHidden = spec.IsHidden,
            DisplayType = ParseEnum<ScheduleFieldDisplayType>(spec.DisplayType),
            ColumnWidth = spec.ColumnWidth,
            HorizontalAlignment = ParseEnum<ScheduleHorizontalAlignment>(spec.HorizontalAlignment),
            CalculatedType = string.IsNullOrWhiteSpace(spec.CalculatedType)
                ? null
                : ParseEnum<CalculatedFieldType>(spec.CalculatedType),
            PercentageOfField = spec.PercentageOfField,
            FormatOptions = spec.FormatOptions == null
                ? null
                : new InternalScheduleFieldFormatSpec {
                    UnitTypeId = spec.FormatOptions.UnitTypeId,
                    SymbolTypeId = spec.FormatOptions.SymbolTypeId,
                    Accuracy = spec.FormatOptions.Accuracy,
                    SuppressTrailingZeros = spec.FormatOptions.SuppressTrailingZeros,
                    SuppressLeadingZeros = spec.FormatOptions.SuppressLeadingZeros,
                    UsePlusPrefix = spec.FormatOptions.UsePlusPrefix,
                    UseDigitGrouping = spec.FormatOptions.UseDigitGrouping,
                    SuppressSpaces = spec.FormatOptions.SuppressSpaces
                },
            CombinedParameters = spec.CombinedParameters?.Select(item => new InternalCombinedParameterSpec {
                ParameterName = item.ParameterName,
                Prefix = item.Prefix,
                Suffix = item.Suffix,
                Separator = item.Separator
            }).ToList()
        };

    private static InternalScheduleSortGroupSpec ToRuntimeSortGroup(ContractScheduleSortGroupSpec spec) =>
        new() {
            FieldName = spec.FieldName,
            SortOrder = ParseEnum<ScheduleSortOrder>(spec.SortOrder),
            ShowHeader = spec.ShowHeader,
            ShowFooter = spec.ShowFooter,
            ShowBlankLine = spec.ShowBlankLine
        };

    private static InternalScheduleFilterSpec ToRuntimeFilter(ContractScheduleFilterSpec spec) =>
        new() {
            FieldName = spec.FieldName, FilterType = ParseEnum<ScheduleFilterType>(spec.FilterType), Value = spec.Value
        };

    private static ContractScheduleTitleStyleSpec ToAuthoredTitleStyle(InternalScheduleTitleStyleSpec spec) =>
        new(
            spec.HorizontalAlignment.ToString(),
            new ContractScheduleTitleBorderSpec(
                spec.BorderStyle.TopLineStyleName,
                spec.BorderStyle.BottomLineStyleName,
                spec.BorderStyle.LeftLineStyleName,
                spec.BorderStyle.RightLineStyleName
            )
        );

    private static ContractScheduleFieldSpec ToAuthoredField(InternalScheduleFieldSpec spec) =>
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
            spec.FormatOptions == null ? null : ToAuthoredFieldFormat(spec.FormatOptions),
            spec.CombinedParameters?.Select(ToAuthoredCombinedParameter).ToList()
        );

    private static ContractScheduleFieldFormatSpec ToAuthoredFieldFormat(InternalScheduleFieldFormatSpec spec) =>
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

    private static ContractCombinedParameterSpec ToAuthoredCombinedParameter(InternalCombinedParameterSpec spec) =>
        new(
            spec.ParameterName,
            spec.Prefix,
            spec.Suffix,
            spec.Separator
        );

    private static ContractScheduleSortGroupSpec ToAuthoredSortGroup(InternalScheduleSortGroupSpec spec) =>
        new(
            spec.FieldName,
            spec.SortOrder.ToString(),
            spec.ShowHeader,
            spec.ShowFooter,
            spec.ShowBlankLine
        );

    private static ContractScheduleFilterSpec ToAuthoredFilter(InternalScheduleFilterSpec spec) =>
        new(
            spec.FieldName,
            spec.FilterType.ToString(),
            spec.Value
        );

    private static TEnum ParseEnum<TEnum>(string? value) where TEnum : struct, Enum =>
        Enum.TryParse<TEnum>(value, true, out var parsed)
            ? parsed
            : default;

    private static BuiltInCategory ParseBuiltInCategory(string? categoryName) {
        if (string.IsNullOrWhiteSpace(categoryName))
            return BuiltInCategory.INVALID;

        if (CategoryNamesProvider.GetLabelToBuiltInCategoryMap().TryGetValue(categoryName, out var builtInCategory))
            return builtInCategory;

        return Enum.TryParse<BuiltInCategory>(categoryName, true, out var parsed)
            ? parsed
            : BuiltInCategory.INVALID;
    }
}