using System.Xml.Linq;

namespace Build;

internal static class BuildPackagePolicyFile {
    private const string FilePath = BuildAuthoredPaths.PackagePolicyFilePath;

    public static IReadOnlyList<BuildPackagePolicy> Load(string repositoryRoot) {
        var path = Path.Combine(repositoryRoot, FilePath);
        var document = XDocument.Load(path);

        return document.Descendants()
            .Where(element => string.Equals(element.Name.LocalName, "PePackagePolicy", StringComparison.Ordinal))
            .Select(ParsePolicy)
            .ToArray();
    }

    private static BuildPackagePolicy ParsePolicy(XElement element) =>
        new(
            RequireAttribute(element, "Include"),
            RequireAttribute(element, "Version"),
            element.Attribute("PrivateAssets")?.Value,
            element.Attribute("TargetFramework")?.Value,
            SplitModuleClasses(element.Attribute("ModuleClasses")?.Value),
            element.Attribute("ProjectName")?.Value
        );

    private static IReadOnlyList<ModuleClass> SplitModuleClasses(string? value) =>
        string.IsNullOrWhiteSpace(value)
            ? []
            : value.Split(';', StringSplitOptions.TrimEntries | StringSplitOptions.RemoveEmptyEntries)
                .Select(ParseModuleClass)
                .ToArray();

    private static ModuleClass ParseModuleClass(string value) =>
        Enum.TryParse<ModuleClass>(value, ignoreCase: false, out var result)
            ? result
            : throw new InvalidOperationException(
                $"Package policy module class '{value}' is unsupported in {FilePath}.");

    private static string RequireAttribute(XElement element, string attributeName) =>
        element.Attribute(attributeName)?.Value
        ?? throw new InvalidOperationException(
            $"Element '{element.Name.LocalName}' is missing required attribute '{attributeName}' in {FilePath}.");
}
