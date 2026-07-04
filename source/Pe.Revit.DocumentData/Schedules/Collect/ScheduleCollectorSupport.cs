using Pe.Revit.DocumentData.Parameters;
using Pe.Revit.DocumentData.Schedules.Authored;
using Pe.Shared.RevitData;
using Pe.Shared.RevitData.Schedules;
using System.Globalization;
using System.Text;

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
            .Select(ToSheetPlacement)
            .ToList();

    public static ScheduleCatalogSheetPlacement ToSheetPlacement(ViewSheet sheet) {
        var sheetNumber = sheet.SheetNumber ?? string.Empty;
        var sheetName = sheet.Name ?? string.Empty;
        var role = ClassifySheetRole(sheetNumber, sheetName);
        return new ScheduleCatalogSheetPlacement(
            sheetNumber,
            sheetName,
            string.Equals(role, "Issued", StringComparison.Ordinal),
            string.Equals(role, "Working", StringComparison.Ordinal),
            role
        );
    }

    private static string ClassifySheetRole(string sheetNumber, string sheetName) {
        var text = $"{sheetNumber} {sheetName}".Trim();
        if (text.StartsWith("-", StringComparison.Ordinal) || text.Contains(" WIP", StringComparison.OrdinalIgnoreCase) || text.Contains("working", StringComparison.OrdinalIgnoreCase))
            return "Working";
        if (text.StartsWith("x", StringComparison.OrdinalIgnoreCase) || text.Contains("archive", StringComparison.OrdinalIgnoreCase) || text.Contains("audit", StringComparison.OrdinalIgnoreCase))
            return "Archive";
        return "Issued";
    }

    public static List<ScheduleCatalogCustomParameterValue> CollectCustomParameters(ViewSchedule schedule) =>
        schedule.Parameters
            .Cast<Parameter>()
            .Where(parameter => parameter.Definition != null)
            .Where(IsNonBuiltInParameter)
            .OrderBy(parameter => parameter.Definition.Name, StringComparer.OrdinalIgnoreCase)
            .Select(parameter => new ScheduleCatalogCustomParameterValue(
                ToParameterDefinition(parameter, isInstance: null),
                NullIfWhiteSpace(parameter.AsString()) ?? NullIfWhiteSpace(parameter.AsValueString()),
                NullIfWhiteSpace(parameter.AsValueString()) ?? NullIfWhiteSpace(parameter.AsString()),
                ToRequestedParameterStorageType(parameter.StorageType)
            ))
            .ToList();

    public static bool MatchesCustomParameterFilters(
        ViewSchedule schedule,
        IEnumerable<ScheduleCustomParameterFilter>? filters
    ) {
        var requestedFilters = filters?.ToList() ?? [];
        if (requestedFilters.Count == 0)
            return true;

        var filterableParameters = CollectFilterableScheduleParameters(schedule);
        foreach (var filter in requestedFilters) {
            var references = ParameterReferenceResolver.Resolve([filter.Parameter]);
            if (references.Count == 0)
                return false;

            var matchedParameter = filterableParameters
                .FirstOrDefault(parameter =>
                    ParameterReferenceResolver.Matches(parameter.Definition.Identity, references));
            if (matchedParameter == null)
                return false;

            if (!MatchesCustomParameterFilter(matchedParameter, filter))
                return false;
        }

        return true;
    }

    private static List<ScheduleCatalogCustomParameterValue> CollectFilterableScheduleParameters(ViewSchedule schedule) =>
        schedule.Parameters
            .Cast<Parameter>()
            .Where(parameter => parameter.Definition != null)
            .OrderBy(parameter => parameter.Definition.Name, StringComparer.OrdinalIgnoreCase)
            .Select(parameter => new ScheduleCatalogCustomParameterValue(
                ToParameterDefinition(parameter, isInstance: null),
                NullIfWhiteSpace(parameter.AsString()) ?? NullIfWhiteSpace(parameter.AsValueString()),
                NullIfWhiteSpace(parameter.AsValueString()) ?? NullIfWhiteSpace(parameter.AsString()),
                ToRequestedParameterStorageType(parameter.StorageType)
            ))
            .ToList();

    public static List<ScheduleParameterUsageEntry> CollectParameterUsages(
        Document doc,
        ViewSchedule schedule
    ) {
        var usages = new List<ScheduleParameterUsageEntry>();
        var definition = schedule.Definition;

        for (var i = 0; i < definition.GetFieldCount(); i++) {
            var field = definition.GetField(i);
            usages.AddRange(CollectFieldUsages(doc, field, i));
        }

        return usages;
    }

    public static List<ParameterScheduleFieldEvidence> CollectParameterEvidenceFields(
        Document doc,
        ViewSchedule schedule
    ) {
        var placements = CollectSheetPlacements(doc, schedule);
        var filterFieldKeys = CollectFilterFieldKeys(schedule.Definition);
        var categoryName = GetCategoryName(doc, schedule);
        return CollectParameterUsages(doc, schedule)
            .Where(usage => usage.Parameter?.Identity != null)
            .Select(usage => new ParameterScheduleFieldEvidence(
                schedule.Id.Value(),
                schedule.UniqueId,
                schedule.Name,
                categoryName,
                placements.Count != 0,
                placements.Select(placement => placement.SheetNumber).ToList(),
                placements.Select(placement => placement.SheetName).ToList(),
                usage.FieldName,
                usage.ColumnHeading,
                usage.Parameter!.Definition!,
                usage.FieldIndex,
                usage.IsHidden,
                usage.IsCalculated,
                usage.IsCombinedParameter,
                filterFieldKeys.Contains(usage.FieldIndex.ToString(CultureInfo.InvariantCulture)) || filterFieldKeys.Contains(usage.FieldName),
                usage.Parameter.FieldType,
                usage.Parameter.SpecTypeId
            ))
            .ToList();
    }

    private static HashSet<string> CollectFilterFieldKeys(ScheduleDefinition definition) {
        var keys = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        for (var i = 0; i < definition.GetFilterCount(); i++) {
            var filter = definition.GetFilter(i);
            var field = SafeGet(() => definition.GetField(filter.FieldId));
            if (field == null)
                continue;

            keys.Add(field.GetName());
            for (var fieldIndex = 0; fieldIndex < definition.GetFieldCount(); fieldIndex++) {
                var candidate = definition.GetField(fieldIndex);
                if (Equals(candidate.FieldId, field.FieldId))
                    keys.Add(fieldIndex.ToString(CultureInfo.InvariantCulture));
            }
        }

        return keys;
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

    public static ParameterIdentity BuildFieldIdentity(
        Document doc,
        ScheduleField field,
        string fallbackName
    ) {
        if (!field.HasSchedulableField)
            return ParameterIdentityEngine.FromRaw(fallbackName, null, null, null);

        var schedulableField = field.GetSchedulableField();
        return ParameterIdentityEngine.FromParameterId(doc, schedulableField.ParameterId, fallbackName);
    }

    public static string? GetFieldTypeName(ScheduleField field) {
#if !REVIT2023
        return SafeGet(() => field.FieldType.ToString());
#else
        return null;
#endif
    }

    public static string? GetFieldSpecTypeKey(ScheduleField field) =>
        SafeGet(() => GetFieldSpecTypeId(field)?.TypeId);

    private static ParameterDefinitionDescriptor ToParameterDefinition(Parameter parameter, bool? isInstance) {
        var definition = parameter.Definition;
        return new ParameterDefinitionDescriptor(
            ParameterIdentityEngine.FromCanonical(ParameterIdentityFactory.FromParameter(parameter)),
            isInstance,
            NormalizeForgeTypeId(definition.GetDataType()),
            null,
            NormalizeForgeTypeId(definition.GetGroupTypeId()),
            null
        );
    }

    private static string? NormalizeForgeTypeId(ForgeTypeId forgeTypeId) =>
        string.IsNullOrWhiteSpace(forgeTypeId?.TypeId) ? null : forgeTypeId.TypeId;

    public static string NormalizeCellText(string? value) =>
        string.IsNullOrWhiteSpace(value)
            ? string.Empty
            : CollapseWhitespace(value.Replace("\r", " ").Replace("\n", " ").Trim());

    public static ForgeTypeId? GetFieldSpecTypeId(ScheduleField field) =>
        SafeGet(field.GetSpecTypeId);

    public static Units? BuildEffectiveUnits(
        Document doc,
        TableSectionData bodySection,
        int columnNumber,
        ScheduleField field,
        ForgeTypeId? specTypeId
    ) {
        if (specTypeId == null || specTypeId.Empty() || !UnitUtils.IsMeasurableSpec(specTypeId))
            return null;

        try {
            var units = doc.GetUnits();
            var formatOptions =
                SafeGet(() => bodySection.GetCellFormatOptions(columnNumber, doc)) ?? SafeGet(field.GetFormatOptions);
            if (formatOptions != null && !formatOptions.UseDefault)
                units.SetFormatOptions(specTypeId, formatOptions);

            return units;
        } catch {
            return SafeGet(doc.GetUnits);
        }
    }

    public static bool IsComparableField(ScheduleField field) =>
        field.DisplayType == ScheduleFieldDisplayType.Standard
        && !field.IsCombinedParameterField
        && !field.IsCalculatedField
#if !REVIT2023
        && field.FieldType != ScheduleFieldType.CustomField;
#else
    ;
#endif

    public static HashSet<string> GetMultipleValueTexts(ScheduleField field) {
        var texts = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        AddNormalizedText(texts, SafeGet(() => field.MultipleValuesText));
        AddNormalizedText(texts, SafeGet(() => field.MultipleValuesCustomText));
        AddNormalizedText(texts, "<varies>");
        return texts;
    }

    public static IReadOnlyList<Element> CollectParameterSourceElements(
        Document doc,
        Element element
    ) => EnumerateParameterSourceElements(doc, element).ToList();

    public static ComparableFieldValue ReadFieldComparableValue(
        Document doc,
        Element element,
        IReadOnlyList<Element> parameterSources,
        ScheduleField field,
        string fallbackName,
        ForgeTypeId? specTypeId,
        Units? effectiveUnits,
        ScheduleParameterResolutionCache? resolutionCache = null
    ) {
        var texts = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        if (!IsComparableField(field) || !field.HasSchedulableField)
            return new ComparableFieldValue(texts, null);

        double? rawDoubleValue = null;
        foreach (var parameterSource in parameterSources) {
            var parameterId = field.GetSchedulableField().ParameterId;
            var parameter = resolutionCache != null
                ? resolutionCache.Resolve(parameterSource, parameterId, fallbackName)
                : ResolveParameter(doc, parameterSource, parameterId, fallbackName);
            if (parameter == null)
                continue;

            AddParameterComparableTexts(texts, doc, parameter, specTypeId, effectiveUnits);
            if (rawDoubleValue == null && parameter.StorageType == StorageType.Double)
                rawDoubleValue = parameter.AsDouble();
        }

        if (element is FamilyInstance familyInstance) {
            if (string.Equals(fallbackName, "Family", StringComparison.OrdinalIgnoreCase))
                AddNormalizedText(texts, familyInstance.Symbol?.Family?.Name);

            if (string.Equals(fallbackName, "Type", StringComparison.OrdinalIgnoreCase))
                AddNormalizedText(texts, familyInstance.Symbol?.Name);

            if (string.Equals(fallbackName, "Family and Type", StringComparison.OrdinalIgnoreCase))
                AddNormalizedText(texts, $"{familyInstance.Symbol?.Family?.Name}: {familyInstance.Symbol?.Name}");
        }

        return new ComparableFieldValue(texts, rawDoubleValue);
    }

    public static HashSet<string> ReadFieldComparableTexts(
        Document doc,
        Element element,
        ScheduleField field,
        string fallbackName,
        ForgeTypeId? specTypeId,
        Units? effectiveUnits
    ) => ReadFieldComparableValue(
        doc,
        element,
        CollectParameterSourceElements(doc, element),
        field,
        fallbackName,
        specTypeId,
        effectiveUnits
    ).TextValues;

    public static double? ReadFieldComparableDoubleValue(
        Document doc,
        Element element,
        ScheduleField field,
        string fallbackName
    ) => ReadFieldComparableValue(
        doc,
        element,
        CollectParameterSourceElements(doc, element),
        field,
        fallbackName,
        null,
        null
    ).RawDoubleValue;

    public static string? ReadFieldDisplayValue(
        Document doc,
        Element element,
        ScheduleField field,
        string fallbackName
    ) {
        if (field == null)
            throw new ArgumentNullException(nameof(field));

        if (field.DisplayType != ScheduleFieldDisplayType.Standard)
            return null;

        if (field.IsCombinedParameterField)
            return BuildCombinedFieldDisplayValue(doc, element, field, fallbackName);

        if (!field.HasSchedulableField || field.IsCalculatedField)
            return null;

        return ReadParameterDisplayValue(doc, element, field.GetSchedulableField().ParameterId, fallbackName);
    }

    public static string? ReadParameterDisplayValue(
        Document doc,
        Element element,
        ElementId? parameterId,
        string fallbackName
    ) {
        if (element == null)
            throw new ArgumentNullException(nameof(element));

        foreach (var parameterSource in EnumerateParameterSourceElements(doc, element)) {
            var parameter = ResolveParameter(doc, parameterSource, parameterId, fallbackName);
            var directValue = NullIfWhiteSpace(parameter?.AsValueString()) ?? NullIfWhiteSpace(parameter?.AsString());
            if (!string.IsNullOrWhiteSpace(directValue))
                return directValue;
        }

        if (element is FamilyInstance familyInstance) {
            if (string.Equals(fallbackName, "Family", StringComparison.OrdinalIgnoreCase))
                return NullIfWhiteSpace(familyInstance.Symbol?.Family?.Name);

            if (string.Equals(fallbackName, "Type", StringComparison.OrdinalIgnoreCase))
                return NullIfWhiteSpace(familyInstance.Symbol?.Name);
        }

        return null;
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

    private static string? BuildCombinedFieldDisplayValue(
        Document doc,
        Element element,
        ScheduleField field,
        string fallbackName
    ) {
        var combinedParameters = field.GetCombinedParameters();
        if (combinedParameters == null || combinedParameters.Count == 0)
            return null;

        var builder = new StringBuilder();
        foreach (var combinedParameter in combinedParameters) {
            var parameterValue = ReadParameterDisplayValue(doc, element, combinedParameter.ParamId, fallbackName);
            if (string.IsNullOrWhiteSpace(parameterValue))
                continue;

            if (builder.Length != 0)
                _ = builder.Append(combinedParameter.Separator ?? " / ");

            _ = builder.Append(combinedParameter.Prefix ?? string.Empty);
            _ = builder.Append(parameterValue);
            _ = builder.Append(combinedParameter.Suffix ?? string.Empty);
        }

        return builder.Length == 0 ? null : builder.ToString();
    }

    private static IEnumerable<ScheduleParameterUsageEntry> CollectFieldUsages(
        Document doc,
        ScheduleField field,
        int fieldIndex
    ) {
        var columnHeading = field.ColumnHeading ?? string.Empty;
        var fieldName = field.GetName();

        if (field.IsCombinedParameterField) {
            foreach (var combinedParameter in field.GetCombinedParameters()) {
                yield return CreateParameterUsage(
                    doc,
                    field,
                    fieldIndex,
                    fieldName,
                    columnHeading,
                    combinedParameter.ParamId,
                    ParameterIdentityEngine.GetParameterKey(doc, combinedParameter.ParamId, fieldName)
                );
            }

            yield break;
        }

        if (!field.HasSchedulableField) {
            yield return CreateParameterUsage(
                doc,
                field,
                fieldIndex,
                fieldName,
                columnHeading,
                null,
                BuildFieldKey(doc, field, fieldName)
            );
            yield break;
        }

        var schedulableField = field.GetSchedulableField();
        yield return CreateParameterUsage(
            doc,
            field,
            fieldIndex,
            fieldName,
            columnHeading,
            schedulableField.ParameterId,
            ParameterIdentityEngine.GetParameterKey(doc, schedulableField.ParameterId, fieldName)
        );
    }

    private static ScheduleParameterUsageEntry CreateParameterUsage(
        Document doc,
        ScheduleField field,
        int fieldIndex,
        string fieldName,
        string columnHeading,
        ElementId? parameterId,
        string key
    ) {
        var identity = parameterId == null
            ? ParameterIdentityEngine.FromRaw(fieldName, null, null, null)
            : ParameterIdentityEngine.FromParameterId(doc, parameterId, fieldName);
        return new ScheduleParameterUsageEntry(fieldName, columnHeading, key) {
            Parameter = new ScheduleFieldParameterDescriptor(
                new ParameterDefinitionDescriptor(
                    identity,
                    null,
                    GetFieldSpecTypeKey(field),
                    null,
                    null,
                    null
                ),
                GetFieldTypeName(field)
            ),
            FieldIndex = fieldIndex,
            IsHidden = field.IsHidden,
            IsCalculated = field.IsCalculatedField,
            IsCombinedParameter = field.IsCombinedParameterField
        };
    }

    private static bool IsNonBuiltInParameter(Parameter parameter) =>
        ParameterIdentityFactory.FromParameter(parameter).Kind != ParameterIdentityKind.BuiltInParameter;

    private static Parameter? ResolveParameter(
        Document doc,
        Element element,
        ElementId? parameterId,
        string fallbackName
    ) {
        if (parameterId == null || parameterId == ElementId.InvalidElementId)
            return element.LookupParameter(fallbackName);

        var rawParameterId = parameterId.Value();
        if (rawParameterId < 0) {
            try {
                return element.get_Parameter((BuiltInParameter)rawParameterId);
            } catch {
                return element.LookupParameter(fallbackName);
            }
        }

        var exactMatch = element.Parameters
            .Cast<Parameter>()
            .FirstOrDefault(parameter => parameter.Id.Value() == rawParameterId);
        if (exactMatch != null)
            return exactMatch;

        var parameterName = doc.GetElement(parameterId)?.Name;
        return element.LookupParameter(parameterName ?? fallbackName);
    }

    private static void AddParameterComparableTexts(
        HashSet<string> texts,
        Document doc,
        Parameter parameter,
        ForgeTypeId? specTypeId,
        Units? effectiveUnits
    ) {
        AddNormalizedText(texts, parameter.AsValueString());
        AddNormalizedText(texts, parameter.AsString());

        switch (parameter.StorageType) {
        case StorageType.Integer:
            AddIntegerComparableTexts(texts, parameter);
            break;
        case StorageType.Double:
            AddDoubleComparableTexts(texts, doc, parameter, specTypeId, effectiveUnits);
            break;
        case StorageType.ElementId:
            AddElementIdComparableTexts(texts, doc, parameter);
            break;
        }
    }

    private static void AddIntegerComparableTexts(
        HashSet<string> texts,
        Parameter parameter
    ) {
        var intValue = parameter.AsInteger();
        AddNormalizedText(texts, intValue.ToString(CultureInfo.InvariantCulture));

        var dataType = SafeGet(() => parameter.Definition?.GetDataType());
        if (dataType == SpecTypeId.Boolean.YesNo) {
            AddNormalizedText(texts, intValue != 0 ? "Yes" : "No");
            AddNormalizedText(texts, intValue != 0 ? "True" : "False");
        }
    }

    private static void AddDoubleComparableTexts(
        HashSet<string> texts,
        Document doc,
        Parameter parameter,
        ForgeTypeId? specTypeId,
        Units? effectiveUnits
    ) {
        var doubleValue = parameter.AsDouble();
        AddNormalizedText(texts, doubleValue.ToString("G17", CultureInfo.InvariantCulture));

        var resolvedSpecTypeId = specTypeId ?? SafeGet(() => parameter.Definition?.GetDataType());
        if (resolvedSpecTypeId == null || resolvedSpecTypeId.Empty())
            return;

        if (resolvedSpecTypeId == SpecTypeId.Number) {
            AddNormalizedText(texts, doubleValue.ToString("G", CultureInfo.InvariantCulture));
            return;
        }

        if (!UnitUtils.IsMeasurableSpec(resolvedSpecTypeId))
            return;

        try {
            var units = effectiveUnits ?? doc.GetUnits();
            AddNormalizedText(texts, UnitFormatUtils.Format(units, resolvedSpecTypeId, doubleValue, false));
            AddNormalizedText(texts, UnitFormatUtils.Format(units, resolvedSpecTypeId, doubleValue, true));
        } catch {
            // Some specs still reject formatting in edge cases.
        }
    }

    private static void AddElementIdComparableTexts(
        HashSet<string> texts,
        Document doc,
        Parameter parameter
    ) {
        var elementId = parameter.AsElementId();
        if (elementId == null || elementId == ElementId.InvalidElementId)
            return;

        var referencedElement = doc.GetElement(elementId);
        AddNormalizedText(texts, referencedElement?.Name);
        AddNormalizedText(texts, $"[ID:{elementId.Value()}]");
        AddNormalizedText(texts, referencedElement == null ? null : $"{referencedElement.Name} [ID:{elementId.Value()}]");
    }

    private static IEnumerable<Element> EnumerateParameterSourceElements(
        Document doc,
        Element element
    ) {
        var seenIds = new HashSet<long>();

        if (seenIds.Add(element.Id.Value()))
            yield return element;

        if (element is FamilyInstance familyInstance && familyInstance.Symbol != null) {
            if (seenIds.Add(familyInstance.Symbol.Id.Value()))
                yield return familyInstance.Symbol;
        }

        var typeId = SafeGet(element.GetTypeId);
        if (typeId == null || typeId == ElementId.InvalidElementId)
            yield break;

        var typeElement = SafeGet(() => doc.GetElement(typeId));
        if (typeElement == null)
            yield break;

        if (seenIds.Add(typeElement.Id.Value()))
            yield return typeElement;
    }

    private static void AddNormalizedText(
        HashSet<string> texts,
        string? value
    ) {
        var normalized = NormalizeCellText(value);
        if (!string.IsNullOrWhiteSpace(normalized))
            _ = texts.Add(normalized);
    }

    private static string CollapseWhitespace(string value) {
        var builder = new StringBuilder(value.Length);
        var lastWasWhitespace = false;

        foreach (var ch in value) {
            if (char.IsWhiteSpace(ch)) {
                if (lastWasWhitespace)
                    continue;

                _ = builder.Append(' ');
                lastWasWhitespace = true;
            } else {
                _ = builder.Append(ch);
                lastWasWhitespace = false;
            }
        }

        return builder.ToString();
    }

    private static RequestedParameterStorageType ToRequestedParameterStorageType(StorageType storageType) =>
        storageType switch {
            StorageType.String => RequestedParameterStorageType.String,
            StorageType.Integer => RequestedParameterStorageType.Integer,
            StorageType.Double => RequestedParameterStorageType.Double,
            StorageType.ElementId => RequestedParameterStorageType.ElementId,
            _ => RequestedParameterStorageType.None
        };

    public sealed record ComparableFieldValue(
        HashSet<string> TextValues,
        double? RawDoubleValue
    );
}
