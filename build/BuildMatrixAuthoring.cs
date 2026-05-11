namespace Build;

public sealed record BuildMatrixAuthoring(
    string DefaultRevitYear,
    string DefaultBuildKind,
    string SharedNeutralTargetFramework,
    string OutOfProcTargetFramework,
    IReadOnlyList<BuildRevitYearIdentity> RevitYears
) {
    public BuildRevitYearIdentity RequireDefaultRevitYear() =>
        this.RevitYears.FirstOrDefault(year =>
            string.Equals(year.Year, this.DefaultRevitYear, StringComparison.Ordinal))
        ?? throw new InvalidOperationException(
            $"Default Revit year '{this.DefaultRevitYear}' was not found in {BuildAuthoredPaths.MatrixFilePath}.");
}

public sealed record BuildRevitYearIdentity(
    string Year,
    string ConfigurationSuffix,
    string RuntimeTargetFramework,
    string AutomationTargetFramework,
    bool SupportsCompile,
    bool SupportsPack,
    bool SupportsAutomationPack
);
