using NJsonSchema.Validation;
using Pe.Host.Contracts;

namespace Pe.Global.Services.Host;

public static class ValidationIssueMapper {
    public static IReadOnlyList<ValidationIssue> ToValidationIssues(IEnumerable<ValidationError> errors) =>
        errors.SelectMany(ToValidationIssues).ToList();

    public static IEnumerable<ValidationIssue> ToValidationIssues(ValidationError error) {
        if (error is MultiTypeValidationError multiTypeValidationError) {
            foreach (var childError in multiTypeValidationError.Errors.SelectMany(pair => pair.Value))
                foreach (var issue in ToValidationIssues(childError))
                    yield return issue;
            yield break;
        }

        if (error is ChildSchemaValidationError childSchemaValidationError && childSchemaValidationError.Errors.Any()) {
            foreach (var childError in childSchemaValidationError.Errors.SelectMany(pair => pair.Value))
                foreach (var issue in ToValidationIssues(childError))
                    yield return issue;
            yield break;
        }

        var instancePath = NormalizeInstancePath(error.Path);
        var schemaPath = NormalizeSchemaPath(error.Schema?.DocumentPath);
        var code = MapValidationCode(error.Kind);
        var message = BuildMessage(error);
        var suggestion = BuildSuggestion(error.Kind);
        yield return new ValidationIssue(instancePath, schemaPath, code, "error", message, suggestion);
    }

    public static string NormalizeInstancePath(string? path) {
        if (string.IsNullOrWhiteSpace(path))
            return "$";

        var trimmed = path.Trim();
        if (trimmed == "#")
            return "$";

        if (trimmed.StartsWith("#/")) {
            var segments = trimmed[2..]
                .Split(new[] { '/' }, StringSplitOptions.RemoveEmptyEntries)
                .Select(segment => segment.Replace("~1", "/").Replace("~0", "~"))
                .ToList();

            if (segments.Count == 0)
                return "$";

            var normalized = "$";
            foreach (var segment in segments) {
                if (int.TryParse(segment, out _))
                    normalized += $"[{segment}]";
                else
                    normalized += $".{segment}";
            }

            return normalized;
        }

        if (trimmed.StartsWith("$"))
            return trimmed;

        if (trimmed.StartsWith("/")) {
            var slashSegments = trimmed
                .TrimStart('/')
                .Split(new[] { '/' }, StringSplitOptions.RemoveEmptyEntries)
                .Select(segment => segment.Replace("~1", "/").Replace("~0", "~"));

            var slashNormalized = "$";
            foreach (var segment in slashSegments) {
                if (int.TryParse(segment, out _))
                    slashNormalized += $"[{segment}]";
                else
                    slashNormalized += $".{segment}";
            }

            return slashNormalized;
        }

        return $"$.{trimmed.TrimStart('.')}";
    }

    public static string? NormalizeSchemaPath(string? schemaPath) {
        if (string.IsNullOrWhiteSpace(schemaPath))
            return null;

        return schemaPath.Trim();
    }

    public static string MapValidationCode(ValidationErrorKind kind) =>
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
