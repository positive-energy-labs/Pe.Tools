// Fixes CS0138 by using 'using static' for the Filters type

namespace Pe.Global.Revit.Utils;

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
}