using Pe.Host.Contracts;
using Pe.StorageRuntime.Capabilities;
using Pe.StorageRuntime.Json;
using Pe.StorageRuntime.Json.FieldOptions;
using Pe.StorageRuntime.Json.SchemaDefinitions;
using System.Collections.Concurrent;
using FieldOptionItem = Pe.Host.Contracts.FieldOptionItem;

namespace Pe.Host.Services;

public sealed class HostSchemaService(IHostSettingsModuleCatalog moduleCatalog) {
    private readonly IHostSettingsModuleCatalog _moduleCatalog = moduleCatalog;
    private readonly ConcurrentDictionary<string, SchemaData> _schemaCache = new(StringComparer.OrdinalIgnoreCase);

    public SchemaEnvelopeResponse GetSchemaEnvelope(SchemaRequest request) {
        try {
            if (!this._moduleCatalog.TryGetModule(request.ModuleKey, out var module)) {
                return new SchemaEnvelopeResponse(
                    false,
                    EnvelopeCode.Failed,
                    $"Schema module '{request.ModuleKey}' is not registered.",
                    [],
                    null
                );
            }

            var schemaData = this.GetOrCreateSchemaData(
                GetSettingsModuleCacheKey(module.ModuleKey),
                module.SettingsType,
                true
            );
            return new SchemaEnvelopeResponse(true, EnvelopeCode.Ok, "Schema generated.", [], schemaData);
        } catch (Exception ex) {
            return new SchemaEnvelopeResponse(
                false,
                EnvelopeCode.Failed,
                GetPrimaryExceptionMessage(ex),
                [
                    new ValidationIssue(
                        "$",
                        null,
                        "SchemaException",
                        "error",
                        GetDetailedExceptionMessage(ex),
                        "Verify Revit assembly resolution and schema definition or type-binding registration."
                    )
                ],
                null
            );
        }
    }

    public SchemaEnvelopeResponse GetLoadedFamiliesFilterSchemaEnvelope() {
        try {
            var schemaData = this.GetOrCreateSchemaData(
                GetLoadedFamiliesFilterCacheKey(),
                typeof(LoadedFamiliesFilter),
                false
            );
            return new SchemaEnvelopeResponse(true, EnvelopeCode.Ok, "Loaded families filter schema generated.", [], schemaData);
        } catch (Exception ex) {
            return new SchemaEnvelopeResponse(
                false,
                EnvelopeCode.Failed,
                ex.Message,
                [
                    new ValidationIssue(
                        "$",
                        null,
                        "LoadedFamiliesFilterSchemaException",
                        "error",
                        ex.Message,
                        "Verify loaded families filter schema registration and configuration."
                    )
                ],
                null
            );
        }
    }

    public bool TryGetFieldOptionsEnvelopeLocally(
        FieldOptionsRequest request,
        out FieldOptionsEnvelopeResponse response
    ) {
        response = default!;

        try {
            if (!this._moduleCatalog.TryGetModule(request.ModuleKey, out var module)) {
                response = CreateFieldOptionsFailure(
                    request.SourceKey,
                    $"Module '{request.ModuleKey}' is not registered.",
                    "Choose a registered settings module and retry."
                );
                return true;
            }

            var property = SettingsPropertyPathResolver.ResolveProperty(module.SettingsType, request.PropertyPath);
            if (property == null) {
                response = CreateFieldOptionsSuccess(
                    request.SourceKey,
                    "Property not found for field options provider.",
                    []
                );
                return true;
            }

            var fieldOptions = GetFieldOptions(module.SettingsType, request.PropertyPath, request.SourceKey,
                request.ContextValues);
            if (fieldOptions.Kind == FieldOptionsResultKind.Unsupported)
                return false;

            if (fieldOptions.Kind == FieldOptionsResultKind.Failure) {
                response = CreateFieldOptionsFailure(
                    request.SourceKey,
                    fieldOptions.Message,
                    "Check field option source configuration and request path."
                );
                return true;
            }

            response = CreateFieldOptionsSuccess(
                request.SourceKey,
                fieldOptions.Message,
                fieldOptions.Items
                    .Select(item => new FieldOptionItem(item.Value, item.Label, item.Description))
                    .ToList()
            );
            return true;
        } catch (Exception ex) {
            response = CreateFieldOptionsFailure(
                request.SourceKey,
                ex.Message,
                "Verify Revit assembly resolution and field-options provider configuration."
            );
            return true;
        }
    }

