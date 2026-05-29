using System.Text.RegularExpressions;
using Pe.Shared.HostContracts.Operations;
using Pe.Shared.RevitData;
using Pe.Shared.StorageRuntime;
using TypeGen.Core;
using TypeGen.Core.Converters;
using TypeGen.Core.Generator;

namespace Pe.Dev.Cli;

internal static class HostTypeGenerationModelProvider {
    private const string Configuration = "Debug.R25";
    private static readonly Regex RelativeModuleSpecifierPattern = new(
        "(?<prefix>\\bfrom\\s+|export\\s+\\*\\s+from\\s+)(?<quote>[\"'])(?<path>\\.{1,2}/[^\"']+?)(?<quote2>[\"'])",
        RegexOptions.Compiled
    );
    private static readonly Regex ExportedTypeDeclarationPattern = new(
        "\\bexport\\s+(?:interface|class|enum)\\s+(?<name>[A-Za-z_][A-Za-z0-9_]*)",
        RegexOptions.Compiled
    );

    public static Task<int> EnsureFreshBuildAsync(string repoRoot, CancellationToken cancellationToken) =>
        ForegroundProcessRunner.RunAsync(
            SafeDotNetProcess.Create(
                repoRoot,
                "build",
                Path.Combine(repoRoot, "source", "Pe.Dev.Cli", "Pe.Dev.Cli.csproj"),
                "-c",
                Configuration
            ),
            cancellationToken
        );

    public static GeneratedHostTypeModel Load(string repoRoot) {
        var outputDirectory = Path.Combine(repoRoot, "source", "pea", "app", "generated", "host-types");
        var generatedFiles = new List<GeneratedProjectionFile>();
        var generator = new Generator(CreateOptions(outputDirectory));
        generator.UnsubscribeDefaultFileContentGeneratedHandler();
        generator.FileContentGenerated += (_, args) => {
            var filePath = Path.GetFullPath(args.FilePath);
            var normalizedContent = NormalizeNodeNextModuleSpecifiers(args.FileContent);
            generatedFiles.Add(new GeneratedProjectionFile(filePath, normalizedContent));
        };

        var sourceAssemblies = LoadSourceAssemblies();
        generator.Generate(sourceAssemblies);

        var prunedFiles = PruneToTypeScriptClientSlice(generatedFiles);
        var includedTypeNames = prunedFiles
            .Select(file => TryGetExportedTypeName(file.Content))
            .Where(typeName => typeName != null)
            .ToHashSet(StringComparer.Ordinal);
        var exportedTypes = sourceAssemblies
            .SelectMany(assembly => assembly.GetTypes())
            .Where(IsTypeScriptExportedType)
            .Where(type => !string.IsNullOrWhiteSpace(type.FullName))
            .Where(type => includedTypeNames.Contains(type.Name))
            .ToDictionary(type => type.FullName!, type => type.Name, StringComparer.Ordinal);

        return new GeneratedHostTypeModel(
            prunedFiles
                .OrderBy(file => file.Path, StringComparer.OrdinalIgnoreCase)
                .ToArray(),
            exportedTypes
        );
    }

    private static IReadOnlyList<GeneratedProjectionFile> PruneToTypeScriptClientSlice(
        IReadOnlyList<GeneratedProjectionFile> generatedFiles
    ) {
        var indexFile = generatedFiles.Single(file =>
            string.Equals(Path.GetFileName(file.Path), "index.ts", StringComparison.OrdinalIgnoreCase));
        var filesByPath = generatedFiles
            .Where(file => !string.Equals(file.Path, indexFile.Path, StringComparison.OrdinalIgnoreCase))
            .ToDictionary(file => file.Path, StringComparer.OrdinalIgnoreCase);
        var filesByTypeName = filesByPath.Values
            .Select(file => new { File = file, TypeName = TryGetExportedTypeName(file.Content) })
            .Where(entry => entry.TypeName != null)
            .ToDictionary(entry => entry.TypeName!, entry => entry.File, StringComparer.Ordinal);
        var rootTypeNames = GetTypeScriptClientRootTypes()
            .Select(type => type.Name)
            .Distinct(StringComparer.Ordinal)
            .OrderBy(typeName => typeName, StringComparer.Ordinal)
            .ToArray();
        var missingRoots = rootTypeNames
            .Where(typeName => !filesByTypeName.ContainsKey(typeName))
            .ToArray();
        if (missingRoots.Length != 0)
            throw new InvalidOperationException(
                $"Generated host-types are missing client root types: {string.Join(", ", missingRoots)}"
            );

        var includedPaths = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        foreach (var rootTypeName in rootTypeNames)
            IncludeFile(filesByTypeName[rootTypeName], filesByPath, includedPaths);

        var prunedIndex = CreatePrunedIndexFile(indexFile, includedPaths);
        return generatedFiles
            .Where(file => includedPaths.Contains(file.Path))
            .Append(prunedIndex)
            .ToArray();
    }

