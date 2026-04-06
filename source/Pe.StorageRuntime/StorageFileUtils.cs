namespace Pe.StorageRuntime;

internal static class StorageFileUtils {
    public static string EnsureExtension(string filename, string expectedExtension) {
        if (string.IsNullOrWhiteSpace(filename))
            throw new ArgumentException("Filename cannot be null, empty, or whitespace.", nameof(filename));
        if (string.IsNullOrWhiteSpace(expectedExtension))
            throw new ArgumentException("Expected extension cannot be null, empty, or whitespace.",
                nameof(expectedExtension));

        var normalizedExpectedExtension = expectedExtension.StartsWith(".")
            ? expectedExtension.ToLowerInvariant()
            : $".{expectedExtension.ToLowerInvariant()}";
        var normalizedPath = filename.Replace('/', Path.DirectorySeparatorChar);
        var directoryPart = Path.GetDirectoryName(normalizedPath) ?? string.Empty;
        var filenamePart = Path.GetFileName(normalizedPath);

        if (string.IsNullOrWhiteSpace(filenamePart))
            throw new ArgumentException("Path must contain a valid filename component.", nameof(filename));
        if (filenamePart.IndexOfAny(Path.GetInvalidFileNameChars()) >= 0)
            throw new ArgumentException($"Filename contains invalid characters: {filenamePart}", nameof(filename));

        var currentExtension = Path.GetExtension(filenamePart);
        if (string.Equals(currentExtension, normalizedExpectedExtension, StringComparison.OrdinalIgnoreCase))
            return normalizedPath;

        if (!string.IsNullOrEmpty(currentExtension)) {
            throw new ArgumentException(
                $"Filename has extension '{currentExtension}' but expected '{normalizedExpectedExtension}'.",
                nameof(filename)
            );
        }

        var filenameWithExtension = filenamePart + normalizedExpectedExtension;
        return string.IsNullOrEmpty(directoryPart)
            ? filenameWithExtension
            : Path.Combine(directoryPart, filenameWithExtension);
    }

    public static void ValidateFileNameAndExtension(string filePath, string expectedExtension) {
        if (string.IsNullOrWhiteSpace(filePath))
            throw new ArgumentException("File path cannot be null, empty, or whitespace.", nameof(filePath));
        if (string.IsNullOrWhiteSpace(expectedExtension))
            throw new ArgumentException("Expected extension cannot be null, empty, or whitespace.",
                nameof(expectedExtension));

        var fileName = Path.GetFileName(filePath);
        var actualExtension = Path.GetExtension(fileName);
        var normalizedExpectedExtension = expectedExtension.StartsWith(".")
            ? expectedExtension.ToLowerInvariant()
            : $".{expectedExtension.ToLowerInvariant()}";

        if (string.IsNullOrWhiteSpace(fileName))
            throw new ArgumentException("File path must contain a valid filename.", nameof(filePath));
        if (fileName.IndexOfAny(Path.GetInvalidFileNameChars()) >= 0)
            throw new ArgumentException($"Filename contains invalid characters: {fileName}", nameof(filePath));
        if (!string.Equals(actualExtension, normalizedExpectedExtension, StringComparison.OrdinalIgnoreCase)) {
            throw new ArgumentException(
                $"File must have a '{normalizedExpectedExtension}' extension. Found '{actualExtension}'.",
                nameof(filePath)
            );
        }
    }

    public static string EnsureDirectoryExists(string filePath) {
        var directoryPath = Path.GetDirectoryName(filePath);
        if (!string.IsNullOrWhiteSpace(directoryPath) && !Directory.Exists(directoryPath))
            _ = Directory.CreateDirectory(directoryPath);
        return directoryPath ?? string.Empty;
    }
}
