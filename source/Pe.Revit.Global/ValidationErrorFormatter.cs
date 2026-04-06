using NJsonSchema;
using Pe.Revit.Global.PolyFill;
using NJsonSchema.Validation;
using ValidationError = NJsonSchema.Validation.ValidationError;

namespace Pe.Revit.Global;

/// <summary>
///     Formats NJsonSchema validation errors into human-readable messages.
///     Recursively extracts nested errors for complex constraints like oneOf/anyOf.
/// </summary>
public static class ValidationErrorFormatter {
    /// <summary>
    ///     Formats a collection of validation errors into detailed, actionable messages.
    /// </summary>
    public static List<string> Format(IEnumerable<ValidationError> errors) =>
        errors.SelectMany(FormatError).ToList();

    /// <summary>
    ///     Formats a single validation error, recursively handling nested errors.
    /// </summary>
    private static IEnumerable<string> FormatError(ValidationError error, int depth = 0) {
        var indent = new string(' ', depth * 2);

        // Handle MultiTypeValidationError (for schemas with type: ["array", "null"] etc.)
        if (error is MultiTypeValidationError multiError) {
            foreach (var msg in FormatMultiTypeError(multiError, depth))
                yield return msg;
            yield break;
        }

        // Handle ChildSchemaValidationError (for oneOf/anyOf/allOf)
        if (error is ChildSchemaValidationError childError) {
            if (childError.Errors.Any()) {
                foreach (var msg in FormatChildSchemaError(childError, depth))
                    yield return msg;
                yield break;
            }
        }

        // Handle specific error kinds with friendly messages
        switch (error.Kind) {
        case ValidationErrorKind.NoTypeValidates:
            yield return $"{indent}{error.Path}: Validation failed - no type matched";
            break;

        case ValidationErrorKind.PropertyRequired:
            yield return $"{indent}{error.Path}: Missing property '{error.Property}'";
            break;

        case ValidationErrorKind.NoAdditionalPropertiesAllowed:
            yield return $"{indent}{error.Path}: Unknown property '{error.Property}' is not allowed";
            break;

        case ValidationErrorKind.StringExpected:
            yield return $"{indent}{error.Path}: Expected a string value";
            break;

        case ValidationErrorKind.IntegerExpected:
            yield return $"{indent}{error.Path}: Expected an integer value";
            break;

        case ValidationErrorKind.NumberExpected:
            yield return $"{indent}{error.Path}: Expected a number value";
            break;

        case ValidationErrorKind.BooleanExpected:
            yield return $"{indent}{error.Path}: Expected a boolean value";
            break;

        case ValidationErrorKind.ArrayExpected:
            yield return $"{indent}{error.Path}: Expected an array";
            break;

        case ValidationErrorKind.ObjectExpected:
            yield return $"{indent}{error.Path}: Expected an object";
            break;

        case ValidationErrorKind.NotInEnumeration:
            yield return $"{indent}{error.Path}: Value not in allowed set. " +
                         $"Allowed: [{string.Join(", ", error.Schema?.Enumeration ?? [])}]";
            break;

        default:
            yield return $"{indent}{error.Path}: {error.Kind}";
            break;
        }
    }

    /// <summary>
    ///     Formats a MultiTypeValidationError - these occur for schemas like type: ["array", "null"].
    ///     The nested errors tell us why each type alternative failed.
    /// </summary>
    private static IEnumerable<string> FormatMultiTypeError(MultiTypeValidationError error, int depth) {
        var indent = new string(' ', depth * 2);

        // MultiTypeValidationError.Errors contains errors for each type that was tried
        if (!error.Errors.Any()) {
            yield return $"{indent}{error.Path}: Multi-type validation failed (no details available)";
            yield break;
        }

        // Find the most relevant errors - usually the array/object type errors have the real issue
        var allNestedErrors = error.Errors
            .SelectMany(kvp => kvp.Value)
            .ToList();

        if (allNestedErrors.Count == 1) {
            // Single nested error - just format it directly
            foreach (var msg in FormatError(allNestedErrors[0], depth))
                yield return msg;
            yield break;
        }

        // Multiple nested errors - show them grouped
        yield return $"{indent}{error.Path}: Validation failed for all allowed types:";
        foreach (var (jsonType, childErrors) in error.Errors) {
            if (!childErrors.Any()) continue;

            yield return $"{indent}  As {jsonType}:";

            foreach (var childErr in childErrors)
            foreach (var msg in FormatError(childErr, depth + 2))
                yield return msg;
        }
    }

    /// <summary>
    ///     Formats a ChildSchemaValidationError with all its nested details.
    /// </summary>
    private static IEnumerable<string> FormatChildSchemaError(ChildSchemaValidationError error, int depth) {
        var indent = new string(' ', depth * 2);

        // Header based on error kind
        var header = error.Kind switch {
            ValidationErrorKind.NoTypeValidates => "None of the allowed alternatives validated:",
            ValidationErrorKind.NotAnyOf => "Did not match any of the allowed schemas:",
            ValidationErrorKind.NotOneOf => "Did not match exactly one schema:",
            _ => $"{error.Kind}:"
        };

        yield return $"{indent}{error.Path}: {header}";

        // Show each alternative that was tried
        var altIndex = 0;
        foreach (var (schema, childErrors) in error.Errors) {
            altIndex++;
            var schemaHint = ExtractSchemaHint(schema);
            yield return $"{indent}  Alternative {altIndex} ({schemaHint}):";

            foreach (var childErr in childErrors)
            foreach (var msg in FormatError(childErr, depth + 2))
                yield return msg;
        }
    }

    /// <summary>
    ///     Extracts a human-readable hint about what a schema alternative expects.
    ///     Used to identify which branch of a oneOf failed.
    /// </summary>
    private static string ExtractSchemaHint(JsonSchema schema) {
        // Try to identify by properties
        if (schema.RequiredProperties.Any())
            return $"requires '{string.Join("', '", schema.RequiredProperties)}'";

        // Try to identify by properties with "not" constraints (legacy)
        var notProperties = schema.Properties
            .Where(p => p.Value.Not != null)
            .Select(p => p.Key)
            .ToList();

        if (notProperties.Any())
            return $"forbids '{string.Join("', '", notProperties)}'";

        // Try to identify by properties constrained to null (oneOf "forbid" pattern)
        var nullOnlyProperties = schema.Properties
            .Where(p => p.Value.Type == JsonObjectType.Null)
            .Select(p => p.Key)
            .ToList();

        if (nullOnlyProperties.Any())
            return $"forbids '{string.Join("', '", nullOnlyProperties)}'";

        // Fallback to type
        return schema.Type.ToString();
    }
}