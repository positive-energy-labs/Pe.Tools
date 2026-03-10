using Microsoft.AspNetCore.SignalR;
using Newtonsoft.Json;
using Newtonsoft.Json.Linq;
using Pe.Global.Services.Aps.Models;
using Pe.Global.Services.Storage.Core;
using Pe.Global.Services.Storage.Core.Json;
using Pe.Global.Services.Storage.Core.Json.SchemaProcessors;
using Pe.Global.Services.Storage.Core.Json.SchemaProviders;
using Pe.Global.Services.Storage.Modules;
using Serilog;
using System.Reflection;

namespace Pe.Global.Services.SignalR.Hubs;

/// <summary>
///     Unified SignalR hub for external settings-editor integration.
///     Exposes schema, validation, field-options, and document-aware catalog endpoints.
///     File listing/read/write and JSON composition are handled locally by storage services.
/// </summary>
public class SettingsEditorHub : Hub {
    private static readonly TimeSpan FieldOptionsThrottleWindow = TimeSpan.FromMilliseconds(350);
    private static readonly TimeSpan ParameterCatalogThrottleWindow = TimeSpan.FromMilliseconds(750);

    private readonly SettingsModuleRegistry _moduleRegistry;
    private readonly RevitTaskQueue _taskQueue;
    private readonly EndpointThrottleGate _throttleGate;

    public SettingsEditorHub(
        RevitTaskQueue taskQueue,
        SettingsModuleRegistry moduleRegistry,
        EndpointThrottleGate throttleGate
    ) {
        this._taskQueue = taskQueue;
        this._moduleRegistry = moduleRegistry;
        this._throttleGate = throttleGate;
    }

    public override async Task OnConnectedAsync() {
        HubConnectionTracker.Add(this.Context.ConnectionId);
        Log.Debug(
            "SettingsEditorHub connected: ConnectionId={ConnectionId}, ActiveConnections={ActiveConnections}",
            this.Context.ConnectionId,
            HubConnectionTracker.ActiveConnectionCount
        );
        await base.OnConnectedAsync();
    }

    public override async Task OnDisconnectedAsync(Exception? exception) {
        HubConnectionTracker.Remove(this.Context.ConnectionId);
        Log.Debug(
            "SettingsEditorHub disconnected: ConnectionId={ConnectionId}, ActiveConnections={ActiveConnections}",
            this.Context.ConnectionId,
            HubConnectionTracker.ActiveConnectionCount
        );
        await base.OnDisconnectedAsync(exception);
    }

    public async Task<SchemaEnvelopeResponse> GetSchemaEnvelope(SchemaRequest request) {
        var result = await this.GetSchemaCore(request);
        return result.ToSchemaEnvelope();
    }

    public Task<ServerCapabilitiesEnvelopeResponse> GetServerCapabilitiesEnvelope() {
        try {
            var data = this.BuildServerCapabilitiesCore();
            return Task.FromResult(
                HubResult
                    .Success(
                        data,
                        EnvelopeCode.Ok,
                        $"Resolved {data.AvailableModules.Count} registered settings modules."
                    )
                    .ToServerCapabilitiesEnvelope()
            );
        } catch (Exception ex) {
            return Task.FromResult(
                HubResult
                    .Failure<ServerCapabilitiesData>(
                        EnvelopeCode.Failed,
                        ex.Message,
                        [
                            HubResult.ExceptionIssue(
                                "GetServerCapabilitiesException",
                                ex,
                                "Verify module registration and transport metadata configuration."
                            )
                        ]
                    )
                    .ToServerCapabilitiesEnvelope()
            );
        }
    }

