using Pe.Revit.Scripting.References;
using System.Security;
using System.Text;

namespace Pe.Revit.Scripting.Bootstrap;

public sealed class ScriptProjectGenerator(
    CsProjReader csProjReader
) {
    private const string RuntimeAssemblyName = "Pe.Revit.Scripting";
    private static readonly string[] DefaultSupportAssemblyNames = [
        "Pe.Shared.HostContracts",
        "Pe.Shared.Product",
        "Pe.Shared.RevitData"
    ];
    private const string RevitApiAssemblyName = "RevitAPI";
    private const string RevitApiUiAssemblyName = "RevitAPIUI";
    private const string RevitApiPackageName = "Nice3point.Revit.Api.RevitAPI";
    private const string RevitApiUiPackageName = "Nice3point.Revit.Api.RevitAPIUI";

    private readonly CsProjReader _csProjReader = csProjReader;

    public string GenerateProjectContent(
        string? existingProjectContent,
        string workspaceRoot,
        string revitVersion,
        string targetFramework,
        string runtimeAssemblyPath
    ) {
        var generatedRuntimeReferences = GetGeneratedRuntimeReferences(runtimeAssemblyPath);
        var existingProject = this._csProjReader.Read(existingProjectContent ?? "<Project />", workspaceRoot);
        var preservedReferences = existingProject.References
            .Where(reference => !IsGeneratedRuntimeReference(reference, generatedRuntimeReferences))
            .GroupBy(reference => reference.HintPath, StringComparer.OrdinalIgnoreCase)
            .Select(group => group.First())
            .ToList();
        var preservedPackageReferences = NormalizePackageReferences(existingProject.PackageReferences, revitVersion);
        var usings = NormalizeUsings(existingProject.Usings);

        return CreateProjectContent(
            targetFramework,
            preservedReferences,
            preservedPackageReferences,
            generatedRuntimeReferences,
            usings
        );
    }

    public string GeneratePortableProjectContent(
        string? existingProjectContent,
        string workspaceRoot,
        string targetFramework
    ) {
        var existingProject = this._csProjReader.Read(existingProjectContent ?? "<Project />", workspaceRoot);
        var effectiveTargetFramework = string.IsNullOrWhiteSpace(existingProject.TargetFramework)
            ? targetFramework
            : existingProject.TargetFramework;

        return CreateProjectContent(
            effectiveTargetFramework,
            [],
            NormalizePackageReferences(existingProject.PackageReferences, null),
            [],
            NormalizeUsings(existingProject.Usings)
        );
    }

    private static string CreateProjectContent(
        string targetFramework,
        IReadOnlyList<ScriptReferenceDeclaration> preservedReferences,
        IReadOnlyList<ScriptPackageReference> preservedPackageReferences,
        IReadOnlyList<ScriptReferenceDeclaration> generatedRuntimeReferences,
        IReadOnlyList<string> usings
    ) {
        var builder = new StringBuilder();
        _ = builder.AppendLine("""<Project Sdk="Microsoft.NET.Sdk">""");
        _ = builder.AppendLine("  <PropertyGroup>");
        _ = builder.AppendLine($"    <TargetFramework>{EscapeXml(targetFramework)}</TargetFramework>");
        _ = builder.AppendLine("    <LangVersion>latest</LangVersion>");
        _ = builder.AppendLine("    <PlatformTarget>x64</PlatformTarget>");
        _ = builder.AppendLine("    <EnableDefaultCompileItems>false</EnableDefaultCompileItems>");
        _ = builder.AppendLine("    <OutputType>Library</OutputType>");
        _ = builder.AppendLine("    <ProduceReferenceAssembly>false</ProduceReferenceAssembly>");
        _ = builder.AppendLine("    <ImplicitUsings>enable</ImplicitUsings>");
        _ = builder.AppendLine("    <Nullable>disable</Nullable>");
        _ = builder.AppendLine("  </PropertyGroup>");
        _ = builder.AppendLine();
        _ = builder.AppendLine("  <ItemGroup>");
        _ = builder.AppendLine("    <Compile Include=\"src/**/*.cs\" />");
        _ = builder.AppendLine("  </ItemGroup>");
        _ = builder.AppendLine();
        _ = builder.AppendLine("  <ItemGroup>");
        foreach (var reference in preservedReferences) {
            _ = builder.AppendLine(
                $"    <Reference Include=\"{EscapeXml(string.IsNullOrWhiteSpace(reference.Include) ? Path.GetFileNameWithoutExtension(reference.HintPath) : reference.Include)}\">");
            _ = builder.AppendLine($"      <HintPath>{EscapeXml(reference.HintPath)}</HintPath>");
            _ = builder.AppendLine("    </Reference>");
        }

        _ = builder.AppendLine("  </ItemGroup>");
        _ = builder.AppendLine();
        _ = builder.AppendLine("  <ItemGroup>");
        foreach (var packageReference in preservedPackageReferences) {
            if (string.IsNullOrWhiteSpace(packageReference.Version))
                _ = builder.AppendLine($"    <PackageReference Include=\"{EscapeXml(packageReference.Include)}\" />");
            else
                _ = builder.AppendLine(
                    $"    <PackageReference Include=\"{EscapeXml(packageReference.Include)}\" Version=\"{EscapeXml(packageReference.Version)}\" />");
        }

        _ = builder.AppendLine("  </ItemGroup>");
        _ = builder.AppendLine();
        _ = builder.AppendLine("  <ItemGroup>");
        foreach (var runtimeReference in generatedRuntimeReferences) {
            _ = builder.AppendLine($"    <Reference Include=\"{EscapeXml(runtimeReference.Include)}\">");
            _ = builder.AppendLine($"      <HintPath>{EscapeXml(runtimeReference.HintPath)}</HintPath>");
            _ = builder.AppendLine("      <Private>false</Private>");
            _ = builder.AppendLine("    </Reference>");
        }

        _ = builder.AppendLine("  </ItemGroup>");
        _ = builder.AppendLine();
        _ = builder.AppendLine("  <ItemGroup>");
        foreach (var @using in usings)
            _ = builder.AppendLine($"    <Using Include=\"{EscapeXml(@using)}\" />");
        _ = builder.AppendLine("  </ItemGroup>");
        _ = builder.AppendLine("</Project>");

        return builder.ToString();
    }

    private static IReadOnlyList<ScriptPackageReference> NormalizePackageReferences(
        IReadOnlyList<ScriptPackageReference> packageReferences,
        string? revitVersion
    ) =>
        packageReferences
            .GroupBy(reference => reference.Include, StringComparer.OrdinalIgnoreCase)
            .Select(group => NormalizePackageReference(group.First(), revitVersion))
            .OrderBy(reference => reference.Include, StringComparer.OrdinalIgnoreCase)
            .ToList();

    private static ScriptPackageReference NormalizePackageReference(
        ScriptPackageReference reference,
        string? revitVersion
    ) {
        if (!string.IsNullOrWhiteSpace(revitVersion)
            && IsRevitApiPackage(reference.Include))
            return reference with { Version = $"{revitVersion}.*" };

        return reference;
    }

    private static bool IsRevitApiPackage(string packageName) =>
        string.Equals(packageName, RevitApiPackageName, StringComparison.OrdinalIgnoreCase)
        || string.Equals(packageName, RevitApiUiPackageName, StringComparison.OrdinalIgnoreCase);

    private static IReadOnlyList<string> NormalizeUsings(IReadOnlyList<string> existingUsings) =>
        ScriptFileTemplates.DefaultUsings
            .Concat(existingUsings)
            .Where(@using => !string.IsNullOrWhiteSpace(@using))
            .Distinct(StringComparer.Ordinal)
            .OrderBy(@using => @using, StringComparer.Ordinal)
            .ToList();

    private static bool IsGeneratedRuntimeReference(
        ScriptReferenceDeclaration reference,
        IReadOnlyList<ScriptReferenceDeclaration> generatedRuntimeReferences
    ) {
        if (generatedRuntimeReferences.Any(generatedReference =>
                string.Equals(reference.Include, generatedReference.Include, StringComparison.OrdinalIgnoreCase)))
            return true;

        return generatedRuntimeReferences.Any(generatedReference =>
            string.Equals(
                Path.GetFullPath(reference.HintPath),
                Path.GetFullPath(generatedReference.HintPath),
                StringComparison.OrdinalIgnoreCase
            ));
    }

    private static string EscapeXml(string value) =>
        SecurityElement.Escape(value) ?? string.Empty;

    private static IReadOnlyList<ScriptReferenceDeclaration> GetGeneratedRuntimeReferences(string runtimeAssemblyPath) {
        var references = new List<ScriptReferenceDeclaration> {
            new(RuntimeAssemblyName, runtimeAssemblyPath)
        };
        references.AddRange(GetSiblingPeRevitReferences(runtimeAssemblyPath));
        references.AddRange(GetDefaultSupportReferences(runtimeAssemblyPath));

        var revitApiAssemblyPath = TryResolveAssemblyPath(RevitApiAssemblyName, runtimeAssemblyPath);
        if (!string.IsNullOrWhiteSpace(revitApiAssemblyPath))
            references.Add(new ScriptReferenceDeclaration(RevitApiAssemblyName, revitApiAssemblyPath));

        var revitApiUiAssemblyPath = TryResolveAssemblyPath(RevitApiUiAssemblyName, runtimeAssemblyPath);
        if (!string.IsNullOrWhiteSpace(revitApiUiAssemblyPath))
            references.Add(new ScriptReferenceDeclaration(RevitApiUiAssemblyName, revitApiUiAssemblyPath));

        return references
            .GroupBy(reference => reference.Include, StringComparer.OrdinalIgnoreCase)
            .Select(group => group.First())
            .ToList();
    }

    private static IReadOnlyList<ScriptReferenceDeclaration> GetSiblingPeRevitReferences(string runtimeAssemblyPath) {
        var runtimeDirectory = Path.GetDirectoryName(runtimeAssemblyPath);
        if (string.IsNullOrWhiteSpace(runtimeDirectory) || !Directory.Exists(runtimeDirectory))
            return [];

        return Directory
            .EnumerateFiles(runtimeDirectory, "Pe.Revit*.dll", SearchOption.TopDirectoryOnly)
            .Where(path => !path.EndsWith("Pe.Revit.Tests.dll", StringComparison.OrdinalIgnoreCase))
            .Select(path => new ScriptReferenceDeclaration(
                Path.GetFileNameWithoutExtension(path),
                path
            ))
            .Where(reference =>
                !string.IsNullOrWhiteSpace(reference.Include)
                && !string.IsNullOrWhiteSpace(reference.HintPath))
            .OrderBy(reference => reference.Include, StringComparer.OrdinalIgnoreCase)
            .ToList();
    }

    private static IReadOnlyList<ScriptReferenceDeclaration> GetDefaultSupportReferences(string runtimeAssemblyPath) =>
        DefaultSupportAssemblyNames
            .Select(assemblyName => {
                var assemblyPath = TryResolveAssemblyPath(assemblyName, runtimeAssemblyPath);
                return string.IsNullOrWhiteSpace(assemblyPath)
                    ? null
                    : new ScriptReferenceDeclaration(assemblyName, assemblyPath);
            })
            .OfType<ScriptReferenceDeclaration>()
            .OrderBy(reference => reference.Include, StringComparer.OrdinalIgnoreCase)
            .ToList();

    private static string? TryResolveAssemblyPath(
        string assemblyName,
        string runtimeAssemblyPath
    ) {
        var loadedAssemblyPath = AppDomain.CurrentDomain.GetAssemblies()
            .Where(assembly => !assembly.IsDynamic)
            .Where(assembly => string.Equals(
                assembly.GetName().Name,
                assemblyName,
                StringComparison.OrdinalIgnoreCase
            ))
            .Select(assembly => assembly.Location)
            .FirstOrDefault(path => !string.IsNullOrWhiteSpace(path) && File.Exists(path));
        if (!string.IsNullOrWhiteSpace(loadedAssemblyPath))
            return loadedAssemblyPath;

        var siblingAssemblyPath = Path.Combine(
            Path.GetDirectoryName(runtimeAssemblyPath) ?? string.Empty,
            $"{assemblyName}.dll"
        );
        return File.Exists(siblingAssemblyPath) ? siblingAssemblyPath : null;
    }
}
