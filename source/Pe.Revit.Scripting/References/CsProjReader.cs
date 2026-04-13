using System.Xml.Linq;

namespace Pe.Revit.Scripting.References;

public sealed class CsProjReader {
    internal ScriptProjectFileModel Read(
        string projectContent,
        string? projectDirectory = null
    ) {
        if (string.IsNullOrWhiteSpace(projectContent))
            projectContent = "<Project />";

        var document = XDocument.Parse(projectContent, LoadOptions.PreserveWhitespace);

        return new ScriptProjectFileModel(
            projectContent,
            projectDirectory,
            this.ReadTargetFramework(document),
            this.ReadReferences(document),
            this.ReadPackageReferences(document)
        );
    }

    private string ReadTargetFramework(XDocument document) {
        var targetFramework = document
            .Descendants()
            .FirstOrDefault(node => node.Name.LocalName == "TargetFramework")
            ?.Value
            ?.Trim();
        if (!string.IsNullOrWhiteSpace(targetFramework))
            return targetFramework;

        var targetFrameworks = document
            .Descendants()
            .FirstOrDefault(node => node.Name.LocalName == "TargetFrameworks")
            ?.Value
            ?.Split(';', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries)
            .FirstOrDefault();

        return targetFrameworks ?? string.Empty;
    }

    private IReadOnlyList<ScriptReferenceDeclaration> ReadReferences(XDocument document) =>
        document
            .Descendants()
            .Where(node => node.Name.LocalName == "Reference")
            .Select(node => new ScriptReferenceDeclaration(
                node.Attribute("Include")?.Value?.Trim() ?? string.Empty,
                node.Elements().FirstOrDefault(child => child.Name.LocalName == "HintPath")?.Value?.Trim() ?? string.Empty
            ))
            .Where(reference => !string.IsNullOrWhiteSpace(reference.HintPath))
            .ToList();

    private IReadOnlyList<ScriptPackageReference> ReadPackageReferences(XDocument document) =>
        document
            .Descendants()
            .Where(node => node.Name.LocalName == "PackageReference")
            .Select(node => new ScriptPackageReference(
                node.Attribute("Include")?.Value?.Trim() ?? string.Empty,
                node.Attribute("Version")?.Value?.Trim()
                ?? node.Elements().FirstOrDefault(child => child.Name.LocalName == "Version")?.Value?.Trim()
            ))
            .Where(reference => !string.IsNullOrWhiteSpace(reference.Include))
            .ToList();
}
