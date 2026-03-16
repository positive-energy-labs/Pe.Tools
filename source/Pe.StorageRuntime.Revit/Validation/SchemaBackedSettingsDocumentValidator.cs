using Newtonsoft.Json;
using Newtonsoft.Json.Linq;
using Pe.StorageRuntime.Capabilities;
using Pe.StorageRuntime.Documents;
using Pe.StorageRuntime.Json;
using Pe.StorageRuntime.Revit.Core.Json.SchemaProviders;


namespace Pe.StorageRuntime.Revit.Validation;

public sealed class SchemaBackedSettingsDocumentValidator(
    Type settingsType,
    SettingsCapabilityTier availableCapabilityTier = SettingsCapabilityTier.RevitAssembly) : ISettingsDocumentValidator {
    private readonly Lazy<NJsonSchema.JsonSchema> _schema = new(() => CreateSchema(
        settingsType,
        availableCapabilityTier
    ));

    public SettingsValidationResult Validate(
        SettingsDocumentId documentId,
        string rawContent,
        string? composedContent
    ) {
        var candidateContent = string.IsNullOrWhiteSpace(composedContent)
            ? rawContent
            : composedContent;

        try {
            var token = JToken.Parse(candidateContent);
            var issues = SettingsValidationIssueMapper.ToIssues(this._schema.Value.Validate(token));
            return new SettingsValidationResult(
                !issues.Any(issue => string.Equals(issue.Severity, "error", StringComparison.OrdinalIgnoreCase)),
                issues
            );
        } catch (JsonReaderException ex) {
            return SettingsValidationResults.Error(
                "$",
                "JsonParseError",
                ex.Message,
                "Fix the JSON syntax and retry."
            );
        } catch (Exception ex) {
            return SettingsValidationResults.Error(
                "$",
                "SchemaValidationFailure",
                ex.Message,
                $"Review the schema-backed validation configuration for '{documentId.ModuleKey}'."
            );
        }
    }

    private static NJsonSchema.JsonSchema CreateSchema(
        Type settingsType,
        SettingsCapabilityTier availableCapabilityTier
    ) => JsonSchemaFactory.BuildAuthoringSchema(
        settingsType,
        new JsonSchemaBuildOptions(new SettingsProviderContext(availableCapabilityTier)) {
            ResolveExamples = false
        }
    );
}
