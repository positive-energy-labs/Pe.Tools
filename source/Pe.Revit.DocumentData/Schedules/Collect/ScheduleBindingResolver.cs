using Pe.Shared.RevitData;
using Pe.Shared.RevitData.Schedules;
using System.Globalization;

namespace Pe.Revit.DocumentData.Schedules.Collect;

/// <summary>
///     Resolves the write surface behind rendered schedule cells: for each (bound row × visible
///     column), which element(s) a cell edit would write to and through which parameter. Columns
///     without a writable parameter (calculated, combined, count/totals display, unresolvable)
///     carry a blocker instead — those are exactly the columns Revit's own schedule editor
///     refuses to type into, so nothing is lost for editing flows.
/// </summary>
internal static class ScheduleBindingResolver {

    public sealed record BindingColumn(
        int ColumnNumber,
        ScheduleField Field,
        string FieldName
    );

    public static List<ScheduleCellBinding> ResolveRow(
        Document doc,
        IReadOnlyList<BindingColumn> columns,
        IReadOnlyList<Element> boundElements,
        ScheduleParameterResolutionCache resolutionCache
    ) => columns
        .Select(column => ResolveCell(doc, column, boundElements, resolutionCache))
        .ToList();

    private static ScheduleCellBinding ResolveCell(
        Document doc,
        BindingColumn column,
        IReadOnlyList<Element> boundElements,
        ScheduleParameterResolutionCache resolutionCache
    ) {
        var blocker = ClassifyBlocker(column.Field);
        if (blocker != ScheduleCellBindingBlocker.None)
            return Blocked(column.ColumnNumber, blocker);

        var parameterId = column.Field.GetSchedulableField().ParameterId;
        var resolved = new List<(Element Source, Parameter Parameter)>();
        foreach (var element in boundElements) {
            // First parameter source that HAS the parameter wins — deliberately not
            // ReadParameterDisplayValue's first-non-blank-value rule: an empty Mark is
            // still the editable target, not a reason to fall through to the type.
            foreach (var source in ScheduleCollectorSupport.CollectParameterSourceElements(doc, element)) {
                var parameter = resolutionCache.Resolve(source, parameterId, column.FieldName);
                if (parameter == null)
                    continue;

                resolved.Add((source, parameter));
                break;
            }
        }

        if (resolved.Count == 0)
            return Blocked(column.ColumnNumber, ScheduleCellBindingBlocker.ParameterNotFound);

        var first = resolved[0].Parameter;
        var rawValues = resolved.Select(item => GetRawValue(item.Parameter)).ToList();
        // Deliberately NOT gated on Parameter.UserModifiable: Revit reports it false for writable
        // built-ins (Mark, Type Comments) whose Set() succeeds — proven in ScheduleCellBindingProofTests.
        var isReadOnly = resolved.All(item => item.Parameter.IsReadOnly);
        return new ScheduleCellBinding(
            column.ColumnNumber,
            resolved.Select(item => item.Source.Id.Value()).Distinct().ToList(),
            ScheduleCollectorSupport.SafeGet(() => first.Definition?.Name) ?? column.FieldName,
            first.Id.Value(),
            ToStorageType(first.StorageType),
            rawValues[0],
            ScheduleCollectorSupport.NullIfWhiteSpace(first.AsValueString())
                ?? ScheduleCollectorSupport.NullIfWhiteSpace(first.AsString()),
            IsTypeSource(resolved[0].Source, boundElements),
            !isReadOnly,
            isReadOnly ? ScheduleCellBindingBlocker.ReadOnlyParameter : ScheduleCellBindingBlocker.None,
            HasMixedValues: rawValues.Distinct(StringComparer.Ordinal).Count() > 1
        );
    }

    private static ScheduleCellBindingBlocker ClassifyBlocker(ScheduleField field) {
        if (field.IsCalculatedField)
            return ScheduleCellBindingBlocker.CalculatedField;
        if (field.IsCombinedParameterField)
            return ScheduleCellBindingBlocker.CombinedParameterField;
        if (field.DisplayType != ScheduleFieldDisplayType.Standard)
            return ScheduleCellBindingBlocker.NonStandardDisplay;
        if (!field.HasSchedulableField)
            return ScheduleCellBindingBlocker.ParameterNotFound;
        return ScheduleCellBindingBlocker.None;
    }

    private static ScheduleCellBinding Blocked(int columnNumber, ScheduleCellBindingBlocker blocker) =>
        new(
            columnNumber,
            [],
            null,
            null,
            RequestedParameterStorageType.None,
            null,
            null,
            IsTypeParameter: false,
            IsEditable: false,
            blocker
        );

    private static bool IsTypeSource(Element source, IReadOnlyList<Element> boundElements) =>
        boundElements.All(element => element.Id.Value() != source.Id.Value());

    private static string? GetRawValue(Parameter parameter) =>
        parameter.StorageType switch {
            StorageType.String => parameter.AsString(),
            StorageType.Integer => parameter.AsInteger().ToString(CultureInfo.InvariantCulture),
            StorageType.Double => parameter.AsDouble().ToString("G17", CultureInfo.InvariantCulture),
            StorageType.ElementId => parameter.AsElementId()?.Value().ToString(CultureInfo.InvariantCulture),
            _ => null
        };

    private static RequestedParameterStorageType ToStorageType(StorageType storageType) =>
        storageType switch {
            StorageType.String => RequestedParameterStorageType.String,
            StorageType.Integer => RequestedParameterStorageType.Integer,
            StorageType.Double => RequestedParameterStorageType.Double,
            StorageType.ElementId => RequestedParameterStorageType.ElementId,
            _ => RequestedParameterStorageType.None
        };
}