    private static IReadOnlyList<Type> GetTypeScriptClientRootTypes() => HostOperationsCatalog.TypeScriptClient.Groups
        .SelectMany(group => group.Operations)
        .SelectMany(operation => new[] { operation.Definition.RequestType, operation.Definition.ResponseType })
        .Concat(HostOperationsCatalog.TypeScriptClientExtraTypeRoots)
        .Where(type => type != typeof(NoRequest))
        .ToArray();

    private static string? TryGetExportedTypeName(string content) {
        var match = ExportedTypeDeclarationPattern.Match(content);
        return match.Success ? match.Groups["name"].Value : null;
    }

    private static void IncludeFile(
        GeneratedProjectionFile file,
        IReadOnlyDictionary<string, GeneratedProjectionFile> filesByPath,
        HashSet<string> includedPaths
    ) {
        if (!includedPaths.Add(file.Path))
            return;

        foreach (var dependencyPath in GetGeneratedFileDependencies(file)) {
            if (filesByPath.TryGetValue(dependencyPath, out var dependency))
                IncludeFile(dependency, filesByPath, includedPaths);
        }
    }

    private static IEnumerable<string> GetGeneratedFileDependencies(GeneratedProjectionFile file) {
        var baseDirectory = Path.GetDirectoryName(file.Path)!;
        foreach (Match match in RelativeModuleSpecifierPattern.Matches(file.Content)) {
            var relativePath = match.Groups["path"].Value;
            if (!relativePath.StartsWith("./", StringComparison.Ordinal))
                continue;

            var generatedRelativePath = Path.ChangeExtension(
                relativePath.Replace('/', Path.DirectorySeparatorChar),
                ".ts"
            );
            yield return Path.GetFullPath(Path.Combine(baseDirectory, generatedRelativePath));
        }
    }

    private static GeneratedProjectionFile CreatePrunedIndexFile(
        GeneratedProjectionFile indexFile,
        IReadOnlySet<string> includedPaths
    ) {
        var includedSpecifiers = includedPaths
            .Select(path => $"./{Path.GetFileNameWithoutExtension(path)}.js")
            .ToHashSet(StringComparer.Ordinal);
        var lines = indexFile.Content.Split(["\r\n", "\n"], StringSplitOptions.None);
        var prunedLines = lines
            .Where(line => !line.StartsWith("export *", StringComparison.Ordinal)
                           || ShouldKeepIndexExport(line, includedSpecifiers))
            .ToArray();
        return indexFile with {
            Content = string.Join(Environment.NewLine, prunedLines).TrimEnd() + Environment.NewLine
        };
    }

    private static bool ShouldKeepIndexExport(string line, IReadOnlySet<string> includedSpecifiers) {
        var match = RelativeModuleSpecifierPattern.Match(line);
        return match.Success && includedSpecifiers.Contains(match.Groups["path"].Value);
    }

    private static GeneratorOptions CreateOptions(string outputDirectory) {
        var options = new GeneratorOptions {
            BaseOutputDirectory = outputDirectory,
            CreateIndexFile = true,
            EnumStringInitializers = true,
            SingleQuotes = false,
            TabLength = 2,
            ExplicitPublicAccessor = false,
            UseImportType = true,
            CsNullableTranslation = StrictNullTypeUnionFlags.Optional
        };
        options.FileNameConverters.Add(new PascalCaseToKebabCaseConverter());
        options.PropertyNameConverters.Add(new PascalCaseToCamelCaseConverter());
        return options;
    }

    private static IEnumerable<System.Reflection.Assembly> LoadSourceAssemblies() => [
        typeof(HostOperationsCatalog).Assembly,
        typeof(GlobalStorage).Assembly,
        typeof(RevitDataIssue).Assembly
    ];

    private static bool IsTypeScriptExportedType(Type type) =>
        type.CustomAttributes.Any(attribute =>
            attribute.AttributeType.FullName is
                "TypeGen.Core.TypeAnnotations.ExportTsInterfaceAttribute"
                or "TypeGen.Core.TypeAnnotations.ExportTsClassAttribute"
                or "TypeGen.Core.TypeAnnotations.ExportTsEnumAttribute"
        );

    private static string NormalizeNodeNextModuleSpecifiers(string content) => RelativeModuleSpecifierPattern.Replace(
        content,
        match => {
            var path = match.Groups["path"].Value;
            if (Path.HasExtension(path))
                return match.Value;

            var quote = match.Groups["quote"].Value;
            return $"{match.Groups["prefix"].Value}{quote}{path}.js{quote}";
        }
    );

    internal sealed record GeneratedProjectionFile(string Path, string Content);

    internal sealed record GeneratedHostTypeModel(
        IReadOnlyList<GeneratedProjectionFile> Files,
        IReadOnlyDictionary<string, string> ExportedTypeNames
    );
}
