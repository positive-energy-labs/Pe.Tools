using System.Reflection;
using System.Text;
using System.Text.Json;
using Pe.Shared.HostContracts.Operations;

namespace Pe.Dev.Cli.Codegen;

internal static class HostTypeScriptClientProjection {
    private static readonly JsonSerializerOptions JsonOptions = new(JsonSerializerDefaults.Web);
    private static readonly JsonSerializerOptions IndentedJsonOptions = new(JsonSerializerDefaults.Web) {
        WriteIndented = true
    };

    public static async Task<int> RunAsync(
        bool check,
        CodegenPaths paths,
        CancellationToken cancellationToken
    ) {
        var buildExit = await HostTypeGenerationModelProvider.EnsureFreshBuildAsync(paths, cancellationToken);
        if (buildExit != 0)
            return buildExit;

        HostTypeGenerationModelProvider.GeneratedHostTypeModel generatedHostTypeModel;
        try {
            generatedHostTypeModel = HostTypeGenerationModelProvider.Load(paths);
        } catch (Exception ex) {
            Console.Error.WriteLine($"Host TypeScript contract generation failed: {ex.Message}");
            return 1;
        }

        GeneratedProjectionFile[] generatedFiles;
        try {
            generatedFiles = GenerateFiles(paths, generatedHostTypeModel);
        } catch (Exception ex) {
            Console.Error.WriteLine($"Host TypeScript contract generation failed: {ex.Message}");
            return 1;
        }

        if (check)
            return await CheckAsync(paths, generatedFiles, cancellationToken);

        foreach (var extraFile in EnumerateCommittedGeneratedFiles(paths).Where(path => generatedFiles.All(file => !string.Equals(file.Path, path, StringComparison.OrdinalIgnoreCase)))) {
            File.Delete(extraFile);
            Console.WriteLine($"Deleted {Path.GetRelativePath(paths.RepoRoot, extraFile)}");
        }

        foreach (var generatedFile in generatedFiles) {
            Directory.CreateDirectory(Path.GetDirectoryName(generatedFile.Path)!);
            await File.WriteAllTextAsync(generatedFile.Path, generatedFile.Content, cancellationToken);
            Console.WriteLine($"Generated {Path.GetRelativePath(paths.RepoRoot, generatedFile.Path)}");
        }

        return 0;
    }

    private static async Task<int> CheckAsync(
        CodegenPaths paths,
        IReadOnlyList<GeneratedProjectionFile> generatedFiles,
        CancellationToken cancellationToken
    ) {
        var staleFiles = new List<string>();
        var expectedPaths = generatedFiles.Select(file => Path.GetFullPath(file.Path)).ToHashSet(StringComparer.OrdinalIgnoreCase);
        foreach (var generatedFile in generatedFiles) {
            var relativePath = Path.GetRelativePath(paths.RepoRoot, generatedFile.Path);
            if (!File.Exists(generatedFile.Path)) {
                staleFiles.Add($"{relativePath} (missing)");
                continue;
            }

            var existingContent = await File.ReadAllTextAsync(generatedFile.Path, cancellationToken);
            if (!string.Equals(existingContent, generatedFile.Content, StringComparison.Ordinal))
                staleFiles.Add(relativePath);
        }

        foreach (var extraFile in EnumerateCommittedGeneratedFiles(paths).Where(path => !expectedPaths.Contains(path)))
            staleFiles.Add($"{Path.GetRelativePath(paths.RepoRoot, extraFile)} (extra)");

        if (staleFiles.Count == 0) {
            Console.WriteLine("Generated Host TypeScript contracts are current.");
            return 0;
        }

        Console.Error.WriteLine("Generated Host TypeScript contracts are stale:");
        foreach (var staleFile in staleFiles)
            Console.Error.WriteLine($"  {staleFile}");
        Console.Error.WriteLine("Run `pe-dev codegen sync --target host-contracts` to update them.");
        return 1;
    }

