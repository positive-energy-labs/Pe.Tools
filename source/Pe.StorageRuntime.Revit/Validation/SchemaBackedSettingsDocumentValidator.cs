using Newtonsoft.Json;
using Newtonsoft.Json.Linq;
using NJsonSchema;
using Pe.StorageRuntime.Capabilities;
using Pe.StorageRuntime.Documents;
using Pe.StorageRuntime.Json;
using Pe.StorageRuntime.Revit.Core.Json;

namespace Pe.StorageRuntime.Revit.Validation;

public sealed class SchemaBackedSettingsDocumentValidator(
    Type settingsType,
    SettingsRuntimeCapabilities? availableCapabilities = null) : ISettingsDocumentValidator {
    private readonly Lazy<JsonSchema> _schema = new(() => CreateSchema(
        settingsType,
        availableCapabilities ?? SettingsRuntimeCapabilityProfiles.RevitAssemblyOnly
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
            var validationContent = MaterializeDefaults(candidateContent, settingsType);
            var token = JToken.Parse(validationContent);
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

    private static JsonSchema CreateSchema(
        Type settingsType,
        SettingsRuntimeCapabilities availableCapabilities
    ) => JsonSchemaFactory.BuildAuthoringSchema(
        settingsType,
        new JsonSchemaBuildOptions(availableCapabilities) { ResolveFieldOptionSamples = false }
    );

    private static string MaterializeDefaults(string candidateContent, Type settingsType) {
        try {
            var defaultInstance = DefaultInstanceFactory.TryCreateDefaultInstance(settingsType);
            if (defaultInstance == null)
                return candidateContent;

            var serializerSettings = RevitJsonFormatting.CreateRevitIndentedSettings();
            var defaultToken = JToken.Parse(
                RevitJsonFormatting.SerializeIndented(defaultInstance, serializerSettings)
            );
            var candidateToken = JToken.Parse(candidateContent);

            ApplyMissingDefaults(candidateToken, defaultToken);
            return candidateToken.ToString(Formatting.Indented);
        } catch {
            return candidateContent;
        }
    }

    private static void ApplyMissingDefaults(JToken candidateToken, JToken defaultToken) {
        if (candidateToken is not JObject candidateObject || defaultToken is not JObject defaultObject)
            return;

        foreach (var defaultProperty in defaultObject.Properties()) {
            if (!candidateObject.TryGetValue(defaultProperty.Name, StringComparison.Ordinal, out var candidateValue)) {
                candidateObject[defaultProperty.Name] = defaultProperty.Value.DeepClone();
                continue;
            }

            ApplyMissingDefaults(candidateValue, defaultProperty.Value);
        }
    }
}