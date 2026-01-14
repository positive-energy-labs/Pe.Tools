using Pe.Extensions.FamManager;
using Pe.Global.PolyFill;

namespace Pe.Extensions.FamDocument.GetValue;

public static class FamilyManagerGetValue {
    /// <summary>
    ///     Get a parameter value using the current family type.
    /// </summary>
    /// <returns>The parameter value, or null if the parameter is null or has no value</returns>
    /// <remarks>
    ///     Only use this when the type-safety of the parameter value is unimportant, like logging,
    ///     or for example when used in conjunction with the SetValue extension methods.
    /// </remarks>
    /// <exception cref="T:Autodesk.Revit.Exceptions.ArgumentException">
    ///     Thrown if the input argument-"familyParameter"-is invalid,
    /// </exception>
    public static object? GetValue(this FamilyDocument famDoc, FamilyParameter familyParameter) {
        var famType = famDoc.FamilyManager.CurrentType;
        if (!famType.HasValue(familyParameter)) return null;

        return familyParameter.StorageType switch {
            StorageType.Double => famType.AsDouble(familyParameter),
            StorageType.String => famType.AsString(familyParameter),
            StorageType.Integer => famType.AsInteger(familyParameter),
            StorageType.ElementId => famType.AsElementId(familyParameter),
            _ => null
        };
    }

    /// <summary>
    ///     Get a parameter value using the current family type. Returns null if the familyParameter is null.
    /// </summary>
    /// <remarks>
    ///     Only use this when the type-safety of the parameter value is unimportant, like logging,
    ///     or for example when used in conjunction with the SetValue extension methods.
    /// </remarks>
    /// <exception cref="T:Autodesk.Revit.Exceptions.ArgumentException">
    ///     Thrown if the input argument-"familyParameter"-is invalid,
    /// </exception>
    public static object? GetValue(this FamilyDocument famDoc, string familyParameterName) {
        var fm = famDoc.FamilyManager;
        var familyParameter = fm.FindParameter(familyParameterName);
        if (familyParameter == null) return null;

        return famDoc.GetValue(familyParameter);
    }

    /// <summary>
    ///     Checks if a parameter has a value set, either via a formula or a direct value.
    /// </summary>
    /// <param name="doc">The family document</param>
    /// <param name="param">The parameter to check</param>
    /// <returns>True if the parameter has a value set, false otherwise</returns>
    public static bool HasValue(this FamilyDocument doc, FamilyParameter param) {
        if (!string.IsNullOrWhiteSpace(param.Formula)) return true;
        var value = doc.GetValue(param);
        return value is not null;
    }

    /// <summary>
    ///     Get the string value with a unit (ie. what you see in the family editor) of a parameter using the current family
    ///     type.
    ///     Handles all storage types correctly:
    ///     - Double: Returns unit-formatted string (e.g., "10'", "120 V")
    ///     - String: Returns the raw string value
    ///     - Integer (Yes/No): Returns "Yes" or "No"
    ///     - Integer (other): Returns the integer as string
    ///     - ElementId: Returns the element name if available, otherwise the ID
    /// </summary>
    /// <param name="famDoc">The family document</param>
    /// <param name="param">The parameter to get the value from</param>
    /// <returns>The string value of the parameter, or null if the parameter is null or has no value</returns>
    public static string? GetValueString(this FamilyDocument famDoc, FamilyParameter param) {
        var famType = famDoc.FamilyManager.CurrentType;
        if (!famType.HasValue(param)) return null;

        return param.StorageType switch {
            StorageType.String => famType.AsString(param),
            StorageType.Integer => GetIntegerValueString(famType, param),
            StorageType.Double => famType.AsValueString(param),
            StorageType.ElementId => GetElementIdValueString(famDoc, famType, param),
            _ => null
        };
    }

    private static string? GetIntegerValueString(FamilyType famType, FamilyParameter param) {
        var intValue = famType.AsInteger(param);
        var dataType = param.Definition.GetDataType();

        // Yes/No parameters should return "Yes" or "No" for human readability
        if (dataType == SpecTypeId.Boolean.YesNo)
            return intValue == 1 ? "Yes" : "No";

        return intValue.ToString();
    }

    private static string? GetElementIdValueString(FamilyDocument famDoc, FamilyType famType, FamilyParameter param) {
        var elementId = famType.AsElementId(param);
        if (elementId == null || elementId == ElementId.InvalidElementId)
            return null;

        // Try to get the element name from the document
        var element = famDoc.Document.GetElement(elementId);
        if (element != null) {
            // Format: "ElementName [ID:12345]" - human-readable and parseable
            return $"{element.Name} [ID:{elementId.Value()}]";
        }

        // Fallback to ID-only format if element not found
        return $"[ID:{elementId.Value()}]";
    }
}