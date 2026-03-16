using NJsonSchema.Validation;
using Pe.StorageRuntime.Documents;

namespace Pe.StorageRuntime.Revit.Validation;

internal static class SettingsValidationIssueMapper {
    public static IReadOnlyList<SettingsValidationIssue> ToIssues(IEnumerable<ValidationError> errors) =>
        errors.SelectMany(ToIssues).ToList();

    private static IEnumerable<SettingsValidationIssue> ToIssues(ValidationError error) {
        if (error is MultiTypeValidationError multiTypeValidationError) {
            foreach (var childError in multiTypeValidationError.Errors.SelectMany(pair => pair.Value))
                foreach (var issue in ToIssues(childError))
                    yield return issue;
            yield break;
        }

        if (error is ChildSchemaValidationError childSchemaValidationError && childSchemaValidationError.Errors.Any()) {
            foreach (var childError in childSchemaValidationError.Errors.SelectMany(pair => pair.Value))
                foreach (var issue in ToIssues(childError))
                    yield return issue;
            yield break;
        }

        yield return new SettingsValidationIssue(
            NormalizePath(error.Path),
            MapValidationCode(error.Kind),
            "error",
            BuildMessage(error),
            BuildSuggestion(error.Kind)
        );
    }

    private static string NormalizePath(string? path) {
        if (string.IsNullOrWhiteSpace(path) || string.Equals(path, "#", StringComparison.Ordinal))
            return "$";

        var trimmed = path.Trim();
        if (trimmed.StartsWith("#/")) {
            var segments = trimmed[2..]
                .Split(new[] { '/' }, StringSplitOptions.RemoveEmptyEntries)
                .Select(segment => segment.Replace("~1", "/").Replace("~0", "~"))
                .ToList();

            if (segments.Count == 0)
                return "$";

            var normalized = "$";
            foreach (var segment in segments) {
                normalized += int.TryParse(segment, out _) ? $"[{segment}]" : $".{segment}";
            }

            return normalized;
        }

        if (trimmed.StartsWith("$", StringComparison.Ordinal))
            return trimmed;

        if (trimmed.StartsWith("/", StringComparison.Ordinal)) {
            var slashSegments = trimmed
                .TrimStart('/')
                .Split(new[] { '/' }, StringSplitOptions.RemoveEmptyEntries)
                .Select(segment => segment.Replace("~1", "/").Replace("~0", "~"));

            var slashNormalized = "$";
            foreach (var segment in slashSegments) {
                slashNormalized += int.TryParse(segment, out _) ? $"[{segment}]" : $".{segment}";
            }

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
