using Pe.Revit.DocumentData.Parameters;
using Pe.Revit.DocumentData.Schedules.Authored.ValueDomains;
using Pe.Revit.DocumentData.Schedules.Runtime;
using Pe.Shared.RevitData.Schedules;

namespace Pe.Revit.DocumentData.Schedules.Authored;

internal static class AuthoredScheduleSpecApplication {
    public static (AppliedFieldInfo? Applied, string? Skipped, List<string> Warnings) ApplyTo(
        this ScheduleFieldSpec spec,
        ViewSchedule schedule,
        ScheduleDefinition def,
        Func<ScheduleDefinition, Document, ParameterReference, SchedulableField?> findSchedulableField,
        Func<ScheduleDefinition, Document, ParameterReference, ElementId?> findParameterId) {
        var warnings = new List<string>();

        if (spec.CalculatedType.HasValue)
            return (null, null, warnings);

        ScheduleField? field;
        if (spec.CombinedParameters is { Count: > 0 }) {
            var (combinedField, skipped, combinedWarnings) = spec.ApplyCombinedField(
                schedule,
                def,
                findParameterId);
            field = combinedField;
            warnings.AddRange(combinedWarnings);
            if (skipped != null)
                return (null, skipped, warnings);
        } else {
            var parameter = spec.GetEffectiveParameter();
            var parameterLabel = parameter.GetDisplayLabel();
            var schedulableField = findSchedulableField(def, schedule.Document, parameter);
            if (schedulableField is null)
                return (null, $"Parameter '{parameterLabel}' not found", warnings);

            field = def.AddField(schedulableField);
        }

        var fieldLabel = field?.GetName() ?? spec.GetEffectiveParameter().GetDisplayLabel();
        if (field == null)
            return (null, $"Field '{fieldLabel}' could not be created", warnings);

        var propertyWarnings = spec.ApplyProperties(field);
        warnings.AddRange(propertyWarnings);

        var displayType = spec.DisplayType.ToRevit();
        var horizontalAlignment = spec.HorizontalAlignment.ToRevit();
        var applied = new AppliedFieldInfo {
            ParameterName = fieldLabel,
            ColumnHeaderOverride = spec.ColumnHeaderOverride ?? string.Empty,
            IsHidden = spec.IsHidden,
            ColumnWidth = spec.ColumnWidth,
            DisplayType = displayType,
            HorizontalAlignment = horizontalAlignment
        };

        return (applied, null, warnings);
    }

    public static CalculatedFieldGuidance? GetCalculatedFieldGuidance(this ScheduleFieldSpec spec) {
        if (!spec.CalculatedType.HasValue)
            return null;

        var guidance = new CalculatedFieldGuidance {
            FieldName = spec.GetEffectiveParameter().GetDisplayLabel(),
            CalculatedType = spec.CalculatedType.ToString() ?? string.Empty
        };

        return spec.CalculatedType switch {
            ScheduleAuthoredCalculatedFieldType.Formula => guidance with {
                Guidance = "Add a calculated field of type 'Formula' in the schedule. " +
                           "The formula must be entered manually in Revit (API limitation)."
            },
            ScheduleAuthoredCalculatedFieldType.Percentage => guidance with {
                Guidance =
                $"Add a calculated field of type 'Percentage' based on field '{spec.PercentageOfField ?? "(unknown)"}'.",
                PercentageOfField = spec.PercentageOfField
            },
            _ => guidance
        };
    }

    public static (AppliedSortGroupInfo? Applied, string? Skipped) ApplyTo(
        this ScheduleSortGroupSpec spec,
        ScheduleDefinition def) {
        ScheduleFieldId? fieldId = null;
        for (var i = 0; i < def.GetFieldCount(); i++) {
            var field = def.GetField(i);
            if (field.GetName() == spec.FieldName) {
                fieldId = field.FieldId;
                break;
            }
        }

        if (fieldId == null)
            return (null, $"Field '{spec.FieldName}' not found");

        var sortOrder = spec.SortOrder.ToRevit();
        var showHeader = spec.ShowHeader;
        var showFooter = spec.ShowFooter;
        var showBlankLine = spec.ShowBlankLine;
        var sortGroupField = new ScheduleSortGroupField(fieldId, sortOrder) {
            ShowHeader = showHeader,
            ShowFooter = showFooter,
            ShowBlankLine = showBlankLine
        };

        def.AddSortGroupField(sortGroupField);

        var applied = new AppliedSortGroupInfo {
            FieldName = spec.FieldName,
            SortOrder = sortOrder,
            ShowHeader = showHeader,
            ShowFooter = showFooter,
            ShowBlankLine = showBlankLine
        };

        return (applied, null);
    }