    public async Task<FieldOptionsEnvelopeResponse> GetFieldOptionsEnvelope(FieldOptionsRequest request) {
        var key = BuildThrottleKey(
            this.Context.ConnectionId,
            "field-options",
            request.ModuleKey,
            $"{request.PropertyPath}:{request.SourceKey}",
            request.ContextValues
        );

        var (response, decision) = await this._throttleGate.ExecuteAsync(
            key,
            FieldOptionsThrottleWindow,
            async () => {
                var result = await this.GetFieldOptionsCore(request);
                return new FieldOptionsEnvelopeResponse(
                    result.Ok,
                    result.Code,
                    result.Message,
                    result.Issues,
                    result.Data
                );
            }
        );
        LogThrottleDecision(nameof(GetFieldOptionsEnvelope), decision, request.ModuleKey, request.PropertyPath);
        return response;
    }

    public async Task<ValidationEnvelopeResponse> ValidateSettingsEnvelope(ValidateSettingsRequest request) {
        var result = await this.ValidateSettingsCore(request);
        return result.ToValidationEnvelope();
    }

    public async Task<ParameterCatalogEnvelopeResponse> GetParameterCatalogEnvelope(ParameterCatalogRequest request) {
        var key = BuildThrottleKey(
            this.Context.ConnectionId,
            "parameter-catalog",
            request.ModuleKey,
            null,
            request.ContextValues
        );
        var (response, decision) = await this._throttleGate.ExecuteAsync(
            key,
            ParameterCatalogThrottleWindow,
            () => this.GetParameterCatalogCore(request)
        );
        LogThrottleDecision(nameof(GetParameterCatalogEnvelope), decision, request.ModuleKey, null);
        return response;
    }

    private async Task<ParameterCatalogEnvelopeResponse> GetParameterCatalogCore(ParameterCatalogRequest request) =>
        await this._taskQueue.EnqueueAsync(uiApp => {
            try {
                var doc = uiApp.ActiveUIDocument?.Document;
                if (doc == null)
                    return HubResult
                        .Failure<ParameterCatalogData>(
                            EnvelopeCode.NoDocument,
                            "No active document.",
                            [
                                new ValidationIssue(
                                    "$",
                                    null,
                                    "NoActiveDocument",
                                    "error",
                                    "No active document.",
                                    "Open a Revit document and retry."
                                )
                            ]
                        )
                        .ToParameterCatalogEnvelope();

                var selectedFamilies = ParseSelectedFamilyNames(request.ContextValues);
                var entries = ParameterCatalogOptionFactory.Build(selectedFamilies);

                var familyCount = entries.SelectMany(e => e.FamilyNames).Distinct(StringComparer.OrdinalIgnoreCase).Count();
                var typeCount = entries.SelectMany(e => e.TypeNames).Distinct(StringComparer.Ordinal).Count();

                return HubResult
                    .Success(
                        new ParameterCatalogData(entries, familyCount, typeCount),
                        EnvelopeCode.Ok,
                        $"Collected {entries.Count} parameter entries across {familyCount} families."
                    )
                    .ToParameterCatalogEnvelope();
            } catch (Exception ex) {
                return HubResult
                    .Failure<ParameterCatalogData>(
                        EnvelopeCode.Failed,
                        ex.Message,
                        [
                            HubResult.ExceptionIssue(
                                "ParameterCatalogException",
                                ex,
                                "Verify selected families and active document state."
                            )
                        ]
                    )
                    .ToParameterCatalogEnvelope();
            }
        });

    private SettingsCatalogData BuildSettingsCatalogCore(SettingsCatalogRequest request) {
        var targets = this.BuildAvailableModules()
            .Where(module =>
                string.IsNullOrWhiteSpace(request.ModuleKey) ||
                module.ModuleKey.Equals(request.ModuleKey, StringComparison.OrdinalIgnoreCase))
            .Select(module => new SettingsCatalogItem(
                module.ModuleKey,
                $"{module.ModuleKey} / {module.SettingsTypeName} / {module.DefaultSubDirectory}",
                module.ModuleKey,
                module.DefaultSubDirectory
            ))
            .ToList();
        return new SettingsCatalogData(targets);
    }