    private static GeneratedProjectionFile[] GenerateFiles(
        CodegenPaths paths,
        HostTypeGenerationModelProvider.GeneratedHostTypeModel generatedHostTypeModel
    ) {
        ValidateProjectedTypeSymbols(generatedHostTypeModel.ExportedTypeNames);
        var generatedDirectory = paths.HostContractsDirectory;
        return [
            new GeneratedProjectionFile(
                Path.Combine(generatedDirectory, "host-operation-contracts.generated.ts"),
                NormalizeLineEndings(GenerateHostOperationContracts())
            ),
            new GeneratedProjectionFile(
                Path.Combine(generatedDirectory, "host-operations.generated.ts"),
                NormalizeLineEndings(GenerateHostOperationCatalog(generatedHostTypeModel.ExportedTypeNames))
            ),
            new GeneratedProjectionFile(
                Path.Combine(generatedDirectory, "host-capability-map.generated.ts"),
                NormalizeLineEndings(GenerateHostCapabilityMap())
            ),
            new GeneratedProjectionFile(
                Path.Combine(generatedDirectory, "index.ts"),
                NormalizeLineEndings(GenerateContractsIndex())
            )
        ];
    }

    private static string GenerateHostOperationContracts() => $$"""
        // <auto-generated />
        // Generated by `pe-dev codegen sync --target host-contracts` from Pe.Shared.HostContracts.Operations.

        export type HostHttpVerb = {{RenderStringUnion<HostHttpVerb>(ToTypeScriptHttpVerb)}};
        export type HostExecutionMode = {{RenderStringUnion<HostExecutionMode>()}};
        export type HostOperationExposure = {{RenderStringUnion<HostOperationExposure>()}};
        export type HostOperationIntent = {{RenderStringUnion<HostOperationIntent>()}};
        export type HostOperationFamily = {{RenderStringUnion<HostOperationFamily>()}};
        export type RevitOperationLayer = {{RenderStringUnion<RevitOperationLayer>()}};
        export type RevitActiveDocumentKind = {{RenderStringUnion<RevitActiveDocumentKind>()}};
        export type HostOperationCostTier = {{RenderStringUnion<HostOperationCostTier>()}};
        export type HostOperationVisibility = {{RenderStringUnion<HostOperationVisibility>()}};
        export type HostOperationRelationKind = {{RenderStringUnion<HostOperationRelationKind>()}};

        export interface HostTypeShapeField {
          name: string;
          type: string;
          required: boolean;
        }

        export interface HostOperationRequestExample {
          name: string;
          description: string;
          json: string;
        }

        export interface HostOperationRelatedOperation {
          key: string;
          kind: HostOperationRelationKind;
          note?: string | null;
        }

        export interface HostOperationDefinition {
          key: string;
          verb: HostHttpVerb;
          route: string;
          executionMode: HostExecutionMode;
          exposure?: HostOperationExposure;
          requestTypeName?: string;
          responseTypeName?: string;
          requestShape?: readonly HostTypeShapeField[];
          responseShape?: readonly HostTypeShapeField[];
          displayName?: string;
          domain?: string;
          description?: string;
          searchTerms?: readonly string[];
          intent?: HostOperationIntent;
          requiresBridge?: boolean;
          requiresActiveDocument?: boolean;
          supportedActiveDocumentKinds?: readonly RevitActiveDocumentKind[];
          family?: HostOperationFamily;
          revitLayer?: RevitOperationLayer | null;
          domainNoun?: string;
          costTier?: HostOperationCostTier;
          visibility?: HostOperationVisibility;
          singleFlightGroup?: string | null;
          requestExamples?: readonly HostOperationRequestExample[];
          safeDefaultRequestJson?: string | null;
          callGuidance?: readonly string[];
          relatedOperations?: readonly HostOperationRelatedOperation[];
          strictRequestValidation?: boolean;
        }

        export interface HostCapabilityMapRow {
          key: string;
          description: string;
          safety: string;
          inputKind: string;
          outputKind: string;
          terms: string;
        }

        export interface HostCapabilityMapSection {
          id: string;
          title: string;
          summary: string;
          rows: readonly HostCapabilityMapRow[];
        }

        export interface HostCapabilityMap {
          generatedFrom: string;
          formatVersion: number;
          rowCount: number;
          guidance: string;
          operationKeys: readonly string[];
          sections: readonly HostCapabilityMapSection[];
          focusSections: readonly HostCapabilityMapSection[];
        }
        """;

