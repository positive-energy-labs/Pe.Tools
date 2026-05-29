using Pe.Dev.RevitAutomation;
using Pe.Shared.HostContracts.Operations;
using System.Reflection;
using System.Text;
using System.Text.Json;

namespace Pe.Dev.Cli;

internal static class HostTypeScriptClientProjection {
    private static readonly JsonSerializerOptions JsonOptions = new(JsonSerializerDefaults.Web);

    public static async Task<int> RunAsync(
        IReadOnlyList<string> forwardedArguments,
        string? repoRootOverride,
        CancellationToken cancellationToken
    ) {
        HostTypeScriptClientOptions options;
        string repoRoot;
        try {
            options = HostTypeScriptClientOptions.Parse(forwardedArguments);
            repoRoot = RepoRootResolver.Resolve(repoRootOverride);
        } catch (Exception ex) {
            Console.Error.WriteLine(ex.Message);
            return 10;
        }

        var buildExit = await HostTypeGenerationModelProvider.EnsureFreshBuildAsync(repoRoot, cancellationToken);
        if (buildExit != 0)
            return buildExit;

        HostTypeGenerationModelProvider.GeneratedHostTypeModel generatedHostTypeModel;
        try {
            generatedHostTypeModel = HostTypeGenerationModelProvider.Load(repoRoot);
        } catch (Exception ex) {
            Console.Error.WriteLine($"Host TypeScript client generation failed: {ex.Message}");
            return 1;
        }

        GeneratedProjectionFile[] generatedFiles;
        try {
            generatedFiles = GenerateFiles(repoRoot, generatedHostTypeModel);
        } catch (Exception ex) {
            Console.Error.WriteLine($"Host TypeScript client generation failed: {ex.Message}");
            return 1;
        }

        if (options.Check)
            return await CheckAsync(repoRoot, generatedFiles, cancellationToken);

        foreach (var extraFile in EnumerateCommittedGeneratedFiles(repoRoot).Where(path => generatedFiles.All(file => !string.Equals(file.Path, path, StringComparison.OrdinalIgnoreCase)))) {
            File.Delete(extraFile);
            Console.WriteLine($"Deleted {Path.GetRelativePath(repoRoot, extraFile)}");
        }

        foreach (var generatedFile in generatedFiles) {
            Directory.CreateDirectory(Path.GetDirectoryName(generatedFile.Path)!);
            await File.WriteAllTextAsync(generatedFile.Path, generatedFile.Content, cancellationToken);
            Console.WriteLine($"Generated {Path.GetRelativePath(repoRoot, generatedFile.Path)}");
        }

        return 0;
    }

    private static async Task<int> CheckAsync(
        string repoRoot,
        IReadOnlyList<GeneratedProjectionFile> generatedFiles,
        CancellationToken cancellationToken
    ) {
        var staleFiles = new List<string>();
        var expectedPaths = generatedFiles.Select(file => Path.GetFullPath(file.Path)).ToHashSet(StringComparer.OrdinalIgnoreCase);
        foreach (var generatedFile in generatedFiles) {
            var relativePath = Path.GetRelativePath(repoRoot, generatedFile.Path);
            if (!File.Exists(generatedFile.Path)) {
                staleFiles.Add($"{relativePath} (missing)");
                continue;
            }

            var existingContent = await File.ReadAllTextAsync(generatedFile.Path, cancellationToken);
            if (!string.Equals(existingContent, generatedFile.Content, StringComparison.Ordinal))
                staleFiles.Add(relativePath);
        }

        foreach (var extraFile in EnumerateCommittedGeneratedFiles(repoRoot).Where(path => !expectedPaths.Contains(path)))
            staleFiles.Add($"{Path.GetRelativePath(repoRoot, extraFile)} (extra)");

        if (staleFiles.Count == 0) {
            Console.WriteLine("Generated Host TypeScript client is current.");
            return 0;
        }

        Console.Error.WriteLine("Generated Host TypeScript client is stale:");
        foreach (var staleFile in staleFiles)
            Console.Error.WriteLine($"  {staleFile}");
        Console.Error.WriteLine("Run `pe-dev codegen sync --target host-client` to update it.");
        return 1;
    }