    public FieldOptionsEnvelopeResponse GetLoadedFamiliesFilterFieldOptionsEnvelope(
        LoadedFamiliesFilterFieldOptionsRequest request
    ) {
        try {
            var fieldOptions =
                GetFieldOptions(typeof(LoadedFamiliesFilter), request.PropertyPath, request.SourceKey, request.ContextValues);
            if (fieldOptions.Kind is FieldOptionsResultKind.Success or FieldOptionsResultKind.Empty) {
                return CreateFieldOptionsSuccess(
                    request.SourceKey,
                    fieldOptions.Message,
                    fieldOptions.Items
                        .Select(item => new FieldOptionItem(item.Value, item.Label, item.Description))
                        .ToList()
                );
            }

            return CreateFieldOptionsFailure(
                request.SourceKey,
                fieldOptions.Message,
                "Verify loaded families filter field-options configuration."
            );
        } catch (Exception ex) {
            return CreateFieldOptionsFailure(
                request.SourceKey,
                ex.Message,
                "Verify loaded families filter field-options configuration."
            );
        }
    }

    private SchemaData GetOrCreateSchemaData(
        string cacheKey,
        Type schemaType,
        bool resolveFieldOptionSamples
    ) => this._schemaCache.GetOrAdd(
        cacheKey,
        _ => CreateSchemaData(schemaType, resolveFieldOptionSamples)
    );

    private static SchemaData CreateSchemaData(Type settingsType, bool resolveFieldOptionSamples) {
        var schemaData = JsonSchemaFactory.CreateEditorSchemaData(
            settingsType,
            new JsonSchemaBuildOptions(SettingsRuntimeCapabilityProfiles.RevitAssemblyOnly) {
                ResolveFieldOptionSamples = resolveFieldOptionSamples
            }
        );

        return new SchemaData(schemaData.SchemaJson, schemaData.FragmentSchemaJson);
    }

    private static FieldOptionsResult GetFieldOptions(
        Type schemaType,
        string propertyPath,
        string sourceKey,
        Dictionary<string, string>? contextValues
    ) => SettingsFieldOptionsService.Shared.GetOptionsAsync(
            schemaType,
            propertyPath,
            sourceKey,
            new FieldOptionsExecutionContext(
                SettingsRuntimeCapabilityProfiles.RevitAssemblyOnly,
                null,
                contextValues
            )
        )
        .AsTask()
        .GetAwaiter()
        .GetResult();

    private static string GetSettingsModuleCacheKey(string moduleKey) => $"module:{moduleKey}";

    private static string GetLoadedFamiliesFilterCacheKey() => "revit-data:loaded-families-filter";

    private static FieldOptionsEnvelopeResponse CreateFieldOptionsSuccess(
        string sourceKey,
        string message,
        List<FieldOptionItem> items
    ) => new(
        true,
        EnvelopeCode.Ok,
        message,
        [],
        new FieldOptionsData(sourceKey, FieldOptionsMode.Suggestion, true, items)
    );

    private static FieldOptionsEnvelopeResponse CreateFieldOptionsFailure(
        string sourceKey,
        string message,
        string suggestion
    ) => new(
        false,
        EnvelopeCode.Failed,
        message,
        [new ValidationIssue("$", null, "FieldOptionsException", "error", message, suggestion)],
        new FieldOptionsData(sourceKey, FieldOptionsMode.Suggestion, true, [])
    );

    private static string GetPrimaryExceptionMessage(Exception ex) =>
        ex.GetBaseException().Message;

    private static string GetDetailedExceptionMessage(Exception ex) {
        var messages = new List<string>();
        for (var current = ex; current != null; current = current.InnerException) {
            if (!string.IsNullOrWhiteSpace(current.Message))
                messages.Add(current.Message);
        }

        return string.Join(" --> ", messages.Distinct(StringComparer.Ordinal));
    }
}
