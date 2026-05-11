namespace Pe.Shared.RevitVersions;

public static class RevitVersionCatalog {
    private static readonly IReadOnlyList<RevitVersionSpec> Specs = [
        new(2023, "R23", "Autodesk.Revit+2023", "2023.0.1", "net48", false),
        new(2024, "R24", "Autodesk.Revit+2024", "2024.0.2", "net48", true),
        new(2025, "R25", "Autodesk.Revit+2025", "2025.0.1", "net8.0-windows", true),
        new(2026, "R26", "Autodesk.Revit+2026", "2026.0.0", "net8.0-windows", true)
    ];
    private static readonly string ConfigurationMarker = ".R";

    public static IReadOnlyList<int> GetSupportedAutomationYears() =>
        Specs.Where(spec => spec.SupportsDesignAutomation)
            .Select(spec => spec.Year)
            .ToArray();

    public static RevitVersionSpec RequireByYear(int year) =>
        Specs.FirstOrDefault(spec => spec.Year == year && spec.SupportsDesignAutomation)
        ?? throw new InvalidOperationException($"Unsupported Revit automation year '{year}'.");

    public static RevitVersionSpec RequireByAutomationEngine(string engine) =>
        Specs.FirstOrDefault(spec =>
            spec.SupportsDesignAutomation &&
            string.Equals(spec.DesignAutomationEngine, engine, StringComparison.OrdinalIgnoreCase))
        ?? throw new InvalidOperationException($"Unsupported Revit automation engine '{engine}'.");

    public static bool TryResolveFromConfiguration(string configuration, out RevitVersionSpec spec) {
        var markerIndex = (configuration ?? string.Empty).IndexOf(ConfigurationMarker, StringComparison.OrdinalIgnoreCase);
        if (markerIndex < 0 || configuration!.Length < markerIndex + 4) {
            spec = null!;
            return false;
        }

        var yearToken = configuration.Substring(markerIndex + 2, 2);
        if (!int.TryParse(yearToken, out var shortYear)) {
            spec = null!;
            return false;
        }

        var year = 2000 + shortYear;
        var resolved = Specs.FirstOrDefault(candidate =>
            candidate.Year == year &&
            string.Equals(candidate.ConfigurationSuffix, $"R{shortYear:D2}", StringComparison.OrdinalIgnoreCase));

        if (resolved is null) {
            spec = null!;
            return false;
        }

        spec = resolved;
        return true;
    }
}
