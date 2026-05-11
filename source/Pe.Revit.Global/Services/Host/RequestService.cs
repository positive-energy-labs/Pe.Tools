using Pe.Revit.DocumentData.Parameters;
using Pe.Revit.Global.Services.Document;
using Pe.Revit.SettingsRuntime.Json;
using Pe.Revit.SettingsRuntime.Json.FieldOptions;
using Pe.Revit.SettingsRuntime.Json.SchemaDefinitions;
using Pe.Revit.SettingsRuntime.Json.SchemaProviders;
using Pe.Shared.HostContracts.SettingsStorage;
using Pe.Shared.RevitData;
using Pe.Shared.StorageRuntime.Capabilities;
using Pe.Shared.StorageRuntime.Modules;
using ricaun.Revit.UI.Tasks;
using Serilog;
using System.Runtime.ExceptionServices;
using FieldOptionItem = Pe.Shared.HostContracts.SettingsStorage.FieldOptionItem;

namespace Pe.Revit.Global.Services.Host;

/// <summary>
///     Revit-aware host operations served through the bridge.
/// </summary>
public class RequestService {
    private static readonly TimeSpan FieldOptionsThrottleWindow = TimeSpan.FromMilliseconds(350);
    private static readonly TimeSpan ParameterCatalogThrottleWindow = TimeSpan.FromMilliseconds(750);

    private readonly SettingsRuntimeRegistry _moduleRegistry;
    private readonly RevitTaskService _revitTaskService;
    private readonly ThrottleGate _throttleGate;

    public RequestService(
        RevitTaskService revitTaskService,
        SettingsRuntimeRegistry moduleRegistry,
        ThrottleGate throttleGate
    ) {
        this._revitTaskService = revitTaskService;
        this._moduleRegistry = moduleRegistry;
        this._throttleGate = throttleGate;
    }

    public async Task<FieldOptionsData> GetFieldOptionsAsync(
        FieldOptionsRequest request,
        string? connectionId = null
    ) {
        var key = BuildThrottleKey(
            connectionId,
            "field-options",
            request.ModuleKey,
            request.RootKey,
            $"{request.PropertyPath}:{request.SourceKey}",
            request.ContextValues
        );

        var (response, decision) = await this._throttleGate.ExecuteAsync(
            key,
            FieldOptionsThrottleWindow,
            () => this.GetFieldOptionsCore(request)
        );
        LogThrottleDecision(nameof(this.GetFieldOptionsAsync), decision, request.ModuleKey, request.PropertyPath);
        return response;
    }

    public async Task<ParameterCatalogData> GetParameterCatalogAsync(
        ParameterCatalogRequest request,
        string? connectionId = null
    ) {
        var key = BuildThrottleKey(
            connectionId,
            "parameter-catalog",
            request.ModuleKey,
            null,
            null,
            request.ContextValues
        );
        var (response, decision) = await this._throttleGate.ExecuteAsync(
            key,
            ParameterCatalogThrottleWindow,
            () => this.GetParameterCatalogCore(request)
        );
        LogThrottleDecision(nameof(this.GetParameterCatalogAsync), decision, request.ModuleKey, null);
        return response;
    }

    public async Task<FieldOptionsData> GetLoadedFamiliesFilterFieldOptionsAsync(
        LoadedFamiliesFilterFieldOptionsRequest request,
        string? connectionId = null
    ) {
        var key = BuildThrottleKey(
            connectionId,
            "loaded-families-filter-field-options",
            nameof(LoadedFamiliesFilter),
            null,
            $"{request.PropertyPath}:{request.SourceKey}",
            request.ContextValues
        );

        var (response, decision) = await this._throttleGate.ExecuteAsync(
            key,
            FieldOptionsThrottleWindow,
            () => this.GetLoadedFamiliesFilterFieldOptionsCore(request)
        );
        LogThrottleDecision(
            nameof(this.GetLoadedFamiliesFilterFieldOptionsAsync),
            decision,
            nameof(LoadedFamiliesFilter),
            request.PropertyPath
        );
        return response;
    }

    public Task<SchemaData> GetSchemaAsync(SchemaRequest request) =>
        this.EnqueueAsync(() => {
            try {
                var binding = this._moduleRegistry.ResolveRootBinding(request.ModuleKey, request.RootKey);
                var schema = RevitJsonSchemaFactory.CreateEditorSchemaData(
                    binding.SettingsType,
                    SettingsRuntimeMode.LiveDocument,
                    false
                );

                return new SchemaData(schema.SchemaJson, schema.FragmentSchemaJson);
            } catch (Exception ex) {
                throw BridgeOperationExceptions.Unexpected(
                    "SchemaGenerationException",
                    ex,
                    "Check root binding registration and shared authored schema definitions."
                );
            }
        });

