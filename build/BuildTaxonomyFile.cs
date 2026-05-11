using System.Xml.Linq;

namespace Build;

internal static class BuildTaxonomyFile {
    private const string FilePath = BuildAuthoredPaths.TaxonomyFilePath;

    public static BuildTaxonomy Load(string repositoryRoot) {
        var path = Path.Combine(repositoryRoot, FilePath);
        var document = XDocument.Load(path);

        var projects = document.Descendants()
            .Where(element => string.Equals(element.Name.LocalName, "PeProjectTaxonomy", StringComparison.Ordinal))
            .Select(ParseProject)
            .OrderBy(project => project.ProjectName, StringComparer.Ordinal)
            .ToArray();

        return new BuildTaxonomy(projects);
    }

    private static BuildProjectIdentity ParseProject(XElement element) {
        var projectName = RequireAttribute(element, "Include");
        var declaredProjectName = RequireAttribute(element, "ProjectName");
        if (!string.Equals(projectName, declaredProjectName, StringComparison.Ordinal)) {
            throw new InvalidOperationException(
                $"Project taxonomy entry '{projectName}' must keep Include and ProjectName identical in {FilePath}."
            );
        }

        return new BuildProjectIdentity(
            projectName,
            ParseEnum<ModuleClass>(RequireAttribute(element, "ModuleClass"), projectName, "ModuleClass"),
            ParseEnum<ProductClass>(RequireAttribute(element, "ProductClass"), projectName, "ProductClass"),
            ParseBool(RequireAttribute(element, "RevitAware"), projectName, "RevitAware"),
            ParseBool(RequireAttribute(element, "SupportsRevitYear"), projectName, "SupportsRevitYear"),
            RequireAttribute(element, "TargetFrameworkClass"),
            ParseVerifyTargets(RequireAttribute(element, "SupportsAttachedRrd"), RequireAttribute(element, "SupportsFreshRevitProcess"))
        );
    }

    private static IReadOnlyList<VerifyTarget> ParseVerifyTargets(string supportsAttachedRrd, string supportsFreshRevitProcess) {
        var targets = new List<VerifyTarget>();
        if (ParseBool(supportsAttachedRrd, "PeProjectTaxonomy", "SupportsAttachedRrd"))
            targets.Add(VerifyTarget.AttachedRrd);
        if (ParseBool(supportsFreshRevitProcess, "PeProjectTaxonomy", "SupportsFreshRevitProcess"))
            targets.Add(VerifyTarget.FreshRevitProcess);

        return targets;
    }

    private static TEnum ParseEnum<TEnum>(string value, string projectName, string attributeName)
        where TEnum : struct, Enum =>
        Enum.TryParse<TEnum>(value, ignoreCase: false, out var result)
            ? result
            : throw new InvalidOperationException(
                $"Project '{projectName}' has unsupported {attributeName} value '{value}' in {FilePath}.");

    private static bool ParseBool(string value, string projectName, string attributeName) =>
        bool.TryParse(value, out var result)
            ? result
            : throw new InvalidOperationException(
                $"Project '{projectName}' has unsupported {attributeName} value '{value}' in {FilePath}.");

    private static string RequireAttribute(XElement element, string attributeName) =>
        element.Attribute(attributeName)?.Value
        ?? throw new InvalidOperationException(
            $"Element '{element.Name.LocalName}' is missing required attribute '{attributeName}' in {FilePath}.");
}
