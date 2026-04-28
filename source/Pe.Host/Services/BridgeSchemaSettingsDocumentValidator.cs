using Newtonsoft.Json;
using Newtonsoft.Json.Linq;
using NJsonSchema;
using NJsonSchema.Validation;
using Pe.Shared.HostContracts.Operations;
using Pe.Shared.StorageRuntime.Documents;
using HostSchemaData = Pe.Shared.HostContracts.SettingsStorage.SchemaData;
using HostSchemaRequest = Pe.Shared.HostContracts.SettingsStorage.SchemaRequest;

namespace Pe.Host.Services;

internal sealed class BridgeSchemaSettingsDocumentValidator(
    BridgeServer bridgeServer,
    string moduleKey,
    string rootKey
) : ISettingsDocumentValidator {
    private readonly Lazy<JsonSchema> _schema = new(() => LoadSchema(bridgeServer, moduleKey, rootKey));

    public Pe.Shared.StorageRuntime.Documents.SettingsValidationResult Validate(
        Pe.Shared.StorageRuntime.Documents.SettingsDocumentId documentId,
        string rawContent,
        string? composedContent
    ) {
        var candidateContent = string.IsNullOrWhiteSpace(composedContent)
            ? rawContent
            : composedContent;

        try {
            var token = JToken.Parse(candidateContent);
            var issues = BridgeSchemaValidationIssueMapper.ToIssues(this._schema.Value.Validate(token));
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
                $"Review the schema-backed validation flow for '{documentId.ModuleKey}/{documentId.RootKey}'."
            );
        }
    }

    private static JsonSchema LoadSchema(BridgeServer bridgeServer, string moduleKey, string rootKey) {
        var schemaData = bridgeServer
            .InvokeAsync<HostSchemaRequest, HostSchemaData>(
                GetSchemaOperationContract.Definition.Key,
                new HostSchemaRequest(moduleKey, rootKey)
            )
            .GetAwaiter()
            .GetResult();

        if (string.IsNullOrWhiteSpace(schemaData.SchemaJson)) {
            throw new InvalidOperationException(
                $"Bridge schema response for '{moduleKey}/{rootKey}' did not include a schema payload."
            );
        }

        return JsonSchema
            .FromJsonAsync(schemaData.SchemaJson)
            .GetAwaiter()
            .GetResult();
    }
}

internal static class BridgeSchemaValidationIssueMapper {
    public static List<Pe.Shared.StorageRuntime.Documents.SettingsValidationIssue> ToIssues(
        IEnumerable<ValidationError> errors
    ) =>
        errors
            .SelectMany(ToIssues)
            .GroupBy(issue => (issue.Path, issue.Code, issue.Message))
            .Select(group => group.First())
            .ToList();

    private static IEnumerable<Pe.Shared.StorageRuntime.Documents.SettingsValidationIssue> ToIssues(
        ValidationError error
    ) {
        if (TrySelectBestBranchIssues(error, out var branchIssues)) {
            foreach (var issue in branchIssues)
                yield return issue;

            yield break;
        }

        yield return CreateIssue(error);
    }

    private static bool TrySelectBestBranchIssues(
        ValidationError error,
        out IReadOnlyList<Pe.Shared.StorageRuntime.Documents.SettingsValidationIssue> issues
    ) {
        var branchErrors = error switch {
            MultiTypeValidationError multiTypeValidationError when multiTypeValidationError.Errors.Any() =>
                multiTypeValidationError.Errors.Select(pair => pair.Value.ToList()).ToList(),
            ChildSchemaValidationError childSchemaValidationError when childSchemaValidationError.Errors.Any() =>
                childSchemaValidationError.Errors.Select(pair => pair.Value.ToList()).ToList(),
            _ => null
        };

        if (branchErrors == null || branchErrors.Count == 0) {
            issues = [];
            return false;
        }

        var branchCandidates = branchErrors
            .Select(branch => branch.SelectMany(ToIssues).ToList())
            .Where(branch => branch.Count != 0)
            .OrderBy(ComputeBranchScore)
            .ThenBy(branch => branch.Count)
            .ToList();

        if (branchCandidates.Count == 0) {
            issues = [];
            return false;
        }

        issues = branchCandidates[0];
        return true;
    }

    private static int ComputeBranchScore(
        IReadOnlyCollection<Pe.Shared.StorageRuntime.Documents.SettingsValidationIssue> issues
    ) =>
        issues.Sum(ComputeIssueWeight);

    private static int ComputeIssueWeight(Pe.Shared.StorageRuntime.Documents.SettingsValidationIssue issue) =>
        issue.Code switch {
            "NotInEnumeration" => 1,
            "StringExpected" => 1,
            "IntegerExpected" => 1,
            "NumberExpected" => 1,
            "BooleanExpected" => 1,
            "ArrayExpected" => 1,
            "ObjectExpected" => 1,
            "NoAdditionalPropertiesAllowed" => 4,
            "PropertyRequired" when issue.Path.EndsWith(".$preset", StringComparison.Ordinal) => 6,
            "PropertyRequired" => 3,
            _ => 2
        };

