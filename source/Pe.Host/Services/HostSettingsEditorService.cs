using Pe.Host.Contracts;
using Pe.StorageRuntime.Capabilities;
using Pe.StorageRuntime.Documents;
using Pe.StorageRuntime.Json;
using Pe.StorageRuntime.Json.FieldOptions;
using Pe.StorageRuntime.Json.SchemaDefinitions;
using Pe.StorageRuntime.Revit.Validation;
using System.Collections.Concurrent;
using FieldOptionItem = Pe.Host.Contracts.FieldOptionItem;
using RuntimeSettingsDocumentId = Pe.StorageRuntime.Documents.SettingsDocumentId;
using RuntimeSettingsValidationIssue = Pe.StorageRuntime.Documents.SettingsValidationIssue;

namespace Pe.Host.Services;

public sealed class HostSettingsEditorService(IHostSettingsModuleCatalog moduleCatalog) {
    private readonly IHostSettingsModuleCatalog _moduleCatalog = moduleCatalog;
    private readonly ConcurrentDictionary<string, SchemaData> _schemaCache = new(StringComparer.OrdinalIgnoreCase);

    private readonly ConcurrentDictionary<string, ISettingsDocumentValidator> _validationValidatorCache =
        new(StringComparer.OrdinalIgnoreCase);

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

            var schemaData = this._schemaCache.GetOrAdd(module.ModuleKey, _ => CreateSchemaData(module.SettingsType));
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

    public ValidationEnvelopeResponse ValidateSettingsEnvelope(ValidateSettingsRequest request) {
        try {
            if (!this._moduleCatalog.TryGetModule(request.ModuleKey, out var module)) {
                var missingModuleIssues = new List<ValidationIssue> {
                    new(
                        "$",
                        null,
                        "UnknownModule",
                        "error",
                        $"Module '{request.ModuleKey}' is not registered.",
                        "Choose a registered settings module and retry."
                    )
                };
                return new ValidationEnvelopeResponse(
                    false,
                    EnvelopeCode.Failed,
                    $"Module '{request.ModuleKey}' is not registered.",
                    missingModuleIssues,
                    new ValidationData(false, missingModuleIssues)
                );
            }

            var validator = this._validationValidatorCache.GetOrAdd(
                module.ModuleKey,
                _ => new SchemaBackedSettingsDocumentValidator(
                    module.SettingsType,
                    SettingsRuntimeCapabilityProfiles.RevitAssemblyOnly
                )
            );
            var validation = validator.Validate(
                new RuntimeSettingsDocumentId(module.ModuleKey, module.DefaultRootKey, "__host_validation__"),
                request.SettingsJson,
                null
            );
            var issues = validation.Issues.Select(ToHostValidationIssue).ToList();

            return new ValidationEnvelopeResponse(
                true,
                EnvelopeCode.Ok,
                issues.Count == 0 ? "Validation passed." : "Validation returned issues.",
                issues,
                new ValidationData(validation.IsValid, issues)
            );
        } catch (Exception ex) {
            var issues = new List<ValidationIssue> {
                new(
                    "$",
                    null,
                    "ValidationException",
                    "error",
                    ex.Message,
                    "Verify Revit assembly resolution and settings JSON."
                )
            };
            return new ValidationEnvelopeResponse(
                false,
                EnvelopeCode.Failed,
                GetPrimaryExceptionMessage(ex),
                issues,
                new ValidationData(false, issues)
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

            var fieldOptions = SettingsFieldOptionsService.Shared.GetOptionsAsync(
                    module.SettingsType,
                    request.PropertyPath,
                    request.SourceKey,
                    new FieldOptionsExecutionContext(
                        SettingsRuntimeCapabilityProfiles.RevitAssemblyOnly,
                        null,
                        request.ContextValues
                    )
                )
                .AsTask()
                .GetAwaiter()
                .GetResult();

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

    private static SchemaData CreateSchemaData(Type settingsType) {
        var schemaData = JsonSchemaFactory.CreateEditorSchemaData(
            settingsType,
            new JsonSchemaBuildOptions(SettingsRuntimeCapabilityProfiles.RevitAssemblyOnly)
        );

        return new SchemaData(schemaData.SchemaJson, schemaData.FragmentSchemaJson);
    }

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

    private static ValidationIssue ToHostValidationIssue(RuntimeSettingsValidationIssue issue) =>
        new(
            issue.Path,
            null,
            issue.Code,
            issue.Severity,
            issue.Message,
            issue.Suggestion
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