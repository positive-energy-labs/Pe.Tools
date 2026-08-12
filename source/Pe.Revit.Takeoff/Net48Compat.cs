namespace Pe.Revit.Takeoff;

// ponytail: net48 lanes (R2023/24) lack double.IsFinite; one extension keeps call sites terse.
internal static class DoubleCompat {
    public static bool IsFinite(this double value) => !double.IsNaN(value) && !double.IsInfinity(value);
}
