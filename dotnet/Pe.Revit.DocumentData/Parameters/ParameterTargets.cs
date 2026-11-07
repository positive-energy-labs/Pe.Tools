using Pe.Shared.RevitData;
using System.Globalization;

namespace Pe.Revit.DocumentData.Parameters;

/// <summary>The one read of <see cref="ParameterTarget" /> evidence, shared by schedule bindings and parameter edits.</summary>
public static class ParameterTargets {
    /// <summary>Evidence for <paramref name="parameter" /> on <paramref name="source" />; <paramref name="fallbackName" /> is used only when the definition has no name.</summary>
    public static ParameterTarget Read(Element source, Parameter parameter, string? fallbackName = null) =>
        new(source.Id.Value(), parameter.Id.Value(),
            SafeName(parameter) ?? fallbackName,
            StorageOf(parameter.StorageType), parameter.IsReadOnly, parameter.HasValue, RawValue(parameter),
            ReviewLabel(source), source.UniqueId, source is ElementType ? "type" : "instance",
            parameter.HasValue
                ? parameter.StorageType == StorageType.String ? parameter.AsString() : parameter.AsValueString() ?? RawValue(parameter)
                : "unset");

    private static string ReviewLabel(Element source) {
        string? Text(Parameter? p) => p is { HasValue: true, StorageType: StorageType.String } ? p.AsString() : null;
        var mark = Text(source.LookupParameter("PE_G___TagInstance"));
        if (string.IsNullOrWhiteSpace(mark)) mark = Text(source.get_Parameter(BuiltInParameter.ALL_MODEL_MARK));
        if (string.IsNullOrWhiteSpace(mark)) mark = Text(source.get_Parameter(BuiltInParameter.ALL_MODEL_TYPE_MARK));
        return !string.IsNullOrWhiteSpace(mark) ? mark! : source is FamilyInstance family
            ? $"{family.Symbol.FamilyName} {family.Symbol.Name}"
            : $"{source.Category?.Name ?? "Element"} {source.Name}";
    }

    internal static RequestedParameterStorageType StorageOf(StorageType storageType) =>
        storageType switch {
            StorageType.String => RequestedParameterStorageType.String,
            StorageType.Integer => RequestedParameterStorageType.Integer,
            StorageType.Double => RequestedParameterStorageType.Double,
            StorageType.ElementId => RequestedParameterStorageType.ElementId,
            _ => RequestedParameterStorageType.None
        };

    private static string? RawValue(Parameter parameter) =>
        parameter.StorageType switch {
            StorageType.String => parameter.AsString(),
            StorageType.Integer => parameter.AsInteger().ToString(CultureInfo.InvariantCulture),
            StorageType.Double => parameter.AsDouble().ToString("G17", CultureInfo.InvariantCulture),
            StorageType.ElementId => parameter.AsElementId()?.Value().ToString(CultureInfo.InvariantCulture),
            _ => null
        };

    private static string? SafeName(Parameter parameter) {
        try { return parameter.Definition?.Name; } catch { return null; }
    }
}
