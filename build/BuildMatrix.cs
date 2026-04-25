namespace Build;

public sealed record BuildMatrix(
    string DefaultRevitYear,
    string DefaultRevitConfiguration,
    string StableCliConfiguration,
    IReadOnlyList<string> SupportedRevitYears,
    IReadOnlyList<string> AutomationSupportedRevitYears,
    IReadOnlyList<string> RevitDebugConfigurations,
    IReadOnlyList<string> RevitReleaseConfigurations,
    IReadOnlyList<string> RevitTestConfigurations,
    IReadOnlyList<string> CompileRevitConfigurations,
    IReadOnlyList<string> PackConfigurations,
    IReadOnlyList<string> AutomationPackConfigurations,
    IReadOnlyList<string> SolutionConfigurations
) {
    public string[] ResolveConfigurations(BuildConfigurationGroup group, string? explicitConfiguration) {
        if (!string.IsNullOrWhiteSpace(explicitConfiguration)) {
            if (!this.SolutionConfigurations.Contains(explicitConfiguration, StringComparer.OrdinalIgnoreCase))
                throw new InvalidOperationException($"Unsupported solution configuration '{explicitConfiguration}'.");

            return [explicitConfiguration];
        }

        return group switch {
            BuildConfigurationGroup.CompileRevit => [.. this.CompileRevitConfigurations],
            BuildConfigurationGroup.Pack => [.. this.PackConfigurations],
            BuildConfigurationGroup.AutomationPack => [.. this.AutomationPackConfigurations],
            _ => throw new ArgumentOutOfRangeException(nameof(group), group, null)
        };
    }

    public string ResolveOperatorConfiguration(string? explicitConfiguration) =>
        string.IsNullOrWhiteSpace(explicitConfiguration) ? this.DefaultRevitConfiguration : explicitConfiguration;
}