    private static GeneratedProjectionFile[] GenerateFiles(
        string repoRoot,
        HostTypeGenerationModelProvider.GeneratedHostTypeModel generatedHostTypeModel
    ) {
        ValidateProjectedTypeSymbols(generatedHostTypeModel.ExportedTypeNames);
        var generatedDirectory = Path.Combine(repoRoot, "source", "pea", "app", "generated");
        return [
            new GeneratedProjectionFile(
                Path.Combine(generatedDirectory, "host-client.generated.ts"),
                GenerateTypeScriptClient(generatedHostTypeModel.ExportedTypeNames)
            ),
            new GeneratedProjectionFile(
                Path.Combine(generatedDirectory, "host-operations.generated.ts"),
                GenerateHostOperationCatalog(generatedHostTypeModel.ExportedTypeNames)
            )
        ];
    }

    private static string GenerateTypeScriptClient(IReadOnlyDictionary<string, string> exportedTypeNames) => $$"""
        // <auto-generated />
        // Generated by `pe-dev codegen sync --target host-client` from HostOperationsCatalog.TypeScriptClient.

        import { sendJson, type HostOperationDefinition, type PeHostClientOptions } from "../host-client-runtime.js";
        import type {
        {{RenderTypeScriptImports(exportedTypeNames)}}
        } from "./host-types/index.js";

        {{RenderTypeScriptOperationGroups()}}
        """;

    private static string GenerateHostOperationCatalog(IReadOnlyDictionary<string, string> exportedTypeNames) => $$"""
        // <auto-generated />
        // Generated by `pe-dev codegen sync --target host-client` from HostOperationsCatalog.PublicHttp.

        import type { HostOperationDefinition } from "../host-client-runtime.js";

        export const hostOperations = {
        {{RenderHostOperationCatalogEntries(exportedTypeNames)}}
        } as const satisfies Record<string, HostOperationDefinition>;

        export type HostOperationKey = keyof typeof hostOperations;
        """;

