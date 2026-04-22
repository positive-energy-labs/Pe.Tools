namespace Pe.Revit.SettingsRuntime.PolyFill;

public static class ElementIdExtensions {
    public static long Value(this ElementId elementId) =>
#if REVIT2025 || REVIT2026
        elementId.Value;
#else
        elementId.IntegerValue;
#endif

    public static ElementId ToElementId(this long value) =>
#if REVIT2025 || REVIT2026
        new(value);
#else
        new(checked((int)value));
#endif

    public static ElementId ToElementId(this int value) =>
#if REVIT2025 || REVIT2026
        new(value);
#else
        new(value);
#endif
}