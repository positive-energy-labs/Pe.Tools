// Fixes CS0138 by using 'using static' for the Filters type

using Serilog;

namespace Pe.Revit.Global.Revit.Utils;

public class Utils {
    // Helper method to get current Revit version
    public static string GetRevitVersion() {
#if REVIT2023
        return "2023";
#elif REVIT2024
        return "2024";
#elif REVIT2025
        return "2025";
#elif REVIT2026
        return "2026";
#else
        return null;
#endif
    }

    public static bool IsRevit2026() => GetRevitVersion() == "2026";
    public static bool IsRevit2025() => GetRevitVersion() == "2025";
    public static bool IsRevit2024() => GetRevitVersion() == "2024";
    public static bool IsRevit2023() => GetRevitVersion() == "2023";

    public static bool IsDebug() {
#if DEBUG
        return true;
#else
        return false;
#endif
    }

    public static bool IsRelease() {
#if RELEASE
        return true;
#else
        return false;
#endif
    }

    public static bool IsNet48() {
#if REVIT2025_OR_GREATER
        return true;
#else
        return false;
#endif
    }

    public static bool IsNet8() => !IsNet48();
}