    private static string RenderHostOperationCatalogEntries(IReadOnlyDictionary<string, string> exportedTypeNames) {
        var builder = new StringBuilder();
        foreach (var operation in HostOperationsCatalog.PublicHttp.OrderBy(definition => definition.Key, StringComparer.Ordinal)) {
            var metadata = operation.AgentMetadata;
            _ = builder.AppendLine($"  {ToJsonString(operation.Key)}: {{");
            AppendOperationDefinitionProperties(builder, operation, exportedTypeNames);
            _ = builder.AppendLine($"    displayName: {ToJsonString(operation.DisplayName ?? operation.Key)},");
            _ = builder.AppendLine($"    domain: {ToJsonString(metadata.Domain)},");
            _ = builder.AppendLine($"    summary: {ToJsonString(metadata.Summary)},");
            _ = builder.AppendLine($"    tags: {ToJsonString(metadata.Tags)},");
            _ = builder.AppendLine($"    intent: {ToJsonString(metadata.Intent.ToString())},");
            _ = builder.AppendLine($"    requiresBridge: {ToJsonBool(metadata.RequiresBridge)},");
            _ = builder.AppendLine($"    requiresActiveDocument: {ToJsonBool(metadata.RequiresActiveDocument)},");
            _ = builder.AppendLine($"    family: {ToJsonString(metadata.Family.ToString())},");
            _ = builder.AppendLine($"    revitLayer: {ToJsonString(metadata.RevitLayer?.ToString())},");
            _ = builder.AppendLine($"    domainNoun: {ToJsonString(metadata.DomainNoun)},");
            _ = builder.AppendLine($"    resultGrain: {ToJsonString(metadata.ResultGrain.ToString())},");
            _ = builder.AppendLine($"    costTier: {ToJsonString(metadata.CostTier.ToString())},");
            _ = builder.AppendLine($"    singleFlightGroup: {ToJsonString(metadata.SingleFlightGroup)},");
            _ = builder.AppendLine($"    requestExamples: {ToJson(metadata.RequestExamples)},");
            _ = builder.AppendLine($"    boundedExpansionHints: {ToJsonString(metadata.BoundedExpansionHints)},");
            _ = builder.AppendLine($"    handleProvenanceNotes: {ToJsonString(metadata.HandleProvenanceNotes)},");
            _ = builder.AppendLine($"    strictRequestValidation: {ToJsonBool(metadata.StrictRequestValidation)},");
            _ = builder.AppendLine($"    visibility: {ToJsonString(metadata.Visibility.ToString())},");
            _ = builder.AppendLine($"    canonicalUse: {ToJsonString(metadata.CanonicalUse)},");
            _ = builder.AppendLine($"    intentVerb: {ToJsonString(metadata.IntentVerb.ToString())},");
            _ = builder.AppendLine($"    requestShapeKind: {ToJsonString(metadata.RequestShapeKind.ToString())},");
            _ = builder.AppendLine($"    useWhen: {ToJsonString(metadata.UseWhen)},");
            _ = builder.AppendLine($"    doNotUseWhen: {ToJsonString(metadata.DoNotUseWhen)},");
            _ = builder.AppendLine($"    usuallyBefore: {ToJsonString(metadata.UsuallyBefore)},");
            _ = builder.AppendLine($"    usuallyAfter: {ToJsonString(metadata.UsuallyAfter)},");
            _ = builder.AppendLine($"    nextOperations: {ToJsonString(metadata.NextOperations)},");
            _ = builder.AppendLine($"    answersQuestionTypes: {ToJsonString(metadata.AnswersQuestionTypes)},");
            _ = builder.AppendLine($"    doesNotAnswer: {ToJsonString(metadata.DoesNotAnswer)},");
            _ = builder.AppendLine($"    primaryNouns: {ToJsonString(metadata.PrimaryNouns)},");
            _ = builder.AppendLine($"    supportedScopes: {ToJsonString(metadata.SupportedScopes)},");
            _ = builder.AppendLine($"    capabilities: {ToJsonString(metadata.Capabilities)},");
            _ = builder.AppendLine($"    safeDefaultRequestJson: {ToJsonString(metadata.SafeDefaultRequestJson)},");
            _ = builder.AppendLine($"    ambiguityBehavior: {ToJsonString(metadata.AmbiguityBehavior)},");
            _ = builder.AppendLine("  },");
        }

        return builder.ToString().TrimEnd();
    }

    private static void AppendOperationDefinitionProperties(
        StringBuilder builder,
        HostOperationDefinition operation,
        IReadOnlyDictionary<string, string> exportedTypeNames
    ) {
        _ = builder.AppendLine($"    key: {ToJsonString(operation.Key)},");
        _ = builder.AppendLine($"    verb: {ToJsonString(ToTypeScriptHttpVerb(operation.Verb))},");
        _ = builder.AppendLine($"    route: {ToJsonString(operation.Route)},");
        _ = builder.AppendLine($"    executionMode: {ToJsonString(operation.ExecutionMode.ToString())},");
        _ = builder.AppendLine($"    exposure: {ToJsonString(operation.Exposure.ToString())},");
        AppendOperationTypeMetadata(builder, operation, exportedTypeNames);
    }

    private static void AppendOperationTypeMetadata(
        StringBuilder builder,
        HostOperationDefinition operation,
        IReadOnlyDictionary<string, string>? exportedTypeNames
    ) {
        _ = builder.AppendLine($"    requestTypeName: {ToJsonString(GetOperationTypeName(operation.RequestType, exportedTypeNames, true))},");
        _ = builder.AppendLine($"    responseTypeName: {ToJsonString(GetOperationTypeName(operation.ResponseType, exportedTypeNames, false))},");
        _ = builder.AppendLine($"    requestShape: {ToJsonString(CreateShape(operation.RequestType, exportedTypeNames))},");
        _ = builder.AppendLine($"    responseShape: {ToJsonString(CreateShape(operation.ResponseType, exportedTypeNames))},");
    }

    private static string GetOperationTypeName(
        Type type,
        IReadOnlyDictionary<string, string>? exportedTypeNames,
        bool allowNoRequest
    ) {
        if (allowNoRequest && type == typeof(NoRequest))
            return "NoRequest";

        if (exportedTypeNames != null
            && !string.IsNullOrWhiteSpace(type.FullName)
            && exportedTypeNames.TryGetValue(type.FullName!, out var exportedName))
            return exportedName;

        return type.Name;
    }