    public static (AppliedFilterInfo? Applied, string? Skipped, string? Warning) ApplyTo(
        this ScheduleFilterSpec spec,
        ScheduleDefinition def) {
        ScheduleField? field = null;
        for (var i = 0; i < def.GetFieldCount(); i++) {
            var f = def.GetField(i);
            if (f.GetName() == spec.FieldName) {
                field = f;
                break;
            }
        }

        if (field == null)
            return (null, $"Field '{spec.FieldName}' not found", null);

        try {
            var filterType = spec.FilterType.ToRevit();
            var value = spec.Value ?? string.Empty;
            ScheduleFilter filter;
            string storageTypeStr;

            if (string.IsNullOrEmpty(value)) {
                filter = new ScheduleFilter(field.FieldId, filterType);
                storageTypeStr = "None";
            } else {
                var specTypeId = field.GetSpecTypeId();
                var storageType = RevitParameterStorageTypeResolver.GetStorageType(specTypeId);

                if (storageType == StorageType.Integer && int.TryParse(value, out var intValue)) {
                    filter = new ScheduleFilter(field.FieldId, filterType, intValue);
                    storageTypeStr = "Integer";
                } else if (storageType == StorageType.Double &&
                           double.TryParse(value, out var doubleValue)) {
                    filter = new ScheduleFilter(field.FieldId, filterType, doubleValue);
                    storageTypeStr = "Double";
                } else if (storageType == StorageType.ElementId &&
                           int.TryParse(value, out var elementIdValue)) {
                    filter = new ScheduleFilter(field.FieldId, filterType, elementIdValue.ToElementId());
                    storageTypeStr = "ElementId";
                } else {
                    filter = new ScheduleFilter(field.FieldId, filterType, value);
                    storageTypeStr = "String";
                }
            }

            def.AddFilter(filter);

            var applied = new AppliedFilterInfo {
                FieldName = spec.FieldName,
                FilterType = filterType,
                Value = value,
                StorageType = storageTypeStr
            };

            return (applied, null, null);
        } catch (Exception ex) {
            return (null, null, $"Failed to apply filter on field '{spec.FieldName}': {ex.Message}");
        }
    }

    private static (ScheduleField? Field, string? Skipped, List<string> Warnings) ApplyCombinedField(
        this ScheduleFieldSpec spec,
        ViewSchedule schedule,
        ScheduleDefinition def,
        Func<ScheduleDefinition, Document, ParameterReference, ElementId?> findParameterId) {
        var warnings = new List<string>();

        try {
            var fieldParameterLabel = spec.GetEffectiveParameter().GetDisplayLabel();
            var combinedParamDataList = new List<TableCellCombinedParameterData>();

            foreach (var combinedSpec in spec.CombinedParameters) {
                var combinedData = TableCellCombinedParameterData.Create();
                var combinedParameter = combinedSpec.GetEffectiveParameter();
                var combinedParameterLabel = combinedParameter.GetDisplayLabel();
                var paramId = findParameterId(def, schedule.Document, combinedParameter);
                if (paramId == null || paramId == ElementId.InvalidElementId) {
                    warnings.Add(
                        $"Parameter '{combinedParameterLabel}' not found for combined field '{fieldParameterLabel}'");
                    combinedData.Dispose();
                    continue;
                }

                combinedData.ParamId = paramId;
                combinedData.Prefix = combinedSpec.Prefix ?? string.Empty;
                combinedData.Suffix = combinedSpec.Suffix ?? string.Empty;
                combinedData.Separator = combinedSpec.Separator ?? " / ";

                combinedParamDataList.Add(combinedData);
            }

            if (combinedParamDataList.Count > 0) {
                if (def.IsValidCombinedParameters(combinedParamDataList)) {
                    var field = def.InsertCombinedParameterField(
                        combinedParamDataList,
                        fieldParameterLabel,
                        def.GetFieldCount());

                    foreach (var data in combinedParamDataList)
                        data.Dispose();

                    return (field, null, warnings);
                }

                foreach (var data in combinedParamDataList)
                    data.Dispose();

                return (null, $"Combined parameter field '{fieldParameterLabel}' has invalid parameters", warnings);
            }

            return (null, $"Combined parameter field '{fieldParameterLabel}' has no valid parameters", warnings);
        } catch (Exception ex) {
            var fieldParameterLabel = spec.GetEffectiveParameter().GetDisplayLabel();
            warnings.Add($"Failed to create combined parameter field '{fieldParameterLabel}': {ex.Message}");
            return (null, $"Exception creating combined field '{fieldParameterLabel}'", warnings);
        }
    }

