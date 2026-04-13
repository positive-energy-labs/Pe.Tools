using System.Text;
using Pe.Revit.Scripting.References;

namespace Pe.Revit.Scripting.Bootstrap;

public sealed class ScriptProjectGenerator(
    CsProjReader csProjReader
) {
    private const string RuntimeAssemblyName = "Pe.Revit.Scripting";

    private static readonly HashSet<string> GeneratedPackageNames = new(StringComparer.OrdinalIgnoreCase) {
        "Nice3point.Revit.Api.RevitAPI",
        "Nice3point.Revit.Api.RevitAPIUI"
    };

    private readonly CsProjReader _csProjReader = csProjReader;

    public string GenerateProjectContent(
        string? existingProjectContent,
        string workspaceRoot,
        string revitVersion,
        string targetFramework,
        string runtimeAssemblyPath
    ) {
        var existingProject = this._csProjReader.Read(existingProjectContent ?? "<Project />", workspaceRoot);
        var preservedReferences = existingProject.References
            .Where(reference => !IsGeneratedRuntimeReference(reference, runtimeAssemblyPath))
            .GroupBy(reference => reference.HintPath, StringComparer.OrdinalIgnoreCase)
            .Select(group => group.First())
            .ToList();
        var preservedPackageReferences = existingProject.PackageReferences
            .Where(reference => !GeneratedPackageNames.Contains(reference.Include))
            .GroupBy(reference => reference.Include, StringComparer.OrdinalIgnoreCase)
            .Select(group => group.First())
            .ToList();

        var builder = new StringBuilder();
        builder.AppendLine("""<Project Sdk="Microsoft.NET.Sdk">""");
        builder.AppendLine("  <PropertyGroup>");
        builder.AppendLine($"    <TargetFramework>{targetFramework}</TargetFramework>");
        builder.AppendLine("    <LangVersion>latest</LangVersion>");
        builder.AppendLine("    <PlatformTarget>x64</PlatformTarget>");
        builder.AppendLine("    <EnableDefaultCompileItems>true</EnableDefaultCompileItems>");
        builder.AppendLine("    <OutputType>Library</OutputType>");
        builder.AppendLine("    <ProduceReferenceAssembly>false</ProduceReferenceAssembly>");
        builder.AppendLine("    <ImplicitUsings>enable</ImplicitUsings>");
        builder.AppendLine("    <Nullable>disable</Nullable>");
        builder.AppendLine("  </PropertyGroup>");
        builder.AppendLine();
        builder.AppendLine("  <ItemGroup>");
        foreach (var reference in preservedReferences) {
            builder.AppendLine($"    <Reference Include=\"{EscapeXml(string.IsNullOrWhiteSpace(reference.Include) ? Path.GetFileNameWithoutExtension(reference.HintPath) : reference.Include)}\">");
            builder.AppendLine($"      <HintPath>{EscapeXml(reference.HintPath)}</HintPath>");
            builder.AppendLine("    </Reference>");
        }

        builder.AppendLine("  </ItemGroup>");
        builder.AppendLine();
        builder.AppendLine("  <ItemGroup>");
        foreach (var packageReference in preservedPackageReferences) {
            if (string.IsNullOrWhiteSpace(packageReference.Version))
                builder.AppendLine($"    <PackageReference Include=\"{EscapeXml(packageReference.Include)}\" />");
            else
                builder.AppendLine($"    <PackageReference Include=\"{EscapeXml(packageReference.Include)}\" Version=\"{EscapeXml(packageReference.Version)}\" />");
        }

        builder.AppendLine("  </ItemGroup>");
        builder.AppendLine();
        builder.AppendLine("  <ItemGroup>");
        builder.AppendLine($"    <PackageReference Include=\"Nice3point.Revit.Api.RevitAPI\" Version=\"{EscapeXml(revitVersion)}.*\" />");
        builder.AppendLine($"    <PackageReference Include=\"Nice3point.Revit.Api.RevitAPIUI\" Version=\"{EscapeXml(revitVersion)}.*\" />");
        builder.AppendLine("  </ItemGroup>");
        builder.AppendLine();
        builder.AppendLine("  <ItemGroup>");
        builder.AppendLine($"    <Reference Include=\"{RuntimeAssemblyName}\">");
        builder.AppendLine($"      <HintPath>{EscapeXml(runtimeAssemblyPath)}</HintPath>");
        builder.AppendLine("    </Reference>");
        builder.AppendLine("  </ItemGroup>");
        builder.AppendLine();
        builder.AppendLine("  <ItemGroup>");
        foreach (var @using in ScriptFileTemplates.DefaultUsings)
            builder.AppendLine($"    <Using Include=\"{EscapeXml(@using)}\" />");
        builder.AppendLine("  </ItemGroup>");
        builder.AppendLine("</Project>");

        return builder.ToString();
    }

    private static bool IsGeneratedRuntimeReference(
        ScriptReferenceDeclaration reference,
        string runtimeAssemblyPath
    ) {
        if (reference.Include.Equals(RuntimeAssemblyName, StringComparison.OrdinalIgnoreCase))
            return true;

        return string.Equals(
            Path.GetFullPath(reference.HintPath),
            Path.GetFullPath(runtimeAssemblyPath),
            StringComparison.OrdinalIgnoreCase
        );
    }

    private static string EscapeXml(string value) =>
        System.Security.SecurityElement.Escape(value) ?? string.Empty;
}