    private static IReadOnlyList<TypeShapeField> CreateShape(
        Type type,
        IReadOnlyDictionary<string, string>? exportedTypeNames
    ) {
        if (type == typeof(NoRequest) || type.IsPrimitive || type == typeof(string) || type.IsEnum)
            return [];

        var nullability = new NullabilityInfoContext();
        var defaultInstance = type.GetConstructor(Type.EmptyTypes) == null ? null : Activator.CreateInstance(type);
        return type
            .GetProperties(BindingFlags.Instance | BindingFlags.Public)
            .Where(property => property.GetIndexParameters().Length == 0)
            .OrderBy(property => property.Name, StringComparer.Ordinal)
            .Select(property => new TypeShapeField(
                ToCamelCase(property.Name),
                FormatShapeType(property.PropertyType, exportedTypeNames),
                IsRequired(property, nullability, defaultInstance)
            ))
            .ToArray();
    }

    private static bool IsRequired(PropertyInfo property, NullabilityInfoContext nullability, object? defaultInstance) {
        if (defaultInstance != null && property.GetValue(defaultInstance) != null)
            return false;

        var type = property.PropertyType;
        if (Nullable.GetUnderlyingType(type) != null)
            return false;
        if (type.IsValueType)
            return true;

        return nullability.Create(property).WriteState is not NullabilityState.Nullable;
    }

    private static string FormatShapeType(Type type, IReadOnlyDictionary<string, string>? exportedTypeNames) {
        var nullableType = Nullable.GetUnderlyingType(type);
        if (nullableType != null)
            return $"{FormatShapeType(nullableType, exportedTypeNames)} | null";

        if (type == typeof(string) || type == typeof(Guid) || type == typeof(DateTime) || type == typeof(DateTimeOffset))
            return "string";
        if (type == typeof(bool))
            return "boolean";
        if (type.IsEnum)
            return $"enum:{type.Name}";
        if (IsNumericType(type))
            return "number";
        if (type.IsArray)
            return $"array<{FormatShapeType(type.GetElementType()!, exportedTypeNames)}>";
        if (TryGetDictionaryValueType(type, out var valueType))
            return $"record<{FormatShapeType(valueType, exportedTypeNames)}>";
        if (TryGetEnumerableElementType(type, out var elementType))
            return $"array<{FormatShapeType(elementType, exportedTypeNames)}>";

        return GetOperationTypeName(type, exportedTypeNames, false);
    }

    private static bool IsNumericType(Type type) => type == typeof(byte)
        || type == typeof(sbyte)
        || type == typeof(short)
        || type == typeof(ushort)
        || type == typeof(int)
        || type == typeof(uint)
        || type == typeof(long)
        || type == typeof(ulong)
        || type == typeof(float)
        || type == typeof(double)
        || type == typeof(decimal);

    private static bool TryGetEnumerableElementType(Type type, out Type elementType) {
        elementType = typeof(object);
        if (type == typeof(string))
            return false;

        var enumerable = type.IsGenericType && type.GetGenericTypeDefinition() == typeof(IEnumerable<>)
            ? type
            : type.GetInterfaces().FirstOrDefault(candidate =>
                candidate.IsGenericType && candidate.GetGenericTypeDefinition() == typeof(IEnumerable<>));
        if (enumerable == null)
            return false;

        elementType = enumerable.GetGenericArguments()[0];
        return true;
    }

    private static bool TryGetDictionaryValueType(Type type, out Type valueType) {
        valueType = typeof(object);
        var dictionary = type.GetInterfaces()
            .Append(type)
            .FirstOrDefault(candidate =>
                candidate.IsGenericType && candidate.GetGenericTypeDefinition() == typeof(IReadOnlyDictionary<,>));
        if (dictionary == null)
            return false;

        valueType = dictionary.GetGenericArguments()[1];
        return true;
    }

    private static string ToCamelCase(string value) => string.IsNullOrEmpty(value)
        ? value
        : char.ToLowerInvariant(value[0]) + value[1..];