    public Task<SchemaData> GetLoadedFamiliesFilterSchemaAsync() =>
        this.EnqueueAsync(() => {
            try {
                var schema = RevitJsonSchemaFactory.CreateEditorSchemaData(
                    typeof(LoadedFamiliesFilter),
                    SettingsRuntimeMode.LiveDocument,
                    false
                );

                return new SchemaData(schema.SchemaJson, schema.FragmentSchemaJson);
            } catch (Exception ex) {
                throw BridgeOperationExceptions.Unexpected(
                    "SchemaGenerationException",
                    ex,
                    "Check loaded families filter schema registration."
                );
            }
        });

    public Task<GetSettingsModuleCatalogBridgeResponse> GetSettingsModuleCatalogAsync(
        GetSettingsModuleCatalogBridgeRequest request
    ) => this.EnqueueAsync(() => {
        var activeDocument = RevitUiSession.CurrentUIApplication.GetActiveDocument();
        var modules = this._moduleRegistry.GetModules()
            .Where(SettingsModuleAvailability.IsBridgeDiscoverable)
            .Where(module => SettingsModuleAvailability.IsAvailableForDocument(module, activeDocument))
            .OrderBy(module => module.ModuleKey, StringComparer.OrdinalIgnoreCase)
            .Select(SettingsModuleAvailability.CreateSettingsModuleDescriptor)
            .ToList();

        return new GetSettingsModuleCatalogBridgeResponse(modules);
    });

    private Task<ParameterCatalogData> GetParameterCatalogCore(ParameterCatalogRequest request) =>
        this.EnqueueAsync(() => {
            try {
                var providerContext = CreateFieldOptionsContext(request.ContextValues);
                var doc = providerContext.GetActiveDocument();
                if (doc == null) {
                    throw BridgeOperationExceptions.Conflict(
                        "No active document.",
                        [
                            BridgeOperationExceptions.Issue(
                                "$",
                                "NoActiveDocument",
                                "No active document.",
                                "Open a Revit document and retry."
                            )
                        ]
                    );
                }

                var entries = ParameterCatalogOptionFactory.Build(providerContext)
                    .Select(ToHostParameterCatalogEntry)
                    .ToList();

                var familyCount = entries.SelectMany(e => e.FamilyNames).Distinct(StringComparer.OrdinalIgnoreCase)
                    .Count();
                var typeCount = entries.SelectMany(e => e.TypeNames).Distinct(StringComparer.Ordinal).Count();

                return new ParameterCatalogData(entries, familyCount, typeCount);
            } catch (BridgeOperationException) {
                throw;
            } catch (Exception ex) {
                throw BridgeOperationExceptions.Unexpected(
                    "ParameterCatalogException",
                    ex,
                    "Verify selected families and active document state."
                );
            }
        });

    private Task<FieldOptionsData> GetLoadedFamiliesFilterFieldOptionsCore(
        LoadedFamiliesFilterFieldOptionsRequest request
    ) => this.EnqueueAsync(() => {
        try {
            var fieldOptions = SettingsFieldOptionsService.Shared.GetOptionsAsync(
                    typeof(LoadedFamiliesFilter),
                    request.PropertyPath,
                    request.SourceKey,
                    CreateFieldOptionsContext(request.ContextValues)
                )
                .AsTask()
                .GetAwaiter()
                .GetResult();

            return CreateFieldOptionsData(request.SourceKey, fieldOptions);
        } catch (BridgeOperationException) {
            throw;
        } catch (Exception ex) {
            Log.Error(
                ex,
                "GetLoadedFamiliesFilterFieldOptions failed for property '{PropertyPath}'",
                request.PropertyPath
            );
            throw BridgeOperationExceptions.Unexpected(
                "FieldOptionsException",
                ex,
                "Check provider configuration and request path."
            );
        }
    });

    private Task<FieldOptionsData> GetFieldOptionsCore(FieldOptionsRequest request) =>
        this.EnqueueAsync(() => {
            try {
                var type = this._moduleRegistry.ResolveRootBinding(request.ModuleKey, request.RootKey).SettingsType;
                var property = SettingsPropertyPathResolver.ResolveProperty(type, request.PropertyPath);

                if (property == null)
                    return EmptyFieldOptionsData(request.SourceKey);

                var fieldOptions = SettingsFieldOptionsService.Shared.GetOptionsAsync(
                        type,
                        request.PropertyPath,
                        request.SourceKey,
                        CreateFieldOptionsContext(request.ContextValues)
                    )
                    .AsTask()
                    .GetAwaiter()
                    .GetResult();

                return CreateFieldOptionsData(request.SourceKey, fieldOptions);
            } catch (BridgeOperationException) {
                throw;
            } catch (Exception ex) {
                Log.Error(ex, "GetFieldOptions failed for property '{PropertyPath}'", request.PropertyPath);
                throw BridgeOperationExceptions.Unexpected(
                    "FieldOptionsException",
                    ex,
                    "Check provider configuration and request path."
                );
            }
        });

