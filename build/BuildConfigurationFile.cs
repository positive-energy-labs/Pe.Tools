using System.Xml.Linq;
using Pe.Shared.RevitVersions;

namespace Build;

internal static class BuildConfigurationFile {
    private const string FilePath = "Directory.Build.props";

    public static BuildMatrix LoadMatrix(string repositoryRoot) {
        var document = LoadDocument(repositoryRoot);
        var defaultYear = ParseYear(RequireValue(document, "PeDefaultRevitYear"));
        var specs = RequireValue(document, "PeRevitYears")
            .Split(';', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries)
            .Select(ParseYear)
            .Select(RevitVersionCatalog.RequireDesktopYear)
            .OrderBy(spec => spec.Year)
            .ToArray();
        var defaultSpec = specs.FirstOrDefault(spec => spec.Year == defaultYear)
            ?? throw new InvalidOperationException($"Default Revit year '{defaultYear}' is not listed in {FilePath}.");
        var revitDebugConfigurations = specs
            .Select(spec => FormatConfiguration("Debug", spec))
            .ToArray();
        var revitReleaseConfigurations = specs
            .Select(spec => FormatConfiguration("Release", spec))
            .ToArray();
        var revitTestConfigurations = specs
            .Select(spec => $"{FormatConfiguration("Debug", spec)}.Tests")
            .Concat(specs.Select(spec => $"{FormatConfiguration("Release", spec)}.Tests"))
            .ToArray();

        return new BuildMatrix(
            FormatConfiguration("Debug", defaultSpec),
            revitReleaseConfigurations,
            revitReleaseConfigurations,
            specs.Where(spec => spec.SupportsDesignAutomation).Select(spec => FormatConfiguration("Release", spec)).ToArray(),
            [.. revitDebugConfigurations, .. revitReleaseConfigurations, .. revitTestConfigurations]
        );
    }

    private static XDocument LoadDocument(string repositoryRoot) {
        var path = Path.Combine(repositoryRoot, FilePath);
        return XDocument.Load(path);
    }

    private static string RequireValue(XDocument document, string propertyName) {
        var value = document.Descendants()
            .FirstOrDefault(element => string.Equals(element.Name.LocalName, propertyName, StringComparison.Ordinal))
            ?.Value
            .Trim();

        return string.IsNullOrWhiteSpace(value)
            ? throw new InvalidOperationException($"Required build property '{propertyName}' was not found in {FilePath}.")
            : value;
    }

    private static string FormatConfiguration(string buildKind, RevitVersionSpec spec) =>
        $"{buildKind}.{spec.ConfigurationSuffix}";

    private static int ParseYear(string value) =>
        int.TryParse(value, out var result)
            ? result
            : throw new InvalidOperationException($"Unsupported Revit year '{value}' in {FilePath}.");
}