    private static string RenderTypeScriptImports(IReadOnlyDictionary<string, string> exportedTypeNames) {
        var importedTypes = HostOperationsCatalog.TypeScriptClient.Groups
            .SelectMany(group => group.Operations)
            .SelectMany(operation => new[] {
                ResolveTypeScriptTypeName(operation.Definition.RequestType, exportedTypeNames),
                ResolveTypeScriptTypeName(operation.Definition.ResponseType, exportedTypeNames)
            })
            .Where(typeName => typeName != null)
            .Distinct(StringComparer.Ordinal)
            .OrderBy(typeName => typeName, StringComparer.Ordinal)
            .ToArray();
        return string.Join(
            Environment.NewLine,
            importedTypes.Select(typeName => $"  {typeName},")
        );
    }

    private static string RenderTypeScriptOperationGroups() => string.Join(
        $"{Environment.NewLine}{Environment.NewLine}",
        HostOperationsCatalog.TypeScriptClient.Groups.Select(RenderTypeScriptGroup)
    );

    private static string RenderTypeScriptGroup(HostTypeScriptClientGroup group) {
        var builder = new StringBuilder();
        var operationsConstantName = $"{group.ClientPropertyName}Operations";
        _ = builder.AppendLine(RenderTypeScriptOperationGroup(operationsConstantName, group.Operations));
        _ = builder.AppendLine();
        _ = builder.AppendLine($"export class {group.ClientClassName} {{");
        _ = builder.AppendLine("  constructor(private readonly options: PeHostClientOptions) {}");
        _ = builder.AppendLine();
        foreach (var operation in group.Operations)
            _ = builder.AppendLine(RenderTypeScriptMethod(group, operation));
        _ = builder.Append("}");
        return builder.ToString();
    }

    private static string RenderTypeScriptOperationGroup(string exportName, IReadOnlyList<HostTypeScriptClientOperation> operations) {
        var builder = new StringBuilder();
        _ = builder.AppendLine($"export const {exportName} = {{");
        foreach (var operation in operations) {
            _ = builder.AppendLine($"  {operation.MethodName}: {{");
            _ = builder.AppendLine($"    key: \"{operation.Definition.Key}\",");
            _ = builder.AppendLine($"    verb: \"{ToTypeScriptHttpVerb(operation.Definition.Verb)}\",");
            _ = builder.AppendLine($"    route: \"{operation.Definition.Route}\",");
            _ = builder.AppendLine($"    executionMode: \"{operation.Definition.ExecutionMode}\",");
            AppendOperationTypeMetadata(builder, operation.Definition, null);
            _ = builder.AppendLine("  },");
        }

        _ = builder.Append("} as const satisfies Record<string, HostOperationDefinition>;");
        return builder.ToString();
    }

    private static string RenderTypeScriptMethod(
        HostTypeScriptClientGroup group,
        HostTypeScriptClientOperation operation
    ) {
        var requestTypeName = ResolveTypeScriptTypeName(operation.Definition.RequestType, null);
        var responseTypeName = ResolveTypeScriptTypeName(operation.Definition.ResponseType, null)
            ?? throw new InvalidOperationException($"Operation '{operation.Definition.Key}' is missing a projected response type.");
        var operationsConstantName = $"{group.ClientPropertyName}Operations";
        var builder = new StringBuilder();
        switch (operation.RequestPolicy) {
        case HostClientRequestPolicy.None:
            _ = builder.AppendLine($"  {operation.MethodName}(): Promise<{responseTypeName}> {{");
            _ = builder.AppendLine($"    return sendJson<void, {responseTypeName}>(");
            _ = builder.AppendLine("      this.options,");
            _ = builder.AppendLine($"      {operationsConstantName}.{operation.MethodName},");
            _ = builder.AppendLine("    );");
            _ = builder.Append("  }");
            break;
        case HostClientRequestPolicy.Explicit:
            if (requestTypeName == null)
                throw new InvalidOperationException($"Operation '{operation.Definition.Key}' is missing a projected request type.");
            _ = builder.AppendLine($"  {operation.MethodName}(request: {requestTypeName}): Promise<{responseTypeName}> {{");
            _ = builder.AppendLine($"    return sendJson<{requestTypeName}, {responseTypeName}>(");
            _ = builder.AppendLine("      this.options,");
            _ = builder.AppendLine($"      {operationsConstantName}.{operation.MethodName},");
            _ = builder.AppendLine("      request,");
            _ = builder.AppendLine("    );");
            _ = builder.Append("  }");
            break;
        default:
            throw new InvalidOperationException($"Unsupported request policy '{operation.RequestPolicy}'.");
        }

        return builder.ToString();
    }

