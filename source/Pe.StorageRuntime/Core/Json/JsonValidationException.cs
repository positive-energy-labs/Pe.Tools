using ValidationError = NJsonSchema.Validation.ValidationError;

namespace Pe.StorageRuntime.Revit.Core.Json;

public class JsonValidationException : Exception {
    public JsonValidationException(string message) : base(message) {
        this.FilePath = string.Empty;
        this.ValidationErrors = [];
    }

    public JsonValidationException(string path, IEnumerable<string> validationErrors)
        : base(FormatValidationErrors(path, validationErrors)) {
        this.FilePath = path;
        this.ValidationErrors = validationErrors.ToList();
    }

    public JsonValidationException(string path, IEnumerable<ValidationError> validationErrors)
        : this(path, validationErrors.Select(error => error.ToString())) {
    }

    public string FilePath { get; }
    public List<string> ValidationErrors { get; }

    private static string FormatValidationErrors(string path, IEnumerable<string> errors) {
        var errorList = errors.ToList();
        return
            $"JSON validation failed at {path} with {errorList.Count} error{(errorList.Count != 1 ? "s" : "")}:{Environment.NewLine}" +
            string.Join(Environment.NewLine, errorList.Select((error, index) => $"  {index + 1}. {error}"));
    }
}