    private ServerCapabilitiesData BuildServerCapabilitiesCore() {
        var availableModules = this.BuildAvailableModules();
        var supportedDatasets = Enum.GetValues<FieldOptionsDatasetKind>().ToList();

        return new ServerCapabilitiesData(
            ContractVersion: SettingsEditorProtocol.ContractVersion,
            Transport: SettingsEditorProtocol.Transport,
            ServerVersion: GetServerVersion(),
            SupportsFragmentSchema: true,
            SupportsRichInvalidationPayload: true,
            SupportsFieldOptionDatasets: supportedDatasets.Count > 0,
            SupportedDatasets: supportedDatasets,
            AvailableModules: availableModules
        );
    }

    public Task<SettingsCatalogEnvelopeResponse> GetSettingsCatalogEnvelope(SettingsCatalogRequest request) {
        try {
            var data = this.BuildSettingsCatalogCore(request);
            return Task.FromResult(
                HubResult
                    .Success(
                        data,
                        EnvelopeCode.Ok,
                        $"Found {data.Targets.Count} settings targets."
                    )
                    .ToSettingsCatalogEnvelope()
            );
        } catch (Exception ex) {
            return Task.FromResult(
                HubResult
                    .Failure<SettingsCatalogData>(
                        EnvelopeCode.Failed,
                        ex.Message,
                        [
                            HubResult.ExceptionIssue(
                                "GetSettingsCatalogException",
                                ex,
                                "Verify module registration and settings contract metadata."
                            )
                        ]
                    )
                    .ToSettingsCatalogEnvelope()
            );
        }
    }

    private async Task<HubResult<SchemaData>> GetSchemaCore(SchemaRequest request) =>
        await this._taskQueue.EnqueueAsync(uiApp => {
            try {
                var module = this._moduleRegistry.ResolveByModuleKey(request.ModuleKey);
                var type = module.SettingsType;
                var targetSchemaJson = JsonSchemaFactory.CreateRenderSchemaJson(type, out _);

                string? fragmentSchemaJson = null;
                try {
                    var fragmentSchema = JsonSchemaFactory.CreateFragmentSchema(type, out var fragProcessor);
                    if (fragmentSchema != null) {
                        fragProcessor.Finalize(fragmentSchema);
                        fragmentSchemaJson = RenderSchemaTransformer.TransformFragmentToJson(fragmentSchema, type);
                    }
                } catch (Exception ex) {
                    Log.Warning(
                        ex,
                        "Fragment schema generation failed: ModuleKey={ModuleKey}, SettingsType={SettingsType}",
                        module.ModuleKey,
                        type.FullName ?? type.Name
                    );
                }

                return HubResult.Success(
                    new SchemaData(targetSchemaJson, fragmentSchemaJson),
                    EnvelopeCode.Ok,
                    "Schema generated."
                );
            } catch (Exception ex) {
                return HubResult.Failure<SchemaData>(
                    EnvelopeCode.Failed,
                    ex.Message,
                    [
                        HubResult.ExceptionIssue(
                            "SchemaException",
                            ex,
                            "Ensure module registration and schema processors are valid."
                        )
                    ]
                );
            }
        });

    private async Task<HubResult<ValidationData>> ValidateSettingsCore(ValidateSettingsRequest request) =>
        await this._taskQueue.EnqueueAsync(uiApp => {
            try {
                var type = this._moduleRegistry.ResolveByModuleKey(request.ModuleKey).SettingsType;
                var schema = JsonSchemaFactory.CreateAuthoringSchema(type, out var examplesProcessor);
                examplesProcessor.Finalize(schema);

                var issues = ValidationIssueMapper.ToValidationIssues(schema.Validate(request.SettingsJson)).ToList();

                return HubResult.Success(
                    new ValidationData(issues.Count == 0, issues),
                    EnvelopeCode.Ok,
                    issues.Count == 0 ? "Validation passed." : "Validation returned issues.",
                    issues
                );
            } catch (Exception ex) {
                var issues = new List<ValidationIssue> {
                    new(
                        "$",
                        null,
                        "ValidationException",
                        "error",
                        ex.Message,
                        "Ensure moduleKey is registered and settingsJson is valid JSON."
                    )
                };
                return HubResult.Failure<ValidationData>(
                    EnvelopeCode.Failed,
                    ex.Message,
                    issues
                ) with { Data = new ValidationData(false, issues) };
            }
        });

