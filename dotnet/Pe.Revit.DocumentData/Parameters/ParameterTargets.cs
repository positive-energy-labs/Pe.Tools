using Pe.Shared.RevitData;
using System.Globalization;

namespace Pe.Revit.DocumentData.Parameters;

/// <summary>The one read of <see cref="ParameterTarget" /> evidence, shared by schedule bindings and parameter edits.</summary>
public static class ParameterTargets {
    /// <summary>Evidence for <paramref name="parameter" /> on <paramref name="source" />; <paramref name="fallbackName" /> is used only when the definition has no name.</summary>
    public static ParameterTarget Read(Element source, Parameter parameter, string? fallbackName = null) =>
        new(source.Id.Value(), parameter.Id.Value(),
            SafeName(parameter) ?? fallbackName,
            StorageOf(parameter.StorageType), parameter.IsReadOnly, parameter.HasValue, RawValue(parameter));

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