    private async Task<T> EnqueueAsync<T>(Func<T> action) {
        var queueStopwatch = Stopwatch.StartNew();
        Log.Information("Host request queue starting: ResultType={ResultType}", typeof(T).Name);
        T? result = default;
        Exception? failure = null;
        var completed = false;
        _ = await this._revitTaskService.Run(async () => {
            Log.Information(
                "Host request queue running on Revit thread after {ElapsedMs} ms: ResultType={ResultType}",
                queueStopwatch.ElapsedMilliseconds,
                typeof(T).Name
            );
            try {
                result = action();
                completed = true;
            } catch (Exception ex) {
                failure = ex;
            }

            await Task.CompletedTask;
        });

        if (failure != null)
            ExceptionDispatchInfo.Capture(failure).Throw();

        if (!completed) {
            throw BridgeOperationExceptions.Unexpected(
                "RequestQueueNoResult",
                new InvalidOperationException($"Revit request queue produced no result for '{typeof(T).Name}'."),
                "Check the Revit task queue execution path for swallowed exceptions."
            );
        }

        Log.Information(
            "Host request queue completed in {ElapsedMs} ms: ResultType={ResultType}",
            queueStopwatch.ElapsedMilliseconds,
            typeof(T).Name
        );
        return result!;
    }

    private static FieldOptionsData CreateFieldOptionsData(
        string sourceKey,
        FieldOptionsResult fieldOptions
    ) {
        if (fieldOptions.Kind == FieldOptionsResultKind.Empty)
            return EmptyFieldOptionsData(sourceKey);

        if (fieldOptions.Kind == FieldOptionsResultKind.Unsupported) {
            throw BridgeOperationExceptions.Conflict(
                fieldOptions.Message,
                [
                    BridgeOperationExceptions.Issue(
                        "$",
                        "FieldOptionsUnsupported",
                        fieldOptions.Message,
                        "Check active document state and runtime capability availability."
                    )
                ]
            );
        }

        if (fieldOptions.Kind == FieldOptionsResultKind.Failure) {
            throw BridgeOperationExceptions.Conflict(
                fieldOptions.Message,
                [
                    BridgeOperationExceptions.Issue(
                        "$",
                        "FieldOptionsException",
                        fieldOptions.Message,
                        "Check field option source configuration and request path."
                    )
                ]
            );
        }

        return new FieldOptionsData(
            sourceKey,
            FieldOptionsMode.Suggestion,
            true,
            fieldOptions.Items.Select(ToFieldOptionItem).ToList()
        );
    }

    private static FieldOptionsData EmptyFieldOptionsData(string sourceKey) =>
        new(
            sourceKey,
            FieldOptionsMode.Suggestion,
            true,
            []
        );

    private static FieldOptionsExecutionContext CreateFieldOptionsContext(
        IReadOnlyDictionary<string, string>? contextValues = null
    ) => new(
        SettingsRuntimeMode.LiveDocument,
        contextValues
    );

    private static ParameterCatalogEntry ToHostParameterCatalogEntry(ParameterCatalogOption entry) =>
        new(
            ParameterIdentityEngine.FromCanonical(entry.Identity),
            entry.StorageType,
            entry.DataType,
            entry.IsInstance,
            entry.IsParamService,
            entry.FamilyNames,
            entry.TypeNames
        );

    private static FieldOptionItem ToFieldOptionItem(
        SettingsRuntime.Json.FieldOptions.FieldOptionItem item
    ) => new(
        item.Value,
        item.Label,
        item.Description
    );

    private static string BuildThrottleKey(
        string? connectionId,
        string endpoint,
        string moduleKey,
        string? rootKey,
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
        return
            $"{connectionId ?? "no-connection"}:{endpoint}:{moduleKey}:{rootKey ?? string.Empty}:{propertyPath ?? string.Empty}:{siblingSignature}";
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

        if (decision == ThrottleDecision.Coalesced) {
            Log.Debug(
                "Throttle coalesced request: Endpoint={Endpoint}, ModuleKey={ModuleKey}, PropertyPath={PropertyPath}",
                endpoint,
                moduleKey,
                propertyPath
            );
        }
    }
}
