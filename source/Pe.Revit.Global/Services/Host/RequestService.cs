using Pe.Revit.DocumentData.Parameters;
using Pe.Revit.Global.Services.Document;
using Pe.Revit.Operations;
using Pe.Revit.SettingsRuntime.Json;
using Pe.Revit.SettingsRuntime.Json.ValueDomains;
using Pe.Revit.SettingsRuntime.Json.SchemaDefinitions;
using Pe.Revit.SettingsRuntime.Json.SchemaProviders;
using Pe.Revit.SettingsRuntime.Validation;
using Pe.Shared.HostContracts.Operations;
using Pe.Shared.HostContracts.SettingsStorage;
using Pe.Shared.RevitData;
using Pe.Shared.StorageRuntime.Capabilities;
using Pe.Shared.StorageRuntime.Modules;
using Pe.Revit.Tasks;
using Serilog;
using FieldOptionItem = Pe.Shared.HostContracts.SettingsStorage.FieldOptionItem;

namespace Pe.Revit.Global.Services.Host;

/// <summary>
///     Revit-aware host operations served through the bridge.
/// </summary>
public class RequestService {
    private static readonly TimeSpan FieldOptionsThrottleWindow = TimeSpan.FromMilliseconds(350);
    private static readonly TimeSpan ParameterCatalogThrottleWindow = TimeSpan.FromMilliseconds(750);

    private readonly SettingsRuntimeRegistry _moduleRegistry;
    private readonly RevitTaskQueue _revitTaskQueue;
    private readonly ThrottleGate _throttleGate;

    public RequestService(
        RevitTaskQueue revitTaskQueue,
        SettingsRuntimeRegistry moduleRegistry,
        ThrottleGate throttleGate
    ) {
        this._revitTaskQueue = revitTaskQueue;
        this._moduleRegistry = moduleRegistry;
        this._throttleGate = throttleGate;
    }

    [Op("settings.field-options", Does = "Read document-specific field option values for one field of the settings library a `$schema` URL names.", Title = "Get Settings Field Options", Finds = ["settings", "field-options", "schema", "document"], Tier = OpTier.Expert)]
    public async Task<FieldOptionsData> GetFieldOptionsAsync(
        FieldOptionsRequest request,
        RevitDocument document,
        CancellationToken cancellationToken
    ) {
        var key = BuildThrottleKey(
            "field-options",
            request.SchemaUrl,
            $"{request.PropertyPath}:{request.SourceKey}",
            request.ContextValues
        );

        var (response, decision) = await this._throttleGate.ExecuteAsync(
            key,
            FieldOptionsThrottleWindow,
            () => this.GetFieldOptionsCore(request, document, cancellationToken)
        );
        LogThrottleDecision(nameof(this.GetFieldOptionsAsync), decision, request.SchemaUrl, request.PropertyPath);
        return response;
    }

    [Op("settings.parameter-catalog", Does = "Read Revit parameter definitions and available parameter facts from the active document for settings authoring.", Title = "Get Parameter Catalog", Finds = ["parameters", "catalog", "settings", "document"])]
    public async Task<ParameterCatalogData> GetParameterCatalogAsync(
        ParameterCatalogRequest request,
        RevitDocument document,
        CancellationToken cancellationToken
    ) {
        var key = BuildThrottleKey(
            "parameter-catalog",
            null,
            null,
            request.ContextValues
        );
        var (response, decision) = await this._throttleGate.ExecuteAsync(
            key,
            ParameterCatalogThrottleWindow,
            () => this.GetParameterCatalogCore(request, document, cancellationToken)
        );
        LogThrottleDecision(nameof(this.GetParameterCatalogAsync), decision, "parameter-catalog", null);
        return response;
    }