    private static void ValidateProjectedTypeSymbols(IReadOnlyDictionary<string, string> exportedTypeNames) {
        var missingTypes = HostOperationsCatalog.TypeScriptClient.Groups
            .SelectMany(group => group.Operations)
            .SelectMany(operation => new[] { operation.Definition.RequestType, operation.Definition.ResponseType })
            .Where(type => type != typeof(NoRequest))
            .Where(type => string.IsNullOrWhiteSpace(type.FullName) || !exportedTypeNames.ContainsKey(type.FullName!))
            .Select(type => type.FullName ?? type.Name)
            .Distinct(StringComparer.Ordinal)
            .OrderBy(name => name, StringComparer.Ordinal)
            .ToArray();
        if (missingTypes.Length != 0)
            throw new InvalidOperationException(
                $"TypeScript client projection references types missing from host-types exports: {string.Join(", ", missingTypes)}"
            );
    }

    private static string? ResolveTypeScriptTypeName(
        Type type,
        IReadOnlyDictionary<string, string>? exportedTypeNames
    ) {
        if (type == typeof(NoRequest))
            return null;

        if (exportedTypeNames == null)
            return type.Name;

        if (string.IsNullOrWhiteSpace(type.FullName) || !exportedTypeNames.TryGetValue(type.FullName, out var typeName))
            throw new InvalidOperationException(
                $"Type '{type.FullName ?? type.Name}' is not exported through generated host-types."
            );

        return typeName;
    }

    private static IEnumerable<string> EnumerateCommittedGeneratedFiles(string repoRoot) {
        var generatedDirectory = Path.Combine(repoRoot, "source", "pea", "app", "generated");
        if (!Directory.Exists(generatedDirectory))
            return [];

        return Directory.EnumerateFiles(generatedDirectory, "*.ts", SearchOption.TopDirectoryOnly)
            .Where(path => {
                var fileName = Path.GetFileName(path);
                return string.Equals(fileName, "pe-host-client.ts", StringComparison.OrdinalIgnoreCase)
                    || string.Equals(fileName, "host-client.generated.ts", StringComparison.OrdinalIgnoreCase)
                    || string.Equals(fileName, "host-operations.generated.ts", StringComparison.OrdinalIgnoreCase);
            })
            .Select(Path.GetFullPath);
    }

    private static string ToTypeScriptHttpVerb(HostHttpVerb verb) => verb switch {
        HostHttpVerb.Get => "GET",
        HostHttpVerb.Post => "POST",
        _ => throw new InvalidOperationException($"Unsupported host operation HTTP verb '{verb}'.")
    };

    private static string ToJsonString(string? value) => JsonSerializer.Serialize(value, JsonOptions);

    private static string ToJsonString(IReadOnlyList<string> values) => JsonSerializer.Serialize(values, JsonOptions);

    private static string ToJsonString(IReadOnlyList<TypeShapeField> values) => JsonSerializer.Serialize(values, JsonOptions);

    private static string ToJson<T>(T value) => JsonSerializer.Serialize(value, JsonOptions);

    private static string ToJsonBool(bool value) => value ? "true" : "false";

    private sealed record TypeShapeField(string Name, string Type, bool Required);

    private sealed record GeneratedProjectionFile(string Path, string Content);

    private sealed record HostTypeScriptClientOptions(bool Check) {
        public static HostTypeScriptClientOptions Parse(IReadOnlyList<string> args) {
            var check = false;
            foreach (var arg in args) {
                switch (arg) {
                case "--check":
                    check = true;
                    break;
                default:
                    throw new ArgumentException($"Unknown host-client codegen option '{arg}'. Supported options: --check.");
                }
            }

            return new HostTypeScriptClientOptions(check);
        }
    }
}