    private async Task<HubResult<FieldOptionsData>> GetFieldOptionsCore(FieldOptionsRequest request) =>
        await this._taskQueue.EnqueueAsync(uiApp => {
            try {
                var type = this._moduleRegistry.ResolveByModuleKey(request.ModuleKey).SettingsType;
                var property = ResolveProperty(type, request.PropertyPath);

                if (property == null)
                    return HubResult.Success(
                        new FieldOptionsData(
                            request.SourceKey,
                            FieldOptionsMode.Suggestion,
                            true,
                            []
                        ),
                        EnvelopeCode.Ok,
                        "Property not found for field options provider."
                    );

                var providerAttr = property.GetCustomAttribute<SchemaExamplesAttribute>();
                if (providerAttr == null)
                    return HubResult.Success(
                        new FieldOptionsData(
                            request.SourceKey,
                            FieldOptionsMode.Suggestion,
                            true,
                            []
                        ),
                        EnvelopeCode.Ok,
                        "No field options provider configured for property."
                    );
                if (!string.Equals(providerAttr.ProviderType.Name, request.SourceKey, StringComparison.Ordinal))
                    return HubResult.Success(
                        new FieldOptionsData(
                            request.SourceKey,
                            FieldOptionsMode.Suggestion,
                            true,
                            []
                        ),
                        EnvelopeCode.Ok,
                        "Requested field options source does not match property provider."
                    );

                var provider = Activator.CreateInstance(providerAttr.ProviderType) as IOptionsProvider;
                if (provider == null)
                    return HubResult.Failure<FieldOptionsData>(
                        EnvelopeCode.Failed,
                        $"Failed to create provider '{providerAttr.ProviderType.Name}'.",
                        [
                            new ValidationIssue(
                                "$",
                                null,
                                "ProviderCreationFailed",
                                "error",
                                $"Failed to create provider '{providerAttr.ProviderType.Name}'.",
                                "Ensure provider has a public parameterless constructor."
                            )
                        ]
                    ) with {
                        Data = new FieldOptionsData(
                            request.SourceKey,
                            FieldOptionsMode.Suggestion,
                            true,
                            []
                        )
                    };

                var items = ResolveFieldOptionItems(provider, request.ContextValues);

                return HubResult.Success(
                    new FieldOptionsData(
                        request.SourceKey,
                        FieldOptionsMode.Suggestion,
                        true,
                        items
                    ),
                    EnvelopeCode.Ok,
                    $"Retrieved {items.Count} field options."
                );
            } catch (Exception ex) {
                Log.Error(ex, "GetFieldOptions failed for property '{PropertyPath}'", request.PropertyPath);
                return HubResult.Failure<FieldOptionsData>(
                    EnvelopeCode.Failed,
                    ex.Message,
                    [
                        HubResult.ExceptionIssue(
                            "FieldOptionsException",
                            ex,
                            "Check provider configuration and request path."
                        )
                    ]
                ) with {
                    Data = new FieldOptionsData(
                        request.SourceKey,
                        FieldOptionsMode.Suggestion,
                        true,
                        []
                    )
                };
            }
        });

