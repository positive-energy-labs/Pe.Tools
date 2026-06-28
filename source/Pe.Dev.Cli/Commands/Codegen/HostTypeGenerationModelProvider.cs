using System.Text.RegularExpressions;
using Pe.Shared.ApsAuth;
using Pe.Shared.HostContracts.Operations;
using Pe.Shared.RevitData;
using Pe.Shared.StorageRuntime;
using TypeGen.Core;
using TypeGen.Core.Converters;
using TypeGen.Core.Generator;

namespace Pe.Dev.Cli.Codegen;

internal static class HostTypeGenerationModelProvider {
    private const string Configuration = "Debug.R25";
    private static readonly Regex RelativeModuleSpecifierPattern = new(
        "(?<prefix>\\bfrom\\s+|export\\s+\\*\\s+from\\s+)(?<quote>[\"'])(?<path>\\.{1,2}/[^\"']+?)(?<quote2>[\"'])",
        RegexOptions.Compiled
    );

    public static Task<int> EnsureFreshBuildAsync(CodegenPaths paths, CancellationToken cancellationToken) =>
        ForegroundProcessRunner.RunAsync(
            SafeDotNetProcess.Create(
                paths.RepoRoot,
                "build",
                paths.PeDevCliProjectPath,
                "-c",
                Configuration
            ),
            cancellationToken
        );

    public static GeneratedHostTypeModel Load(CodegenPaths paths) {
        var generatedFiles = new List<GeneratedProjectionFile>();
        var generator = new Generator(CreateOptions(paths.HostTypeGenDirectory));
        generator.UnsubscribeDefaultFileContentGeneratedHandler();
        generator.FileContentGenerated += (_, args) => {
            var filePath = Path.GetFullPath(args.FilePath);
            var normalizedContent = NormalizeLineEndings(NormalizeNodeNextModuleSpecifiers(args.FileContent));
            generatedFiles.Add(new GeneratedProjectionFile(filePath, normalizedContent));
        };

        var sourceAssemblies = LoadSourceAssemblies();
        generator.Generate(sourceAssemblies);

        // Only enums ship as TS types. Object types are inferred from the generated
        // zod schemas (z.infer in host-zod.generated.ts), so interface files would
        // only duplicate them — and lossily (zod captures nullability TypeGen drops).
        var enumFiles = generatedFiles
            .Where(file => !IsIndexFile(file.Path)
                           && file.Content.Contains("export enum", StringComparison.Ordinal))
            .OrderBy(file => file.Path, StringComparer.OrdinalIgnoreCase)
            .ToArray();
        var indexFile = CreateEnumIndexFile(generatedFiles, enumFiles);

        // Open generic definitions have no concrete wire shape, so zod can't emit a
        // schema for them. Operations expose concrete DTOs; exclude any annotated
        // generic from the schema/type surface.
        var exportedTypes = sourceAssemblies
            .SelectMany(assembly => assembly.GetTypes())
            .Where(IsTypeScriptExportedType)
            .Where(type => !string.IsNullOrWhiteSpace(type.FullName))
            .Where(type => !type.IsGenericTypeDefinition && !type.ContainsGenericParameters)
            .GroupBy(type => type.FullName!, StringComparer.Ordinal)
            .ToDictionary(group => group.Key, group => group.First().Name, StringComparer.Ordinal);

        return new GeneratedHostTypeModel(
            enumFiles.Append(indexFile).ToArray(),
            exportedTypes
        );
    }

    public static IReadOnlyList<Type> ResolveExportedTypes(
        IReadOnlyDictionary<string, string> exportedTypeNames
    ) => LoadSourceAssemblies()
        .SelectMany(assembly => assembly.GetTypes())
        .Where(IsTypeScriptExportedType)
        .Where(type => type.FullName != null && exportedTypeNames.ContainsKey(type.FullName))
        .ToArray();

    private static bool IsIndexFile(string path) =>
        string.Equals(Path.GetFileName(path), "index.ts", StringComparison.OrdinalIgnoreCase);

    private static GeneratedProjectionFile CreateEnumIndexFile(
        IReadOnlyList<GeneratedProjectionFile> generatedFiles,
        IReadOnlyList<GeneratedProjectionFile> enumFiles
    ) {
        var indexFile = generatedFiles.Single(file => IsIndexFile(file.Path));
        var lines = enumFiles
            .Select(file => $"export * from \"./{Path.GetFileNameWithoutExtension(file.Path)}.js\";")
            .OrderBy(line => line, StringComparer.Ordinal);
        return indexFile with { Content = string.Join("\n", lines).TrimEnd() + "\n" };
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
        typeof(ApsTokenRequest).Assembly,
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

            return $"{match.Groups["prefix"].Value}\"{path}.js\"";
        }
    );

    private static string NormalizeLineEndings(string content) {
        var normalized = content.Replace("\r\n", "\n").Replace("\r", "\n");
        return normalized.EndsWith('\n') ? normalized : normalized + "\n";
    }

    internal sealed record GeneratedProjectionFile(string Path, string Content);

    internal sealed record GeneratedHostTypeModel(
        IReadOnlyList<GeneratedProjectionFile> Files,
        IReadOnlyDictionary<string, string> ExportedTypeNames
    );
}