    private static string GenerateHostOperationCatalog(IReadOnlyDictionary<string, string> exportedTypeNames) => $$"""
        // <auto-generated />
        // Generated by `pe-dev codegen sync --target host-contracts` from HostOperationsCatalog.PublicHttp.

        import type { HostOperationDefinition } from "./host-operation-contracts.generated.js";

        export const hostOperations = {
        {{RenderHostOperationCatalogEntries(exportedTypeNames)}}
        } as const satisfies Record<string, HostOperationDefinition>;

        export type HostOperationKey = keyof typeof hostOperations;
        """;

    private static string GenerateHostCapabilityMap() => $$"""
        // <auto-generated />
        // Generated by `pe-dev codegen sync --target host-contracts` from HostOperationsCatalog.PublicHttp.

        import type { HostCapabilityMap } from "./host-operation-contracts.generated.js";

        export const hostCapabilityMap = {
          generatedFrom: "HostOperationsCatalog.PublicHttp",
          formatVersion: 1,
          rowCount: {{HostOperationsCatalog.PublicHttp.Count}},
          guidance:
            "Table-of-contents routing map only. Use sections to choose a capability ladder; use host_operation_search matches for call guidance and exact request/response shapes.",
          operationKeys: {{ToJsonIndented(HostOperationsCatalog.PublicHttp.Select(operation => operation.Key).OrderBy(key => key, StringComparer.Ordinal).ToArray(), 4)}},
          sections: [
        {{RenderHostCapabilityMapSections(false)}}
          ],
          focusSections: [
        {{RenderHostCapabilityMapSections(true)}}
          ],
        } as const satisfies HostCapabilityMap;
        """;

    private static string GenerateContractsIndex() => """
        // <auto-generated />
        // Generated by `pe-dev codegen sync --target host-contracts`.

        export * from "./product.generated.js";
        export * from "./host-operation-contracts.generated.js";
        export * from "./host-operations.generated.js";
        export * from "./host-capability-map.generated.js";
        """;

    private static string RenderHostCapabilityMapSections(bool focusOnly) {
        var sections = focusOnly
            ? CreateHostCapabilityFocusSections()
            : CreateHostCapabilitySections();
        return string.Join(
            ",\n",
            sections
                .Where(section => section.Operations.Count != 0)
                .Select(RenderHostCapabilityMapSection)
        );
    }

    private static IReadOnlyList<HostCapabilitySectionProjection> CreateHostCapabilitySections() {
        var operations = HostOperationsCatalog.PublicHttp
            .OrderBy(operation => operation.Key, StringComparer.Ordinal)
            .ToArray();
        var sections = new List<HostCapabilitySectionProjection> {
            CreateRevitLayerSection("context", "Context", "Cheap current Revit document, active view, selection, and session orientation.", RevitOperationLayer.Context, operations),
            CreateRevitLayerSection("catalog", "Catalog", "Cheap/bounded inventories of candidate schedules, families, parameters, browser paths, and model nouns.", RevitOperationLayer.Catalog, operations),
            CreateRevitLayerSection("matrix", "Matrix", "Bounded joins and audits after context/catalog narrowing.", RevitOperationLayer.Matrix, operations),
            CreateRevitLayerSection("detail", "Detail", "Exact inspection of known schedules, sheets, elements, rows, or panel schedules.", RevitOperationLayer.Detail, operations),
            CreateRevitLayerSection("resolve", "Resolve", "Fuzzy human references into stable handles before detail or matrix calls.", RevitOperationLayer.Resolve, operations),
            CreateRevitLayerSection("apply", "Apply", "Explicit host/Revit state changes after discovery and inspection.", RevitOperationLayer.Apply, operations),
            CreateDomainSection("settings", "Settings", "Schema-backed settings/profile authoring, validation, field options, and workspaces.", "settings", operations),
            CreateDomainSection("aps", "APS", "Autodesk Platform Services auth and cloud workflow support operations.", "aps", operations),
            CreateDomainSection("host", "Host", "Local host process, logs, probe, and session facts.", "host", operations),
            CreateDomainSection("script", "Scripting", "Host-owned C# scripting workspace bootstrap and execution.", "scripting", operations)
        };

        var coveredKeys = sections
            .SelectMany(section => section.Operations)
            .Select(operation => operation.Key)
            .ToHashSet(StringComparer.Ordinal);
        var otherOperations = operations
            .Where(operation => !coveredKeys.Contains(operation.Key))
            .ToArray();
        if (otherOperations.Length != 0)
            sections.Add(new HostCapabilitySectionProjection("other", "Other", "Public operations not covered by the primary routing sections.", otherOperations));

        return sections;
    }