    [Op("revit.catalog.loaded-families.filter-field-options", Does = "Read document-specific option values for loaded-family query filters.", Title = "Get Loaded Families Filter Field Options", Finds = ["loaded-families", "families", "filter", "field-options"], Tier = OpTier.Expert)]
    public async Task<FieldOptionsData> GetLoadedFamiliesFilterFieldOptionsAsync(
        LoadedFamiliesFilterFieldOptionsRequest request,
        RevitDocument document,
        CancellationToken cancellationToken
    ) {
        var key = BuildThrottleKey(
            "loaded-families-filter-field-options",
            nameof(LoadedFamiliesFilter),
            $"{request.PropertyPath}:{request.SourceKey}",
            request.ContextValues
        );

        var (response, decision) = await this._throttleGate.ExecuteAsync(
            key,
            FieldOptionsThrottleWindow,
            () => this.GetLoadedFamiliesFilterFieldOptionsCore(request, document, cancellationToken)
        );
        LogThrottleDecision(
            nameof(this.GetLoadedFamiliesFilterFieldOptionsAsync),
            decision,
            nameof(LoadedFamiliesFilter),
            request.PropertyPath
        );
        return response;
    }

    [Op("revit.catalog.field-options", Does = "Read document-specific option values for a value-domain source key (e.g. category-names, family-names). Request schemas mark option-backed fields with an x-options.key annotation that resolves through this operation.", Title = "Get Field Options", Finds = ["field-options", "value-domain", "options", "categories", "families", "suggestions"], Tier = OpTier.Expert, Example = "{ \"sourceKey\": \"category-names\" }")]
    public async Task<FieldOptionsData> GetValueDomainOptionsAsync(
        ValueDomainOptionsRequest request,
        RevitDocument document,
        CancellationToken cancellationToken
    ) {
        var key = BuildThrottleKey(
            "value-domain-options",
            request.SourceKey,
            null,
            request.ContextValues
        );

        var (response, decision) = await this._throttleGate.ExecuteAsync(
            key,
            FieldOptionsThrottleWindow,
            () => this.GetValueDomainOptionsCore(request, document, cancellationToken)
        );
        LogThrottleDecision(nameof(this.GetValueDomainOptionsAsync), decision, request.SourceKey, null);
        return response;
    }

    [Op("settings.schema", Does = "Read the live editor schema of the settings library a `$schema` URL names.", Title = "Get Schema", Finds = ["schema", "settings", "profile", "profiles", "module", "family-foundry"])]
    public Task<SchemaData> GetSchemaAsync(SchemaRequest request, RevitDocument document, CancellationToken cancellationToken) =>
        this.EnqueueAsync(() => {
            try {
                var binding = this._moduleRegistry.ResolveSchemaUrl(request.SchemaUrl);
                var schema = RevitJsonSchemaFactory.CreateEditorSchemaData(
                    binding.SettingsType,
                    SettingsRuntimeMode.LiveDocument,
                    false,
                    document.Value
                );

                return new SchemaData(schema.SchemaJson, schema.FragmentSchemaJson);
            } catch (Exception ex) {
                throw BridgeOperationExceptions.Unexpected(
                    "SchemaGenerationException",
                    ex,
                    "Check root binding registration and shared authored schema definitions."
                );
            }
        }, cancellationToken);

    [Op("settings.validate", Does = "Run the typed semantic validator of the settings library a `$schema` URL names, after host-owned structural validation.", Title = "Validate Settings", Finds = ["settings", "validation", "semantic", "spec"], IsPublic = false)]
    public Task<SettingsValidateData> ValidateSettingsAsync(
        SettingsValidateRequest request,
        CancellationToken cancellationToken
    ) {
        var binding = this._moduleRegistry.ResolveSchemaUrl(request.SchemaUrl);
        var configured = SettingsDocumentValidatorRegistry.Shared.TryValidate(
            binding.SettingsType,
            new SettingsDocumentValidationContext(request.RawContent, request.ComposedContent),
            out var issues);
        return Task.FromResult(new SettingsValidateData(
            configured,
            issues.Select(issue => new ValidationIssue(
                issue.Path,
                null,
                issue.Code,
                issue.Severity,
                issue.Message,
                issue.Suggestion)).ToList()));
    }

