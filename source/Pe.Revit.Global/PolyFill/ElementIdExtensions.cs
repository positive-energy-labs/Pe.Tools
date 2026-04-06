namespace Pe.Revit.Global.PolyFill;

/// <summary>
///     Polyfill extension methods to provide consistent API across Revit versions.
///     These methods abstract version-specific differences in the Revit API.
/// </summary>
public static class ElementIdExtensions {
    /// <summary>
    ///     Gets the integer value of an ElementId, providing a polyfill for ElementId.Id.Value
    ///     which is available in Revit 2025+ but requires IntegerValue in earlier versions.
    /// </summary>
    /// <param name="elementId">The ElementId to get the value from</param>
    /// <returns>The integer value of the ElementId</returns>
    public static long Value(this ElementId elementId) =>
#if REVIT2025 || REVIT2026
        elementId.Value;
#else
            elementId.IntegerValue;
#endif
}