    private static Pe.Shared.StorageRuntime.Documents.SettingsValidationIssue CreateIssue(ValidationError error) => new(
        NormalizePath(error.Path),
        MapValidationCode(error.Kind),
        "error",
        BuildMessage(error),
        BuildSuggestion(error.Kind)
    );

    private static string NormalizePath(string? path) {
        if (string.IsNullOrWhiteSpace(path) || string.Equals(path, "#", StringComparison.Ordinal))
            return "$";

        var trimmed = path.Trim();
        if (trimmed.StartsWith("#/")) {
            var segments = trimmed[2..]
                .Split(['/'], StringSplitOptions.RemoveEmptyEntries)
                .Select(segment => segment.Replace("~1", "/").Replace("~0", "~"))
                .ToList();

            if (segments.Count == 0)
                return "$";

            var normalized = "$";
            foreach (var segment in segments)
                normalized += int.TryParse(segment, out _) ? $"[{segment}]" : $".{segment}";

            return normalized;
        }

        if (trimmed.StartsWith("$", StringComparison.Ordinal))
            return trimmed;

        if (trimmed.StartsWith("/", StringComparison.Ordinal)) {
            var slashSegments = trimmed
                .TrimStart('/')
                .Split(['/'], StringSplitOptions.RemoveEmptyEntries)
                .Select(segment => segment.Replace("~1", "/").Replace("~0", "~"));

            var slashNormalized = "$";
            foreach (var segment in slashSegments)
                slashNormalized += int.TryParse(segment, out _) ? $"[{segment}]" : $".{segment}";

            return slashNormalized;
        }

        return $"$.{trimmed.TrimStart('.')}";
    }

    private static string MapValidationCode(ValidationErrorKind kind) =>
        kind switch {
            ValidationErrorKind.PropertyRequired => "PropertyRequired",
            ValidationErrorKind.NoAdditionalPropertiesAllowed => "NoAdditionalPropertiesAllowed",
            ValidationErrorKind.NotInEnumeration => "NotInEnumeration",
            ValidationErrorKind.StringExpected => "StringExpected",
            ValidationErrorKind.IntegerExpected => "IntegerExpected",
            ValidationErrorKind.NumberExpected => "NumberExpected",
            ValidationErrorKind.BooleanExpected => "BooleanExpected",
            ValidationErrorKind.ArrayExpected => "ArrayExpected",
            ValidationErrorKind.ObjectExpected => "ObjectExpected",
            ValidationErrorKind.NullExpected => "NullExpected",
            ValidationErrorKind.PatternMismatch => "PatternMismatch",
            ValidationErrorKind.TooFewItems => "TooFewItems",
            ValidationErrorKind.TooManyItems => "TooManyItems",
            ValidationErrorKind.NotAnyOf => "NotAnyOf",
            ValidationErrorKind.NotOneOf => "NotOneOf",
            ValidationErrorKind.NoTypeValidates => "NoTypeValidates",
            _ => kind.ToString()
        };

    private static string BuildMessage(ValidationError error) =>
        error.Kind switch {
            ValidationErrorKind.PropertyRequired => $"Missing required property '{error.Property}'.",
            ValidationErrorKind.NoAdditionalPropertiesAllowed =>
                $"Unknown property '{error.Property}' is not allowed.",
            ValidationErrorKind.NotInEnumeration =>
                $"Value must be one of: {string.Join(", ", error.Schema?.Enumeration ?? [])}.",
            ValidationErrorKind.StringExpected => "Value must be a string.",
            ValidationErrorKind.IntegerExpected => "Value must be an integer.",
            ValidationErrorKind.NumberExpected => "Value must be a number.",
            ValidationErrorKind.BooleanExpected => "Value must be true or false.",
            ValidationErrorKind.ArrayExpected => "Value must be an array.",
            ValidationErrorKind.ObjectExpected => "Value must be an object.",
            _ => error.ToString()
        };

    private static string BuildSuggestion(ValidationErrorKind kind) =>
        kind switch {
            ValidationErrorKind.PropertyRequired => "Add the required field value.",
            ValidationErrorKind.NoAdditionalPropertiesAllowed => "Remove the unknown property from the payload.",
            ValidationErrorKind.NotInEnumeration => "Choose one of the allowed values from the options list.",
            ValidationErrorKind.StringExpected => "Provide a text value for this field.",
            ValidationErrorKind.IntegerExpected => "Provide a whole number value.",
            ValidationErrorKind.NumberExpected => "Provide a numeric value.",
            ValidationErrorKind.BooleanExpected => "Use true or false for this field.",
            ValidationErrorKind.ArrayExpected => "Provide an array value for this field.",
            ValidationErrorKind.ObjectExpected => "Provide an object value for this field.",
            _ => "Fix the value at the reported path and retry validation."
        };
}