    [Op("revit.catalog.loaded-families.filter-schema", Does = "Read the filter schema for loaded-family catalog and matrix queries.", Title = "Get Loaded Families Filter Schema", Finds = ["loaded-families", "families", "filter", "schema"], Tier = OpTier.Expert)]
    public Task<SchemaData> GetLoadedFamiliesFilterSchemaAsync(NoRequest _, RevitDocument document, CancellationToken cancellationToken) =>
        this.EnqueueAsync(() => {
            try {
                var schema = RevitJsonSchemaFactory.CreateEditorSchemaData(
                    typeof(LoadedFamiliesFilter),
                    SettingsRuntimeMode.LiveDocument,
                    false,
                    document.Value
                );

                return new SchemaData(schema.SchemaJson, schema.FragmentSchemaJson);
            } catch (Exception ex) {
                throw BridgeOperationExceptions.Unexpected(
                    "SchemaGenerationException",
                    ex,
                    "Check loaded families filter schema registration."
                );
            }
        }, cancellationToken);

    private Task<ParameterCatalogData> GetParameterCatalogCore(ParameterCatalogRequest request, RevitDocument document, CancellationToken cancellationToken) =>
        this.EnqueueAsync(() => {
            try {
                var valueDomainContext = CreateValueDomainContext(document, request.ContextValues);

                var entries = ParameterCatalogOptionFactory.Build(valueDomainContext)
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
        }, cancellationToken);

    private Task<FieldOptionsData> GetLoadedFamiliesFilterFieldOptionsCore(
        LoadedFamiliesFilterFieldOptionsRequest request,
        RevitDocument document,
        CancellationToken cancellationToken
    ) => this.EnqueueAsync(() => {
        try {
            var fieldOptions = SettingsValueDomainService.Shared.GetOptionsAsync(
                    typeof(LoadedFamiliesFilter),
                    request.PropertyPath,
                    request.SourceKey,
                    CreateValueDomainContext(document, request.ContextValues)
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
                "Check value-domain configuration and request path."
            );
        }
    }, cancellationToken);

    // Resolves a value domain by source key alone — no settings module or property binding.
    // This is the runtime side of FieldOptionsAttribute / x-options on request schemas.
    private Task<FieldOptionsData> GetValueDomainOptionsCore(ValueDomainOptionsRequest request, RevitDocument document, CancellationToken cancellationToken) =>
        this.EnqueueAsync(() => {
            if (!SettingsValueDomainRegistry.Shared.TryCreate(request.SourceKey, out var domain))
                throw BridgeOperationExceptions.BadRequest(
                    $"Unknown value domain source key '{request.SourceKey}'.",
                    [
                        BridgeOperationExceptions.Issue(
                            "$.sourceKey",
                            "UnknownValueDomain",
                            $"No value domain is registered for '{request.SourceKey}'.",
                            "Use a source key from a request schema x-options annotation."
                        )
                    ]
                );

            try {
                var items = domain.GetOptionsAsync(CreateValueDomainContext(document, request.ContextValues))
                    .AsTask()
                    .GetAwaiter()
                    .GetResult();
                var descriptor = domain.Describe();
                return new FieldOptionsData(
                    request.SourceKey,
                    ToHostFieldOptionsMode(descriptor.Mode),
                    descriptor.AllowsCustomValue,
                    items.Select(ToFieldOptionItem).ToList()
                );
            } catch (BridgeOperationException) {
                throw;
            } catch (Exception ex) {
                Log.Error(ex, "GetValueDomainOptions failed for source key '{SourceKey}'", request.SourceKey);
                throw BridgeOperationExceptions.Unexpected(
                    "FieldOptionsException",
                    ex,
                    "Check value-domain configuration and active document state."
                );
            }
        }, cancellationToken);

    private Task<FieldOptionsData> GetFieldOptionsCore(FieldOptionsRequest request, RevitDocument document, CancellationToken cancellationToken) =>
        this.EnqueueAsync(() => {
            try {
                var type = this._moduleRegistry.ResolveSchemaUrl(request.SchemaUrl).SettingsType;
                var property = SettingsPropertyPathResolver.ResolveProperty(type, request.PropertyPath);

                if (property == null)
                    return EmptyFieldOptionsData(request.SourceKey);

                var fieldOptions = SettingsValueDomainService.Shared.GetOptionsAsync(
                        type,
                        request.PropertyPath,
                        request.SourceKey,
                        CreateValueDomainContext(document, request.ContextValues)
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
                    "Check value-domain configuration and request path."
                );
            }
        }, cancellationToken);

    private async Task<T> EnqueueAsync<T>(Func<T> action, CancellationToken cancellationToken) {
        var queueStopwatch = Stopwatch.StartNew();
        Log.Information("Host request queue starting: ResultType={ResultType}", typeof(T).Name);
        var result = await this._revitTaskQueue.Run(context => {
            context.Cancellation.ThrowIfCancellationRequested();
            Log.Information(
                "Host request queue running on Revit thread after {ElapsedMs} ms: ResultType={ResultType}",
                queueStopwatch.ElapsedMilliseconds,
                typeof(T).Name
            );
            var value = action();
            return value;
        }, new RevitRunOptions { Label = typeof(T).Name, Timeout = TimeSpan.FromMinutes(2) }, cancellationToken);

        Log.Information(
            "Host request queue completed in {ElapsedMs} ms: ResultType={ResultType}",
            queueStopwatch.ElapsedMilliseconds,
            typeof(T).Name
        );
        return result;
    }

    private static FieldOptionsData CreateFieldOptionsData(
        string sourceKey,
        ValueDomainResult fieldOptions
    ) {
        if (fieldOptions.Kind == ValueDomainResultKind.Empty)
            return EmptyFieldOptionsData(sourceKey, fieldOptions.Descriptor);

        if (fieldOptions.Kind == ValueDomainResultKind.Unsupported) {
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

        if (fieldOptions.Kind == ValueDomainResultKind.Failure) {
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
            ToHostFieldOptionsMode(fieldOptions.Descriptor?.Mode ?? SettingsOptionsMode.Suggestion),
            fieldOptions.Descriptor?.AllowsCustomValue ?? true,
            fieldOptions.Items.Select(ToFieldOptionItem).ToList()
        );
    }

    private static FieldOptionsData EmptyFieldOptionsData(
        string sourceKey,
        SettingsValueDomainDescriptor? descriptor = null
    ) =>
        new(
            sourceKey,
            ToHostFieldOptionsMode(descriptor?.Mode ?? SettingsOptionsMode.Suggestion),
            descriptor?.AllowsCustomValue ?? true,
            []
        );

    private static ValueDomainExecutionContext CreateValueDomainContext(
        RevitDocument document,
        IReadOnlyDictionary<string, string>? contextValues = null
    ) => new(
        SettingsRuntimeMode.LiveDocument,
        contextValues,
        document.Value
    );

    private static ParameterCatalogEntry ToHostParameterCatalogEntry(ParameterCatalogOption entry) =>
        new(
            new ParameterDefinitionDescriptor(
                ParameterIdentityEngine.FromCanonical(entry.Definition.Identity),
                entry.Definition.IsInstance,
                entry.Definition.DataTypeId,
                entry.Definition.DataTypeLabel,
                entry.Definition.GroupTypeId,
                entry.Definition.GroupTypeLabel
            ),
            entry.StorageType,
            entry.IsParamService,
            entry.FamilyNames,
            entry.TypeNames
        );

    private static FieldOptionsMode ToHostFieldOptionsMode(SettingsOptionsMode mode) =>
        mode switch {
            SettingsOptionsMode.Constraint => FieldOptionsMode.Constraint,
            _ => FieldOptionsMode.Suggestion
        };

    private static FieldOptionItem ToFieldOptionItem(
        ValueDomainOptionItem item
    ) => new(
        item.Value,
        item.Label,
        item.Description,
        item.Metadata
    );

    private static string BuildThrottleKey(
        string endpoint,
        string? library,
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
        return $"{endpoint}:{library ?? string.Empty}:{propertyPath ?? string.Empty}:{siblingSignature}";
    }

    private static void LogThrottleDecision(
        string endpoint,
        ThrottleDecision decision,
        string library,
        string? propertyPath
    ) {
        if (decision == ThrottleDecision.CacheHit) {
            Log.Debug(
                "Throttle cache hit: Endpoint={Endpoint}, Library={Library}, PropertyPath={PropertyPath}",
                endpoint,
                library,
                propertyPath
            );
            return;
        }

        if (decision == ThrottleDecision.Coalesced) {
            Log.Debug(
                "Throttle coalesced request: Endpoint={Endpoint}, Library={Library}, PropertyPath={PropertyPath}",
                endpoint,
                library,
                propertyPath
            );
        }
    }
}
