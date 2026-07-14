using NJsonSchema.Validation;

namespace Pe.Revit.Global;

/// <summary>
///     Exception thrown when an element has intersections with other elements
///     that prevent an operation from completing successfully.
/// </summary>
public class ElementIntersectException : Exception {
    /// <summary>
    ///     Creates a new instance of IntersectingElementsException
    /// </summary>
    /// <param name="reference">The ID of the reference element</param>
    /// <param name="intersections">The IDs of intersecting elements</param>
    public ElementIntersectException(ElementId? reference, ElementId[] intersections)
        : base(FormatDefaultMessage(reference, intersections)) {
        this.ReferenceElement = reference;
        this.IntersectionElements = intersections;
    }

    public ElementId? ReferenceElement { get; }
    public ElementId[] IntersectionElements { get; }

    private static string FormatDefaultMessage(ElementId? reference, ElementId[] intersections) {
        if (reference == null)
            return $"{intersections.Length} elements intersect";
        return $"Element {reference} has {intersections.Length} intersection{(intersections.Length != 1 ? "s" : "")}";
    }
}

public class JsonValidationException : Exception {
    public JsonValidationException(string message) : base(message) {
        this.FilePath = string.Empty;
        this.ValidationErrors = new List<string>();
    }

    /// <summary>Creates a JsonValidationException with a formatted list of validation errors</summary>
    /// <param name="path">Path to the JSON file that failed validation</param>
    /// <param name="validationErrors">List of validation error messages</param>
    public JsonValidationException(string path, IEnumerable<string> validationErrors)
        : base(FormatValidationErrors(path, validationErrors)) {
        this.FilePath = path;
        this.ValidationErrors = validationErrors.ToList();
    }

    public JsonValidationException(string path, IEnumerable<ValidationError> validationErrors)
        : this(path, ValidationErrorFormatter.Format(validationErrors)) {
    }

    /// <summary>Path to the JSON file that failed validation</summary>
    public string FilePath { get; }

    /// <summary>Structured list of validation errors for programmatic access</summary>
    public List<string> ValidationErrors { get; }

    private static string FormatValidationErrors(string path, IEnumerable<string> errors) {
        var errorList = errors.ToList();
        return $"JSON validation failed at {path} with {errorList.Count} error{(errorList.Count != 1 ? "s" : "")}:\n" +
               string.Join("\n", errorList.Select((error, index) => $"  {index + 1}. {error}"));
    }
}

