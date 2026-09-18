using Newtonsoft.Json;
using Newtonsoft.Json.Converters;
using Pe.Revit.SettingsRuntime.Json;
using Pe.Revit.SettingsRuntime.Json.ContractResolvers;
using Pe.Revit.SettingsRuntime.Validation;

namespace Pe.Revit.SettingsRuntime.Modules;

public static class ModuleSettingsStorage<TSettings> where TSettings : class {
    private static readonly JsonSerializerSettings DeserializerSettings = new() {
        Formatting = Formatting.Indented,
        Converters = [new StringEnumConverter()],
        ContractResolver = new RegisteredTypeContractResolver(JsonTypeSchemaBindingRegistry.Shared),
        NullValueHandling = NullValueHandling.Ignore
    };


    public static TSettings ReadPrepared(string rawContent, string composedContent, string location) {
        var schema = new SchemaBackedSettingsDocumentValidator(typeof(TSettings));
        var schemaResult = schema.Validate(new Pe.Shared.StorageRuntime.Documents.SettingsDocumentId("Pod", "settings", location), rawContent, composedContent);
        var issues = schemaResult.Issues.ToList();
        if (SettingsDocumentValidatorRegistry.Shared.TryValidate(
                typeof(TSettings),
                new SettingsDocumentValidationContext(rawContent, composedContent),
                out var featureIssues))
            issues.AddRange(featureIssues.Select(issue => new Pe.Shared.StorageRuntime.Documents.SettingsValidationIssue(
                issue.Path, issue.Code, issue.Severity, issue.Message, issue.Suggestion)));
        if (issues.Any(issue => string.Equals(issue.Severity, "error", StringComparison.OrdinalIgnoreCase)))
            throw new JsonValidationException(location, issues.Select(issue => $"{issue.Path}: {issue.Message}"));
        return JsonConvert.DeserializeObject<TSettings>(composedContent, DeserializerSettings) ?? CreateDefaultValue();
    }

    private static TSettings CreateDefaultValue() {
        var serializerSettings = RevitJsonFormatting.CreateRevitIndentedSettings();
        var defaultValue = JsonConvert.DeserializeObject<TSettings>("{}", serializerSettings);
        if (defaultValue != null)
            return defaultValue;

        if (Activator.CreateInstance(typeof(TSettings)) is TSettings createdValue)
            return createdValue;

        throw new InvalidOperationException(
            $"Could not materialize a default settings value for '{typeof(TSettings).FullName}'."
        );
    }
}