    private static List<string> ApplyProperties(this ScheduleFieldSpec spec, ScheduleField field) {
        var warnings = new List<string>();

        field.ApplyColumnBasics(spec.ColumnHeaderOverride, spec.IsHidden, spec.ColumnWidth);
        field.HorizontalAlignment = spec.HorizontalAlignment.ToRevit();

        var displayType = spec.DisplayType.ToRevit();
        if (displayType != ScheduleFieldDisplayType.Standard) {
            var canApply = displayType switch {
                ScheduleFieldDisplayType.Totals => field.CanTotal(),
                ScheduleFieldDisplayType.Max or ScheduleFieldDisplayType.Min or ScheduleFieldDisplayType.MinMax =>
                    field.CanDisplayMinMax(),
                _ => false
            };

            if (canApply)
                field.DisplayType = displayType;
            else
                warnings.Add($"DisplayType '{displayType}' not supported for field '{field.GetName()}'");
        }

        if (spec.FormatOptions != null) {
            var formatWarning = ApplyFormatOptions(spec.FormatOptions, field, field.GetName());
            if (formatWarning != null)
                warnings.Add(formatWarning);
        }

        return warnings;
    }

    private static string? ApplyFormatOptions(
        ScheduleFieldFormatSpec spec,
        ScheduleField field,
        string fieldName) {
        try {
            FormatOptions formatOptions;

            ForgeTypeId? unitTypeId = null;
            if (!string.IsNullOrEmpty(spec.UnitTypeId)) {
                unitTypeId = ScheduleFieldFormatValueDomain.ResolveUnit(spec.UnitTypeId);
                if (unitTypeId == null)
                    return $"UnitTypeId '{spec.UnitTypeId}' was not recognized for field '{fieldName}'.";

                formatOptions = new FormatOptions(unitTypeId);
            } else {
                formatOptions = new FormatOptions { UseDefault = false };
            }

            if (spec.Accuracy.HasValue && formatOptions.IsValidAccuracy(spec.Accuracy.Value))
                formatOptions.Accuracy = spec.Accuracy.Value;

            if (!string.IsNullOrEmpty(spec.SymbolTypeId) && formatOptions.CanHaveSymbol()) {
                var symbolTypeId = ScheduleFieldFormatValueDomain.ResolveSymbol(spec.SymbolTypeId, unitTypeId);
                if (symbolTypeId != null && formatOptions.IsValidSymbol(symbolTypeId))
                    formatOptions.SetSymbolTypeId(symbolTypeId);
            }

            if (formatOptions.CanSuppressTrailingZeros())
                formatOptions.SuppressTrailingZeros = spec.SuppressTrailingZeros;

            if (formatOptions.CanSuppressLeadingZeros())
                formatOptions.SuppressLeadingZeros = spec.SuppressLeadingZeros;

            if (formatOptions.CanUsePlusPrefix())
                formatOptions.UsePlusPrefix = spec.UsePlusPrefix;

            formatOptions.UseDigitGrouping = spec.UseDigitGrouping;

            if (formatOptions.CanSuppressSpaces())
                formatOptions.SuppressSpaces = spec.SuppressSpaces;

            field.SetFormatOptions(formatOptions);
            return null;
        } catch (Exception ex) {
            return $"Failed to apply format options for field '{fieldName}': {ex.Message}";
        }
    }

    private static string GetDisplayLabel(this ParameterReference reference) =>
        reference.Name?.Trim() ??
        reference.Identity?.Name.Trim() ??
        reference.SharedGuid?.Trim() ??
        string.Empty;
}
