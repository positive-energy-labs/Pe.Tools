using Pe.Host.Contracts.RevitData;
using Pe.Host.Contracts.SettingsStorage;
using Pe.StorageRuntime.Capabilities;
using Pe.StorageRuntime.Json;
using System.Collections.Concurrent;

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
                false
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
            return new SchemaEnvelopeResponse(true, EnvelopeCode.Ok, "Loaded families filter schema generated.", [],
                schemaData);
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
            new JsonSchemaBuildOptions(SettingsRuntimeMode.HostOnly) {
                ResolveFieldOptionSamples = resolveFieldOptionSamples
            }
        );

        return new SchemaData(schemaData.SchemaJson, schemaData.FragmentSchemaJson);
    }

    private static string GetSettingsModuleCacheKey(string moduleKey) => $"module:{moduleKey}";

    private static string GetLoadedFamiliesFilterCacheKey() => "revit-data:loaded-families-filter";

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