    private static IReadOnlyList<HostCapabilitySectionProjection> CreateHostCapabilityFocusSections() => [];

    private static HostCapabilitySectionProjection CreateRevitLayerSection(
        string id,
        string title,
        string summary,
        RevitOperationLayer layer,
        IReadOnlyList<HostOperationDefinition> operations
    ) => new(
        id,
        title,
        summary,
        operations
            .Where(operation => operation.AgentMetadata.RevitLayer == layer)
            .ToArray()
    );

    private static HostCapabilitySectionProjection CreateDomainSection(
        string id,
        string title,
        string summary,
        string domain,
        IReadOnlyList<HostOperationDefinition> operations
    ) => new(
        id,
        title,
        summary,
        operations
            .Where(operation => string.Equals(operation.AgentMetadata.Domain, domain, StringComparison.OrdinalIgnoreCase))
            .ToArray()
    );

    private static string RenderHostCapabilityMapSection(HostCapabilitySectionProjection section) {
        var builder = new StringBuilder();
        _ = builder.AppendLine("    {");
        _ = builder.AppendLine($"      id: {ToJsonString(section.Id)},");
        _ = builder.AppendLine($"      title: {ToJsonString(section.Title)},");
        AppendCapabilityMapStringProperty(builder, "summary", section.Summary, 6, 8);
        _ = builder.AppendLine("      rows: [");
        foreach (var operation in section.Operations)
            AppendHostCapabilityMapRow(builder, operation);
        _ = builder.AppendLine("      ],");
        _ = builder.Append("    }");
        return builder.ToString();
    }

    private static void AppendHostCapabilityMapRow(
        StringBuilder builder,
        HostOperationDefinition operation
    ) {
        var metadata = operation.AgentMetadata;
        var safety = string.Join(
            ", ",
            new[] {
                operation.ExecutionMode.ToString(),
                metadata.RequiresActiveDocument ? "active-doc" : null,
                metadata.CostTier.ToString(),
                JoinPipe(metadata.SupportedActiveDocumentKinds.Select(kind => kind.ToString()))
            }.Where(value => !string.IsNullOrWhiteSpace(value))
        );
        _ = builder.AppendLine("        {");
        _ = builder.AppendLine($"          key: {ToJsonString(operation.Key)},");
        AppendCapabilityMapStringProperty(builder, "description", metadata.Description, 10, 12);
        _ = builder.AppendLine($"          safety: {ToJsonString(safety)},");
        _ = builder.AppendLine($"          inputKind: {ToJsonString(FormatCapabilityMapInputKind(operation))},");
        _ = builder.AppendLine($"          outputKind: {ToJsonString(FormatCapabilityMapOutputKind(operation))},");
        AppendCapabilityMapStringProperty(builder, "terms", JoinPipe(metadata.SearchTerms), 10, 12);
        _ = builder.AppendLine("        },");
    }

    private static string FormatCapabilityMapInputKind(HostOperationDefinition operation) {
        if (operation.RequestType == typeof(NoRequest))
            return "none";

        var metadata = operation.AgentMetadata;
        return metadata.RevitLayer switch {
            RevitOperationLayer.Context => "context scope",
            RevitOperationLayer.Catalog => "bounded filters",
            RevitOperationLayer.Matrix => "scoped audit query",
            RevitOperationLayer.Detail => "known handles or filters",
            RevitOperationLayer.Resolve => "reference text/context",
            RevitOperationLayer.Apply => "explicit mutation request",
            _ => metadata.Family switch {
                HostOperationFamily.Settings => "settings/profile request",
                HostOperationFamily.Script => "workspace/script request",
                HostOperationFamily.Aps => "APS auth/cloud request",
                HostOperationFamily.Host => "host/session request",
                _ => "typed request"
            }
        };
    }

