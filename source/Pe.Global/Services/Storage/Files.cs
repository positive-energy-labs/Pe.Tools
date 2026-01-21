using System.Security.Cryptography;

namespace Pe.Global.Services.Storage;

public static class FileUtils {
    /// <summary> Computes the SHA256 hash of a file </summary>
    public static string ComputeFileHashFromPath(string filePath) {
        using var stream = File.OpenRead(filePath);
        using var sha = SHA256.Create();
        var hashBytes = sha.ComputeHash(stream);
        return Convert.ToBase64String(hashBytes);
    }

    public static string ComputeFileHashFromText(string fileText) {
        if (fileText == null) throw new ArgumentNullException(nameof(fileText));

        var bytes = Encoding.UTF8.GetBytes(fileText);
        using var sha = SHA256.Create();
        var hashBytes = sha.ComputeHash(bytes);
        return Convert.ToBase64String(hashBytes);
    }

    /// <summary>
    ///     Ensures a filename has the expected extension, adding it if missing.
    ///     Validates that the filename doesn't contain invalid characters.
    ///     Supports subdirectory paths (e.g., "subdir/file" or "subdir\file").
    /// </summary>
    /// <param name="filename">The filename or relative path (with or without extension)</param>
    /// <param name="expectedExt">The expected extension (with or without leading dot)</param>
    /// <returns>The filename/path with the correct extension</returns>
    /// <exception cref="ArgumentException">If the filename is invalid or contains invalid characters</exception>
    public static string EnsureExtension(string filename, string expectedExt) {
        if (string.IsNullOrWhiteSpace(filename))
            throw new ArgumentException("Filename cannot be null, empty, or whitespace.", nameof(filename));
        if (string.IsNullOrWhiteSpace(expectedExt)) {
            throw new ArgumentException("Expected extension cannot be null, empty, or whitespace.",
                nameof(expectedExt));
        }

        var normalizedExpectedExt = expectedExt.StartsWith(".")
            ? expectedExt.ToLowerInvariant()
            : $".{expectedExt.ToLowerInvariant()}";

        // Normalize path separators to handle both / and \
        var normalizedPath = filename.Replace('/', Path.DirectorySeparatorChar);

        // Split into directory and filename components
        var directoryPart = Path.GetDirectoryName(normalizedPath) ?? string.Empty;
        var filenamePart = Path.GetFileName(normalizedPath);

        if (string.IsNullOrWhiteSpace(filenamePart))
            throw new ArgumentException("Path must contain a valid filename component.", nameof(filename));

        // Check for invalid characters in the filename part only (not directory separators)
        var invalidChars = Path.GetInvalidFileNameChars();
        if (filenamePart.IndexOfAny(invalidChars) >= 0)
            throw new ArgumentException($"Filename contains invalid characters: {filenamePart}", nameof(filename));

        // If filename already has the correct extension, return as-is
        var currentExt = Path.GetExtension(filenamePart);
        if (string.Equals(currentExt, normalizedExpectedExt, StringComparison.OrdinalIgnoreCase))
            return normalizedPath;

        // If filename has a different extension, throw an error
        if (!string.IsNullOrEmpty(currentExt)) {
            throw new ArgumentException(
                $"Filename has extension '{currentExt}' but expected '{normalizedExpectedExt}'. " +
                $"Either remove the extension or use the correct one.",
                nameof(filename));
        }

        // Add the expected extension to the filename part and recombine
        var filenameWithExt = filenamePart + normalizedExpectedExt;
        return string.IsNullOrEmpty(directoryPart)
            ? filenameWithExt
            : Path.Combine(directoryPart, filenameWithExt);
    }

    public static void ValidateFileNameAndExtension(string filePath, string expectedExt) {
        if (string.IsNullOrWhiteSpace(filePath))
            throw new ArgumentException(@"File path cannot be null, empty, or whitespace.", nameof(filePath));
        if (string.IsNullOrWhiteSpace(expectedExt)) {
            throw new ArgumentException(@"Expected extension cannot be null, empty, or whitespace.",
                nameof(expectedExt));
        }

        var fileName = Path.GetFileName(filePath);
        var fileExt = Path.GetExtension(fileName);
        var normalizedExpectedExtension = expectedExt.StartsWith(".")
            ? expectedExt.ToLowerInvariant()
            : $".{expectedExt.ToLowerInvariant()}";


        if (string.IsNullOrEmpty(fileName))
            throw new ArgumentException(@"File path must contain a valid filename.", nameof(filePath));
        if (fileName.IndexOfAny(Path.GetInvalidFileNameChars()) >= 0)
            throw new ArgumentException($@"Filename contains invalid characters: {fileName}", nameof(filePath));
        if (!string.Equals(fileExt, normalizedExpectedExtension, StringComparison.OrdinalIgnoreCase)) {
            throw new ArgumentException($@"File must have a '{expectedExt}' extension. Found '{fileExt ?? "null"}'.",
                nameof(filePath));
        }
    }

    /// <summary>
    ///     Opens the file in the default application for the file type
    /// </summary>
    public static void OpenInDefaultApp(string filePath) {
        try {
            if (File.Exists(filePath)) {
                var processStartInfo = new ProcessStartInfo { FileName = filePath, UseShellExecute = true };
                _ = Process.Start(processStartInfo);
            }
        } catch {
            // TODO: update this to give feedback
        }
    }
}