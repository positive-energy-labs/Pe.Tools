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

        var exportedTypes = sourceAssemblies
            .SelectMany(assembly => assembly.GetTypes())
            .Where(IsTypeScriptExportedType)
            .Where(type => !string.IsNullOrWhiteSpace(type.FullName))
            .ToDictionary(type => type.FullName!, type => type.Name, StringComparer.Ordinal);

        return new GeneratedHostTypeModel(
            generatedFiles
                .OrderBy(file => file.Path, StringComparer.OrdinalIgnoreCase)
                .ToArray(),
            exportedTypes
        );
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
