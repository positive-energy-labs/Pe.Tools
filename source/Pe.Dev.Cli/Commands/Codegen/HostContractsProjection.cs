using System.Text;
using System.Text.Json;
using Pe.Shared.HostContracts.Bridge;
using Pe.Shared.HostContracts.Operations;
using Pe.Shared.HostContracts.Protocol;

namespace Pe.Dev.Cli.Codegen;

internal static class HostContractsProjection {
    private static readonly JsonSerializerOptions JsonOptions = new(JsonSerializerDefaults.Web);
    private static readonly JsonSerializerOptions IndentedJsonOptions = new(JsonSerializerDefaults.Web) {
        WriteIndented = true
    };

    public static async Task<int> RunAsync(
        CodegenPaths paths,
        CancellationToken cancellationToken
    ) {
        HostContractExportModelProvider.GeneratedHostTypeModel generatedHostTypeModel;
        try {
            generatedHostTypeModel = HostContractExportModelProvider.Load();
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

        GeneratedProjectionSync.DeleteStaleFiles(
            paths.RepoRoot,
            generatedFiles.Select(file => file.Path),
            EnumerateGeneratedOwnedFiles(paths)
        );
        GeneratedProjectionSync.DeleteEmptyDirectories(paths.RepoRoot, [
            paths.HostEffectDirectory,
            .. paths.LegacyHostProjectionDirectories
        ]);

        foreach (var generatedFile in generatedFiles) {
            Directory.CreateDirectory(Path.GetDirectoryName(generatedFile.Path)!);
            await File.WriteAllTextAsync(generatedFile.Path, generatedFile.Content, cancellationToken);
            Console.WriteLine($"Generated {Path.GetRelativePath(paths.RepoRoot, generatedFile.Path)}");
        }

        return 0;
    }

    private static GeneratedProjectionFile[] GenerateFiles(
        CodegenPaths paths,
        HostContractExportModelProvider.GeneratedHostTypeModel generatedHostTypeModel
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
                Path.Combine(generatedDirectory, "bridge-protocol.generated.ts"),
                NormalizeLineEndings(GenerateBridgeProtocol())
            ),
            new GeneratedProjectionFile(
                Path.Combine(generatedDirectory, "index.ts"),
                NormalizeLineEndings(GenerateContractsIndex())
            ),
            new GeneratedProjectionFile(
                Path.Combine(paths.HostEffectDirectory, "host-effect.generated.ts"),
                NormalizeLineEndings(HostEffectSchemaProjection.Generate(
                    HostContractExportModelProvider.ResolveExportedTypes(generatedHostTypeModel.ExportedTypeNames)
                ))
            ),
            new GeneratedProjectionFile(
                Path.Combine(paths.HostEffectDirectory, "host-op-schemas.generated.ts"),
                NormalizeLineEndings(GenerateHostEffectOpSchemaRegistry(generatedHostTypeModel.ExportedTypeNames))
            ),
            new GeneratedProjectionFile(
                Path.Combine(paths.HostEffectDirectory, "bridge-operation-rpcs.generated.ts"),
                NormalizeLineEndings(GenerateBridgeOperationRpcs(generatedHostTypeModel.ExportedTypeNames))
            )
        ];
    }

    private static string GenerateHostEffectOpSchemaRegistry(IReadOnlyDictionary<string, string> exportedTypeNames) {
        string? SchemaRef(
            HostOperationDefinition operation,
            Type type,
            string side
        ) {
            if (type == typeof(NoRequest))
                return null;
            if (string.IsNullOrWhiteSpace(type.FullName)
                || !exportedTypeNames.TryGetValue(type.FullName!, out var exportedName))
                throw new InvalidOperationException(
                    $"Public operation '{operation.Key}' {side} type '{type.FullName ?? type.Name}' is not generated. Mark the contract with [ExportTsSchema] from Pe.Shared.Codegen."
                );
            return $"schemas.{ToCamelCase(exportedName)}Schema";
        }

        var builder = new StringBuilder();
        foreach (var operation in ProjectedOperations()) {
            var request = SchemaRef(operation, operation.RequestType, "request");
            var response = SchemaRef(operation, operation.ResponseType, "response");

            var parts = new List<string>();
            if (request != null)
                parts.Add($"request: {request}");
            if (response != null)
                parts.Add($"response: {response}");
            _ = builder.AppendLine($"  {ToJsonString(operation.Key)}: {{ {string.Join(", ", parts)} }},");
        }

        return $$"""
            // <auto-generated />
            // Generated by `pe-dev codegen sync --target host-contracts` from BridgeOpCatalog bridge operations.
            // Maps each bridge operation key to generated Effect schemas for TS host runtime validation.

            import type { Schema } from "effect";
            import type { HostOperationKey } from "../contracts/host-operations.generated.js";
            import * as schemas from "./host-effect.generated.js";

            type HostEffectOperationSchemaEntry = {
              request?: Schema.Codec<unknown>;
              response?: Schema.Codec<unknown>;
            };

            export const hostEffectOperationSchemas = {
            {{builder.ToString().TrimEnd()}}
            } as const satisfies Record<HostOperationKey, HostEffectOperationSchemaEntry>;
            """;
    }

    private static string GenerateBridgeOperationRpcs(IReadOnlyDictionary<string, string> exportedTypeNames) {
        string? SchemaRef(
            HostOperationDefinition operation,
            Type type,
            string side
        ) {
            if (type == typeof(NoRequest))
                return null;
            if (string.IsNullOrWhiteSpace(type.FullName)
                || !exportedTypeNames.TryGetValue(type.FullName!, out var exportedName))
                throw new InvalidOperationException(
                    $"Public operation '{operation.Key}' {side} type '{type.FullName ?? type.Name}' is not generated. Mark the contract with [ExportTsSchema] from Pe.Shared.Codegen."
                );
            return $"schemas.{ToCamelCase(exportedName)}Schema";
        }

        var builder = new StringBuilder();
        var handlers = new StringBuilder();
        var callCases = new StringBuilder();
        foreach (var operation in ProjectedOperations()) {
            var request = SchemaRef(operation, operation.RequestType, "request");
            var response = SchemaRef(operation, operation.ResponseType, "response") ?? "Schema.Void";
            var payloadFields = request == null
                ? ""
                : $"request: {request}";

            _ = builder.AppendLine("  Rpc.make(");
            _ = builder.AppendLine($"    {ToJsonString(operation.Key)},");
            _ = builder.AppendLine("    {");
            _ = builder.AppendLine($"      payload: {{ {payloadFields} }},");
            _ = builder.AppendLine($"      success: {response},");
            _ = builder.AppendLine("      error: HostRpcError,");
            _ = builder.AppendLine("    },");
            _ = builder.AppendLine("  ),");

            if (request == null) {
                _ = handlers.AppendLine($"  {ToJsonString(operation.Key)}: () =>");
                _ = handlers.AppendLine($"    handle({ToJsonString(operation.Key)}, undefined),");
                _ = callCases.AppendLine($"    case {ToJsonString(operation.Key)}:");
                _ = callCases.AppendLine($"      return client({ToJsonString(operation.Key)}, {{}});");
            } else {
                var requestType = $"Schema.Schema.Type<typeof {request}>";
                _ = handlers.AppendLine($"  {ToJsonString(operation.Key)}: (payload: {{ readonly request: {requestType} }}) =>");
                _ = handlers.AppendLine($"    handle({ToJsonString(operation.Key)}, payload.request),");
                _ = callCases.AppendLine($"    case {ToJsonString(operation.Key)}:");
                _ = callCases.AppendLine($"      return client({ToJsonString(operation.Key)}, {{ request: request as {requestType} }});");
            }
        }

        return $$"""
            // <auto-generated />
            // Generated by `pe-dev codegen sync --target host-contracts` from BridgeOpCatalog bridge operations.
            // One Effect RPC per generated bridge operation. Generic host.call remains for agent compatibility.

            import { Schema, type Effect } from "effect";
            import { Rpc, type RpcClient } from "effect/unstable/rpc";
            import type { HostOperationKey } from "../contracts/host-operations.generated.js";
            import type { HostOpRequest, HostOpResponse } from "../operation-types.js";
            import { HostRpcError } from "../rpc-error.js";
            import * as schemas from "./host-effect.generated.js";

            export const bridgeOperationRpcs = [
            {{builder.ToString().TrimEnd()}}
            ] as const;

            export type BridgeOperationRpcClient<E = never> = RpcClient.RpcClient.Flat<
              (typeof bridgeOperationRpcs)[number],
              E
            >;

            export function callBridgeOperationRpcMember<E>(
              client: BridgeOperationRpcClient<E>,
              key: HostOperationKey,
              request: unknown,
            ): Effect.Effect<unknown, HostRpcError | E> {
              switch (key) {
            {{callCases.ToString().TrimEnd()}}
              }
            }

            export type BridgeOperationRpcHandler = <K extends HostOperationKey>(
              key: K,
              request: HostOpRequest<K>,
            ) => Effect.Effect<HostOpResponse<K>, HostRpcError>;

            export function makeBridgeOperationRpcHandlers(handle: BridgeOperationRpcHandler) {
              return {
            {{handlers.ToString().TrimEnd()}}
              } as const;
            }
            """;
    }

    private static string GenerateHostOperationContracts() => $$"""
        // <auto-generated />
        // Generated by `pe-dev codegen sync --target host-contracts` from Pe.Shared.HostContracts.Operations.

        import { Schema } from "effect";

        export const hostOperationIntentSchema = Schema.Literals([{{RenderSchemaLiteralUnion<HostOperationIntent>()}}]);
        export type HostOperationIntent = Schema.Schema.Type<typeof hostOperationIntentSchema>;

        export const hostOperationCostTierSchema = Schema.Literals([{{RenderSchemaLiteralUnion<HostOperationCostTier>()}}]);
        export type HostOperationCostTier = Schema.Schema.Type<typeof hostOperationCostTierSchema>;

        export const hostOperationVisibilitySchema = Schema.Literals([{{RenderSchemaLiteralUnion<HostOperationVisibility>()}}]);
        export type HostOperationVisibility = Schema.Schema.Type<typeof hostOperationVisibilitySchema>;

        export const hostErrorKindSchema = Schema.Literals([{{RenderSchemaLiteralUnion<HostErrorKind>()}}]);
        export type HostErrorKind = Schema.Schema.Type<typeof hostErrorKindSchema>;

        export const hostOperationRequestExampleSchema = Schema.Struct({
          name: Schema.String,
          description: Schema.String,
          json: Schema.String,
        });
        export type HostOperationRequestExample = Schema.Schema.Type<typeof hostOperationRequestExampleSchema>;

        export const hostOperationDefinitionSchema = Schema.Struct({
          key: Schema.String,
          requestTypeName: Schema.optional(Schema.String),
          responseTypeName: Schema.optional(Schema.String),
          displayName: Schema.optional(Schema.String),
          description: Schema.optional(Schema.String),
          searchTerms: Schema.optional(Schema.Array(Schema.String)),
          intent: Schema.optional(hostOperationIntentSchema),
          requiresActiveDocument: Schema.optional(Schema.Boolean),
          costTier: Schema.optional(hostOperationCostTierSchema),
          visibility: Schema.optional(hostOperationVisibilitySchema),
          requestExamples: Schema.optional(Schema.Array(hostOperationRequestExampleSchema)),
          safeDefaultRequestJson: Schema.optional(Schema.NullOr(Schema.String)),
          callGuidance: Schema.optional(Schema.Array(Schema.String)),
        });
        export type HostOperationDefinition = Schema.Schema.Type<typeof hostOperationDefinitionSchema>;

        """;

    private static string GenerateHostOperationCatalog(IReadOnlyDictionary<string, string> exportedTypeNames) => $$"""
        // <auto-generated />
        // Generated by `pe-dev codegen sync --target host-contracts` from BridgeOpCatalog bridge operations.

        import type { HostOperationDefinition } from "./host-operation-contracts.generated.js";

        export const hostOperations = {
        {{RenderHostOperationCatalogEntries(exportedTypeNames)}}
        } as const satisfies Record<string, HostOperationDefinition>;

        export type HostOperationKey = keyof typeof hostOperations;
        """;

    private static string GenerateContractsIndex() => """
        // <auto-generated />
        // Generated by `pe-dev codegen sync --target host-contracts`.

        export * from "./product.generated.js";
        export * from "./bridge-protocol.generated.js";
        export * from "./host-operation-contracts.generated.js";
        export * from "./host-operations.generated.js";
        """;

    private static string GenerateBridgeProtocol() => $$"""
        // <auto-generated />
        // Generated by `pe-dev codegen sync --target host-contracts` from Pe.Shared.HostContracts.Bridge and Protocol.

        import { Schema } from "effect";

        export const HOST_CONTRACT_VERSION = {{HostProtocol.ContractVersion}} as const;
        export const BRIDGE_CONTRACT_VERSION = {{BridgeProtocol.ContractVersion}} as const;
        export const BRIDGE_PATH = {{ToJsonString(HttpRoutes.Bridge)}} as const;

        const nullableString = Schema.optional(Schema.NullOr(Schema.String));

        export const hostModuleDescriptorSchema = Schema.Struct({
          activeDocumentKind: Schema.Literals([{{RenderSchemaLiteralUnion<HostModuleActiveDocumentKind>()}}]),
          defaultRootKey: Schema.String,
          moduleKey: Schema.String,
          scope: Schema.Literals([{{RenderSchemaLiteralUnion<HostModuleScope>()}}]),
        });
        export type HostModuleDescriptor = Schema.Schema.Type<typeof hostModuleDescriptorSchema>;

        export const hostRuntimeAssemblyDataSchema = Schema.Struct({
          informationalVersion: nullableString,
          location: nullableString,
          moduleVersionId: Schema.String,
          name: Schema.String,
          version: nullableString,
        });
        export type HostRuntimeAssemblyData = Schema.Schema.Type<typeof hostRuntimeAssemblyDataSchema>;

        export const performanceMetricsSchema = Schema.Struct({
          requestBytes: Schema.Number,
          responseBytes: Schema.Number,
          revitExecutionMs: Schema.Number,
          roundTripMs: Schema.Number,
          serializationMs: Schema.Number,
        });
        export type PerformanceMetrics = Schema.Schema.Type<typeof performanceMetricsSchema>;

        export const validationIssueSchema = Schema.Struct({
          code: Schema.String,
          instancePath: Schema.String,
          message: Schema.String,
          schemaPath: nullableString,
          severity: Schema.String,
          suggestion: nullableString,
        });
        export type ValidationIssue = Schema.Schema.Type<typeof validationIssueSchema>;

        export const bridgeEventSchema = Schema.Struct({
          eventName: Schema.String,
          payloadJson: Schema.String,
        });
        export type BridgeEvent = Schema.Schema.Type<typeof bridgeEventSchema>;

        export const bridgeRegistrationAckSchema = Schema.Struct({
          accepted: Schema.Boolean,
          errorMessage: nullableString,
        });
        export type BridgeRegistrationAck = Schema.Schema.Type<typeof bridgeRegistrationAckSchema>;

        export const bridgeStateSnapshotSchema = Schema.Struct({
          activeDocumentCloudModelGuid: nullableString,
          activeDocumentCloudModelUrn: nullableString,
          activeDocumentCloudProjectGuid: nullableString,
          activeDocumentIsFamilyDocument: Schema.Boolean,
          activeDocumentIsModelInCloud: Schema.Boolean,
          activeDocumentIsWorkshared: Schema.Boolean,
          activeDocumentKey: nullableString,
          activeDocumentObservedAtUnixMs: Schema.Number,
          activeDocumentPath: nullableString,
          activeDocumentTitle: nullableString,
          availableModules: Schema.Array(hostModuleDescriptorSchema),
          hasActiveDocument: Schema.Boolean,
          openDocumentCount: Schema.Number,
          revitVersion: Schema.String,
          runtimeAssemblies: Schema.Array(hostRuntimeAssemblyDataSchema),
          runtimeFramework: Schema.String,
          sharedParametersFilename: nullableString,
        });
        export type BridgeStateSnapshot = Schema.Schema.Type<typeof bridgeStateSnapshotSchema>;

        export const bridgeRegistrationRequestSchema = Schema.Struct({
          contractVersion: Schema.Number,
          processId: Schema.Number,
          state: bridgeStateSnapshotSchema,
        });
        export type BridgeRegistrationRequest = Schema.Schema.Type<typeof bridgeRegistrationRequestSchema>;

        export const bridgeRequestSchema = Schema.Struct({
          operationKey: Schema.String,
          payloadJson: Schema.String,
          requestId: Schema.String,
        });
        export type BridgeRequest = Schema.Schema.Type<typeof bridgeRequestSchema>;

        export const bridgeResponseSchema = Schema.Struct({
          errorMessage: nullableString,
          issues: Schema.optional(Schema.NullOr(Schema.Array(validationIssueSchema))),
          metrics: performanceMetricsSchema,
          ok: Schema.Boolean,
          payloadJson: nullableString,
          requestId: Schema.String,
          statusCode: Schema.optional(Schema.NullOr(Schema.Number)),
        });
        export type BridgeResponse = Schema.Schema.Type<typeof bridgeResponseSchema>;

        export const bridgeStateSyncSchema = Schema.Struct({
          state: bridgeStateSnapshotSchema,
        });
        export type BridgeStateSync = Schema.Schema.Type<typeof bridgeStateSyncSchema>;

        export const bridgeFrameSchema = Schema.Struct({
          disconnectReason: nullableString,
          event: Schema.optional(Schema.NullOr(bridgeEventSchema)),
          kind: Schema.Literals([{{RenderSchemaLiteralUnion<BridgeFrameKind>()}}]),
          registration: Schema.optional(Schema.NullOr(bridgeRegistrationRequestSchema)),
          registrationAck: Schema.optional(Schema.NullOr(bridgeRegistrationAckSchema)),
          request: Schema.optional(Schema.NullOr(bridgeRequestSchema)),
          response: Schema.optional(Schema.NullOr(bridgeResponseSchema)),
          stateSync: Schema.optional(Schema.NullOr(bridgeStateSyncSchema)),
        });
        export type BridgeFrame = Schema.Schema.Type<typeof bridgeFrameSchema>;
        """;

    private static string RenderSchemaLiteralUnion<TEnum>() where TEnum : struct, Enum =>
        string.Join(", ", Enum.GetValues<TEnum>().Select(value => ToJsonString(value.ToString())));

    private static string JoinPipe(IEnumerable<string> values) => string.Join("|", values.Where(value => !string.IsNullOrWhiteSpace(value)));

    private static IReadOnlyList<HostOperationDefinition> ProjectedOperations() =>
        HostOperationsCatalog.Bridge
            .Where(definition => definition.IsPublic)
            .OrderBy(definition => definition.Key, StringComparer.Ordinal)
            .ToArray();

    private static string RenderHostOperationCatalogEntries(IReadOnlyDictionary<string, string> exportedTypeNames) {
        var builder = new StringBuilder();
        foreach (var operation in ProjectedOperations()) {
            var metadata = operation.AgentMetadata;
            _ = builder.AppendLine($"  {ToJsonString(operation.Key)}: {{");
            AppendOperationDefinitionProperties(builder, operation, exportedTypeNames);
            _ = builder.AppendLine($"    displayName: {ToJsonString(operation.DisplayName ?? operation.Key)},");
            _ = builder.AppendLine($"    description: {ToJsonString(metadata.Description)},");
            _ = builder.AppendLine($"    searchTerms: {ToTsStringArray(metadata.SearchTerms)},");
            _ = builder.AppendLine($"    intent: {ToJsonString(metadata.Intent.ToString())},");
            _ = builder.AppendLine($"    requiresActiveDocument: {ToJsonBool(metadata.RequiresActiveDocument)},");
            _ = builder.AppendLine($"    costTier: {ToJsonString(metadata.CostTier.ToString())},");
            _ = builder.AppendLine($"    visibility: {ToJsonString(metadata.Visibility.ToString())},");
            _ = builder.AppendLine($"    requestExamples: {ToJson(metadata.RequestExamples)},");
            _ = builder.AppendLine($"    safeDefaultRequestJson: {ToJsonString(metadata.SafeDefaultRequestJson)},");
            _ = builder.AppendLine($"    callGuidance: {ToJsonString(metadata.CallGuidance)},");
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
        AppendOperationTypeMetadata(builder, operation, exportedTypeNames);
    }

    private static void AppendOperationTypeMetadata(
        StringBuilder builder,
        HostOperationDefinition operation,
        IReadOnlyDictionary<string, string>? exportedTypeNames
    ) {
        _ = builder.AppendLine($"    requestTypeName: {ToJsonString(GetOperationTypeName(operation.RequestType, exportedTypeNames, true))},");
        _ = builder.AppendLine($"    responseTypeName: {ToJsonString(GetOperationTypeName(operation.ResponseType, exportedTypeNames, false))},");
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

    private static string ToCamelCase(string value) => string.IsNullOrEmpty(value)
        ? value
        : char.ToLowerInvariant(value[0]) + value[1..];

    private static void ValidateProjectedTypeSymbols(IReadOnlyDictionary<string, string> exportedTypeNames) {
        var missingTypes = ProjectedOperations()
            .SelectMany(operation => new[] { operation.RequestType, operation.ResponseType })
            .Where(type => type != typeof(NoRequest))
            .Where(type => string.IsNullOrWhiteSpace(type.FullName) || !exportedTypeNames.ContainsKey(type.FullName!))
            .Select(type => type.FullName ?? type.Name)
            .Distinct(StringComparer.Ordinal)
            .OrderBy(name => name, StringComparer.Ordinal)
            .ToArray();
        if (missingTypes.Length != 0)
            throw new InvalidOperationException(
                $"Public host operation projection references types missing from host contract exports: {string.Join(", ", missingTypes)}. Mark each contract with [ExportTsSchema] from Pe.Shared.Codegen."
            );
    }

    private static IEnumerable<string> EnumerateGeneratedOwnedFiles(CodegenPaths paths) =>
        EnumerateContractFiles(paths)
            .Concat(EnumerateGeneratedDirectoryFiles(paths.HostEffectDirectory))
            .Concat(paths.LegacyHostProjectionDirectories.SelectMany(EnumerateGeneratedDirectoryFiles));

    private static IEnumerable<string> EnumerateContractFiles(CodegenPaths paths) =>
        Directory.Exists(paths.HostContractsDirectory)
            ? Directory.EnumerateFiles(paths.HostContractsDirectory, "*.ts", SearchOption.TopDirectoryOnly)
                .Where(path => {
                    var fileName = Path.GetFileName(path);
                    return IsOwnedContractFile(fileName);
                })
                .Select(Path.GetFullPath)
            : [];

    private static bool IsOwnedContractFile(string fileName) =>
        string.Equals(fileName, "index.ts", StringComparison.OrdinalIgnoreCase)
        || string.Equals(fileName, "host-operation-contracts.generated.ts", StringComparison.OrdinalIgnoreCase)
        || string.Equals(fileName, "host-operations.generated.ts", StringComparison.OrdinalIgnoreCase)
        || string.Equals(fileName, "bridge-protocol.generated.ts", StringComparison.OrdinalIgnoreCase)
        || string.Equals(fileName, "host-capability-map.generated.ts", StringComparison.OrdinalIgnoreCase)
        || (fileName.EndsWith(".generated.ts", StringComparison.OrdinalIgnoreCase)
            && !string.Equals(fileName, "product.generated.ts", StringComparison.OrdinalIgnoreCase));

    private static IEnumerable<string> EnumerateGeneratedDirectoryFiles(string directory) =>
        GeneratedProjectionSync.EnumerateFiles(directory, "*", SearchOption.AllDirectories);

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

    private static string ToJson<T>(T value) => JsonSerializer.Serialize(value, JsonOptions);

    private static string ToJsonBool(bool value) => value ? "true" : "false";

    private static string NormalizeLineEndings(string content) {
        var normalized = content.Replace("\r\n", "\n").Replace("\r", "\n");
        return normalized.TrimEnd() + "\n";
    }

    private sealed record GeneratedProjectionFile(string Path, string Content);
}
