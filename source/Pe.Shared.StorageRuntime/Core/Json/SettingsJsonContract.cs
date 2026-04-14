using Newtonsoft.Json;
using Pe.Shared.StorageRuntime.Capabilities;
using Pe.Shared.StorageRuntime.Documents;
using Pe.Shared.StorageRuntime.Validation;

namespace Pe.Shared.StorageRuntime.Core.Json;

public sealed record SettingsJsonRoundTripResult<TSettings>(
    TSettings Value,
    string CanonicalJson
) where TSettings : class, new();

public static class SettingsJsonContract {
    public static SettingsJsonRoundTripResult<TSettings> ValidateAndRoundTrip<TSettings>(
        string json,
        string documentPath,
        SettingsRuntimeMode runtimeMode = SettingsRuntimeMode.HostOnly
    ) where TSettings : class, new() {
        if (string.IsNullOrWhiteSpace(json))
            throw new ArgumentException("JSON content is required.", nameof(json));
        if (string.IsNullOrWhiteSpace(documentPath))
            throw new ArgumentException("Document path is required.", nameof(documentPath));

        var validator = new SchemaBackedSettingsDocumentValidator(typeof(TSettings), runtimeMode);
        EnsureValid(documentPath, validator.Validate(CreateDocumentId<TSettings>(documentPath), json, null));

        var serializerSettings = RevitJsonFormatting.CreateRevitIndentedSettings();
        var value = JsonConvert.DeserializeObject<TSettings>(json, serializerSettings)
                    ?? new TSettings();
        var canonicalJson = RevitJsonFormatting.SerializeIndented(value, serializerSettings);

        EnsureValid(documentPath, validator.Validate(CreateDocumentId<TSettings>(documentPath), canonicalJson, null));
        return new SettingsJsonRoundTripResult<TSettings>(value, canonicalJson);
    }

    private static SettingsDocumentId CreateDocumentId<TSettings>(string documentPath) =>
        new(
            typeof(TSettings).Name,
            "tests",
            Path.GetFileName(documentPath)
        );

    private static void EnsureValid(string documentPath, SettingsValidationResult validation) {
        if (validation.IsValid)
            return;

        throw new JsonValidationException(
            documentPath,
            validation.Issues.Select(issue => $"{issue.Path}: {issue.Message}"));
    }
}