    private static string FormatCapabilityMapOutputKind(HostOperationDefinition operation) {
        var metadata = operation.AgentMetadata;
        return metadata.RevitLayer switch {
            RevitOperationLayer.Context => "current state summary",
            RevitOperationLayer.Catalog => "candidate handles/list",
            RevitOperationLayer.Matrix => "join/audit results",
            RevitOperationLayer.Detail => "detail records",
            RevitOperationLayer.Resolve => "resolved references",
            RevitOperationLayer.Apply => "mutation result",
            _ => metadata.Family switch {
                HostOperationFamily.Settings => "settings/profile result",
                HostOperationFamily.Script => "workspace/script result",
                HostOperationFamily.Aps => "APS status/cloud result",
                HostOperationFamily.Host => "host/session facts",
                _ => "typed result"
            }
        };
    }

    private static string JoinPipe(IEnumerable<string> values) => string.Join("|", values.Where(value => !string.IsNullOrWhiteSpace(value)));

    private static string RenderHostOperationCatalogEntries(IReadOnlyDictionary<string, string> exportedTypeNames) {
        var builder = new StringBuilder();
        foreach (var operation in HostOperationsCatalog.PublicHttp.OrderBy(definition => definition.Key, StringComparer.Ordinal)) {
            var metadata = operation.AgentMetadata;
            _ = builder.AppendLine($"  {ToJsonString(operation.Key)}: {{");
            AppendOperationDefinitionProperties(builder, operation, exportedTypeNames);
            _ = builder.AppendLine($"    displayName: {ToJsonString(operation.DisplayName ?? operation.Key)},");
            _ = builder.AppendLine($"    domain: {ToJsonString(metadata.Domain)},");
            _ = builder.AppendLine($"    description: {ToJsonString(metadata.Description)},");
            _ = builder.AppendLine($"    searchTerms: {ToTsStringArray(metadata.SearchTerms)},");
            _ = builder.AppendLine($"    intent: {ToJsonString(metadata.Intent.ToString())},");
            _ = builder.AppendLine($"    requiresBridge: {ToJsonBool(metadata.RequiresBridge)},");
            _ = builder.AppendLine($"    requiresActiveDocument: {ToJsonBool(metadata.RequiresActiveDocument)},");
            _ = builder.AppendLine($"    supportedActiveDocumentKinds: {ToTsStringArray(metadata.SupportedActiveDocumentKinds.Select(kind => kind.ToString()).ToArray())},");
            _ = builder.AppendLine($"    family: {ToJsonString(metadata.Family.ToString())},");
            _ = builder.AppendLine($"    revitLayer: {ToJsonString(metadata.RevitLayer?.ToString())},");
            _ = builder.AppendLine($"    domainNoun: {ToJsonString(metadata.DomainNoun)},");
            _ = builder.AppendLine($"    costTier: {ToJsonString(metadata.CostTier.ToString())},");
            _ = builder.AppendLine($"    visibility: {ToJsonString(metadata.Visibility.ToString())},");
            _ = builder.AppendLine($"    singleFlightGroup: {ToJsonString(metadata.SingleFlightGroup)},");
            _ = builder.AppendLine($"    requestExamples: {ToJson(metadata.RequestExamples)},");
            _ = builder.AppendLine($"    safeDefaultRequestJson: {ToJsonString(metadata.SafeDefaultRequestJson)},");
            _ = builder.AppendLine($"    callGuidance: {ToJsonString(metadata.CallGuidance)},");
            _ = builder.AppendLine($"    relatedOperations: {ToJson(metadata.RelatedOperations.Select(operation => new { operation.Key, Kind = operation.Kind.ToString(), operation.Note }).ToArray())},");
            _ = builder.AppendLine($"    strictRequestValidation: {ToJsonBool(metadata.StrictRequestValidation)},");
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
        _ = builder.AppendLine($"    requestShape: {ToTsTypeShapeFields(CreateShape(operation.RequestType, exportedTypeNames))},");
        _ = builder.AppendLine($"    responseShape: {ToTsTypeShapeFields(CreateShape(operation.ResponseType, exportedTypeNames))},");
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

    private static IEnumerable<string> EnumerateCommittedGeneratedFiles(CodegenPaths paths) {
        if (!Directory.Exists(paths.HostContractsDirectory))
            return [];

        return Directory.EnumerateFiles(paths.HostContractsDirectory, "*.ts", SearchOption.TopDirectoryOnly)
            .Where(path => {
                var fileName = Path.GetFileName(path);
                return string.Equals(fileName, "host-operation-contracts.generated.ts", StringComparison.OrdinalIgnoreCase)
                    || string.Equals(fileName, "host-operations.generated.ts", StringComparison.OrdinalIgnoreCase)
                    || string.Equals(fileName, "host-capability-map.generated.ts", StringComparison.OrdinalIgnoreCase)
                    || string.Equals(fileName, "index.ts", StringComparison.OrdinalIgnoreCase);
            })
            .Select(Path.GetFullPath);
    }

    private static string ToTypeScriptHttpVerb(HostHttpVerb verb) => verb switch {
        HostHttpVerb.Get => "GET",
        HostHttpVerb.Post => "POST",
        _ => throw new InvalidOperationException($"Unsupported host operation HTTP verb '{verb}'.")
    };

    private static string RenderStringUnion<TEnum>(Func<TEnum, string>? format = null) where TEnum : struct, Enum => string.Join(
        " | ",
        Enum.GetValues<TEnum>().Select(value => ToJsonString(format == null ? value.ToString() : format(value)))
    );

    private static string ToJsonString(string? value) => JsonSerializer.Serialize(value, JsonOptions);

    private static string ToJsonString(IReadOnlyList<string> values) => JsonSerializer.Serialize(values, JsonOptions);

    private static string ToJsonIndented<T>(T value, int continuationIndent) => JsonSerializer
        .Serialize(value, IndentedJsonOptions)
        .Replace("\n", "\n" + new string(' ', continuationIndent));

    private static string ToTsStringArray(IReadOnlyList<string> values) =>
        values.Count == 0 ? "[]" : $"[{string.Join(", ", values.Select(ToJsonString))}]";

    private static string ToTsTypeShapeFields(IReadOnlyList<TypeShapeField> fields) {
        if (fields.Count == 0)
            return "[]";

        var builder = new StringBuilder();
        _ = builder.AppendLine("[");
        foreach (var field in fields) {
            _ = builder.AppendLine("      {");
            _ = builder.AppendLine($"        name: {ToJsonString(field.Name)},");
            _ = builder.AppendLine($"        type: {ToJsonString(field.Type)},");
            _ = builder.AppendLine($"        required: {ToJsonBool(field.Required)},");
            _ = builder.AppendLine("      },");
        }
        _ = builder.Append("    ]");
        return builder.ToString();
    }

    private static void AppendCapabilityMapStringProperty(
        StringBuilder builder,
        string name,
        string value,
        int propertyIndent,
        int continuationIndent
    ) {
        var propertyPadding = new string(' ', propertyIndent);
        if (value.Length <= 80) {
            _ = builder.AppendLine($"{propertyPadding}{name}: {ToJsonString(value)},");
            return;
        }

        _ = builder.AppendLine($"{propertyPadding}{name}:");
        _ = builder.AppendLine($"{new string(' ', continuationIndent)}{ToJsonString(value)},");
    }

    private static string ToJson<T>(T value) => JsonSerializer.Serialize(value, JsonOptions);

    private static string ToJsonBool(bool value) => value ? "true" : "false";

    private static string NormalizeLineEndings(string content) {
        var normalized = content.Replace("\r\n", "\n").Replace("\r", "\n");
        return normalized.EndsWith('\n') ? normalized : normalized + "\n";
    }

    private sealed record TypeShapeField(string Name, string Type, bool Required);

    private sealed record HostCapabilitySectionProjection(
        string Id,
        string Title,
        string Summary,
        IReadOnlyList<HostOperationDefinition> Operations
    );

    private sealed record GeneratedProjectionFile(string Path, string Content);
}
