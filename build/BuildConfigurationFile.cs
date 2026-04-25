using System.Xml.Linq;

namespace Build;

internal static class BuildConfigurationFile {
    private const string FilePath = "build/BuildConfiguration.props";

    public static BuildMatrix LoadMatrix(string repositoryRoot) {
        var document = LoadDocument(repositoryRoot);

        return new BuildMatrix(
            RequireValue(document, "PeDefaultRevitYear"),
            RequireValue(document, "PeDefaultRevitConfiguration"),
            RequireValue(document, "PeStableCliConfiguration"),
            SplitList(RequireValue(document, "PeSupportedRevitYears")),
            SplitList(RequireValue(document, "PeAutomationSupportedRevitYears")),
            SplitList(RequireValue(document, "PeRevitDebugConfigurations")),
            SplitList(RequireValue(document, "PeRevitReleaseConfigurations")),
            SplitList(RequireValue(document, "PeRevitTestConfigurations")),
            SplitList(RequireValue(document, "PeCompileRevitConfigurations")),
            SplitList(RequireValue(document, "PePackConfigurations")),
            SplitList(RequireValue(document, "PeAutomationPackConfigurations")),
            SplitList(RequireValue(document, "PeSolutionConfigurations"))
        );
    }

    public static BuildLayout LoadLayout(string repositoryRoot) {
        var artifactsRoot = Path.GetFullPath(Path.Combine(repositoryRoot, ".artifacts"));
        var packagesRoot = Path.Combine(artifactsRoot, "packages");
        var buildRoot = Path.Combine(artifactsRoot, "build");
        var publishRoot = Path.Combine(artifactsRoot, "publish");
        var toolsRoot = Path.Combine(artifactsRoot, "tools");

        return new BuildLayout(
            repositoryRoot,
            EnsureTrailingSeparator(artifactsRoot),
            EnsureTrailingSeparator(buildRoot),
            EnsureTrailingSeparator(publishRoot),
            EnsureTrailingSeparator(packagesRoot),
            EnsureTrailingSeparator(Path.Combine(packagesRoot, "bundles")),
            EnsureTrailingSeparator(Path.Combine(packagesRoot, "automation")),
            EnsureTrailingSeparator(Path.Combine(packagesRoot, "installers")),
            EnsureTrailingSeparator(Path.Combine(artifactsRoot, "staging", "automation")),
            EnsureTrailingSeparator(Path.Combine(publishRoot, "revit")),
            EnsureTrailingSeparator(Path.Combine(publishRoot, "host")),
            EnsureTrailingSeparator(toolsRoot)
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

    private static IReadOnlyList<string> SplitList(string value) =>
        value.Split(';', StringSplitOptions.TrimEntries | StringSplitOptions.RemoveEmptyEntries);

    private static string EnsureTrailingSeparator(string path) =>
        path.EndsWith(Path.DirectorySeparatorChar) || path.EndsWith(Path.AltDirectorySeparatorChar)
            ? path
            : path + Path.DirectorySeparatorChar;
}
