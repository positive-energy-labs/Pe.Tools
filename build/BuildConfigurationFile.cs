using System.Xml.Linq;

namespace Build;

internal static class BuildConfigurationFile {
    private const string FilePath = BuildAuthoredPaths.MatrixFilePath;

    public static BuildMatrixAuthoring LoadAuthoring(string repositoryRoot) {
        var document = LoadDocument(repositoryRoot);
        var revitYears = document.Descendants()
            .Where(element => string.Equals(element.Name.LocalName, "PeRevitYear", StringComparison.Ordinal))
            .Select(ParseRevitYear)
            .OrderBy(year => year.Year, StringComparer.Ordinal)
            .ToArray();

        return new BuildMatrixAuthoring(
            RequireValue(document, "PeDefaultRevitYear"),
            RequireValue(document, "PeDefaultBuildKind"),
            RequireValue(document, "PeSharedNeutralTargetFramework"),
            RequireValue(document, "PeOutOfProcTargetFramework"),
            revitYears
        );
    }

    public static BuildMatrix LoadMatrix(string repositoryRoot) {
        var authored = LoadAuthoring(repositoryRoot);
        var defaultYear = authored.RequireDefaultRevitYear();
        var revitDebugConfigurations = authored.RevitYears
            .Select(year => $"Debug.{year.ConfigurationSuffix}")
            .ToArray();
        var revitReleaseConfigurations = authored.RevitYears
            .Select(year => $"Release.{year.ConfigurationSuffix}")
            .ToArray();
        var revitTestConfigurations = authored.RevitYears
            .Select(year => $"Debug.{year.ConfigurationSuffix}.Tests")
            .Concat(authored.RevitYears.Select(year => $"Release.{year.ConfigurationSuffix}.Tests"))
            .ToArray();

        return new BuildMatrix(
            $"{authored.DefaultBuildKind}.{defaultYear.ConfigurationSuffix}",
            authored.RevitYears.Where(year => year.SupportsCompile).Select(year => $"Release.{year.ConfigurationSuffix}").ToArray(),
            authored.RevitYears.Where(year => year.SupportsPack).Select(year => $"Release.{year.ConfigurationSuffix}").ToArray(),
            authored.RevitYears.Where(year => year.SupportsAutomationPack).Select(year => $"Release.{year.ConfigurationSuffix}").ToArray(),
            [.. revitDebugConfigurations, .. revitReleaseConfigurations, .. revitTestConfigurations]
        );
    }

    private static XDocument LoadDocument(string repositoryRoot) {
        var path = Path.Combine(repositoryRoot, FilePath);
        return XDocument.Load(path);
    }

    private static BuildRevitYearIdentity ParseRevitYear(XElement element) =>
        new(
            RequireAttribute(element, "Include"),
            RequireAttribute(element, "Suffix"),
            RequireAttribute(element, "RuntimeTargetFramework"),
            RequireAttribute(element, "AutomationTargetFramework"),
            ParseBool(RequireAttribute(element, "SupportsCompile"), "PeRevitYear", "SupportsCompile"),
            ParseBool(RequireAttribute(element, "SupportsPack"), "PeRevitYear", "SupportsPack"),
            ParseBool(RequireAttribute(element, "SupportsAutomationPack"), "PeRevitYear", "SupportsAutomationPack")
        );

    private static string RequireValue(XDocument document, string propertyName) {
        var value = document.Descendants()
            .FirstOrDefault(element => string.Equals(element.Name.LocalName, propertyName, StringComparison.Ordinal))
            ?.Value
            .Trim();

        return string.IsNullOrWhiteSpace(value)
            ? throw new InvalidOperationException($"Required build property '{propertyName}' was not found in {FilePath}.")
            : value;
    }

    private static string RequireAttribute(XElement element, string attributeName) =>
        element.Attribute(attributeName)?.Value
        ?? throw new InvalidOperationException(
            $"Element '{element.Name.LocalName}' is missing required attribute '{attributeName}' in {FilePath}.");

    private static bool ParseBool(string value, string elementName, string attributeName) =>
        bool.TryParse(value, out var result)
            ? result
            : throw new InvalidOperationException(
                $"Element '{elementName}' has unsupported {attributeName} value '{value}' in {FilePath}.");
}
