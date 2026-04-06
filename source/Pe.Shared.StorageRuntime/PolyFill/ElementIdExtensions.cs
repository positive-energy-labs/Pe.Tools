namespace Pe.Shared.StorageRuntime.Revit.PolyFill;

public static class ElementIdExtensions {
    public static long Value(this ElementId elementId) =>
#if REVIT2025 || REVIT2026
        elementId.Value;
#else
        elementId.IntegerValue;
#endif
}