    private static PropertyInfo? ResolveProperty(Type type, string propertyPath) {
        var parts = propertyPath.Split('.');
        PropertyInfo? property = null;
        var currentType = type;

        foreach (var part in parts) {
            if (part == "items") {
                if (currentType.IsGenericType)
                    currentType = currentType.GetGenericArguments()[0];

                continue;
            }

            property = currentType.GetProperty(part,
                BindingFlags.Public | BindingFlags.Instance | BindingFlags.IgnoreCase);
            if (property == null) {
                Log.Debug("ResolveProperty: Property '{Part}' not found on type '{CurrentType}'", part,
                    currentType.Name);
                return null;
            }

            currentType = property.PropertyType;

            if (currentType.IsGenericType && currentType.GetGenericTypeDefinition() == typeof(List<>))
                currentType = currentType.GetGenericArguments()[0];
        }

        return property;
    }

    private List<SettingsModuleDescriptor> BuildAvailableModules() =>
        this._moduleRegistry.GetModules()
            .OrderBy(module => module.ModuleKey, StringComparer.OrdinalIgnoreCase)
            .Select(module => new SettingsModuleDescriptor(
                ModuleKey: module.ModuleKey,
                DefaultSubDirectory: module.DefaultSubDirectory,
                SettingsTypeName: module.SettingsTypeName,
                SettingsTypeFullName: module.SettingsType.FullName ?? module.SettingsType.Name
            ))
            .ToList();

    private static string? GetServerVersion() =>
        typeof(SettingsEditorHub).Assembly.GetName().Version?.ToString();

    private static HashSet<string> ParseSelectedFamilyNames(IReadOnlyDictionary<string, string>? contextValues) {
        if (contextValues == null ||
            !contextValues.TryGetValue(OptionContextKeys.SelectedFamilyNames, out var rawFamilyNames))
            return new HashSet<string>(StringComparer.OrdinalIgnoreCase);

        return ProjectFamilyParameterCollector.ParseDelimitedFamilyNames(rawFamilyNames);
    }

    private static List<FieldOptionItem> ResolveFieldOptionItems(
        IOptionsProvider provider,
        IReadOnlyDictionary<string, string>? contextValues
    ) {
        if (provider is IDependentOptionsProvider dependentProvider &&
            contextValues is { Count: > 0 })
            return dependentProvider
                .GetExamples(contextValues)
                .Select(ToFieldOptionItem)
                .ToList();

        return provider
            .GetExamples()
            .Select(ToFieldOptionItem)
            .ToList();
    }

    private static FieldOptionItem ToFieldOptionItem(string value) =>
        new(
            Value: value,
            Label: value,
            Description: null
        );

    private static string BuildThrottleKey(
        string? connectionId,
        string endpoint,
        string moduleKey,
        string? propertyPath,
        IReadOnlyDictionary<string, string>? siblingValues
    ) {
        var siblingSignature = siblingValues == null || siblingValues.Count == 0
            ? string.Empty
            : string.Join(
                "&",
                siblingValues
                    .OrderBy(pair => pair.Key, StringComparer.Ordinal)
                    .Select(pair => $"{pair.Key}={pair.Value}")
            );
        return $"{connectionId ?? "no-connection"}:{endpoint}:{moduleKey}:{propertyPath ?? string.Empty}:{siblingSignature}";
    }

    private static void LogThrottleDecision(
        string endpoint,
        ThrottleDecision decision,
        string moduleKey,
        string? propertyPath
    ) {
        if (decision == ThrottleDecision.CacheHit) {
            Log.Debug(
                "Throttle cache hit: Endpoint={Endpoint}, ModuleKey={ModuleKey}, PropertyPath={PropertyPath}",
                endpoint,
                moduleKey,
                propertyPath
            );
            return;
        }

        if (decision == ThrottleDecision.Coalesced)
            Log.Debug(
                "Throttle coalesced request: Endpoint={Endpoint}, ModuleKey={ModuleKey}, PropertyPath={PropertyPath}",
                endpoint,
                moduleKey,
                propertyPath
            );
    }
}
