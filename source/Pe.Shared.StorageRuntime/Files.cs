using System.Diagnostics;
using System.Security.Cryptography;
using System.Text;

namespace Pe.Shared.StorageRuntime.Revit;

public static class FileUtils {
    public static string ComputeFileHashFromPath(string filePath) {
        using var stream = File.OpenRead(filePath);
        using var sha = SHA256.Create();
        var hashBytes = sha.ComputeHash(stream);
        return Convert.ToBase64String(hashBytes);
    }

    public static string ComputeFileHashFromText(string fileText) {
        if (fileText == null)
            throw new ArgumentNullException(nameof(fileText));

        var bytes = Encoding.UTF8.GetBytes(fileText);
        using var sha = SHA256.Create();
        var hashBytes = sha.ComputeHash(bytes);
        return Convert.ToBase64String(hashBytes);
    }

    public static string EnsureExtension(string filename, string expectedExt) {
        if (string.IsNullOrWhiteSpace(filename))
            throw new ArgumentException("Filename cannot be null, empty, or whitespace.", nameof(filename));
        if (string.IsNullOrWhiteSpace(expectedExt))
            throw new ArgumentException("Expected extension cannot be null, empty, or whitespace.",
                nameof(expectedExt));

        var normalizedExpectedExt = expectedExt.StartsWith(".")
            ? expectedExt.ToLowerInvariant()
            : $".{expectedExt.ToLowerInvariant()}";
        var normalizedPath = filename.Replace('/', Path.DirectorySeparatorChar);
        var directoryPart = Path.GetDirectoryName(normalizedPath) ?? string.Empty;
        var filenamePart = Path.GetFileName(normalizedPath);

        if (string.IsNullOrWhiteSpace(filenamePart))
            throw new ArgumentException("Path must contain a valid filename component.", nameof(filename));

        var invalidChars = Path.GetInvalidFileNameChars();
        if (filenamePart.IndexOfAny(invalidChars) >= 0)
            throw new ArgumentException($"Filename contains invalid characters: {filenamePart}", nameof(filename));

        var currentExt = Path.GetExtension(filenamePart);
        if (string.Equals(currentExt, normalizedExpectedExt, StringComparison.OrdinalIgnoreCase))
            return normalizedPath;

        if (!string.IsNullOrEmpty(currentExt)) {
            throw new ArgumentException(
                $"Filename has extension '{currentExt}' but expected '{normalizedExpectedExt}'. " +
                $"Either remove the extension or use the correct one.",
                nameof(filename)
            );
        }

        var filenameWithExt = filenamePart + normalizedExpectedExt;
        return string.IsNullOrEmpty(directoryPart)
            ? filenameWithExt
            : Path.Combine(directoryPart, filenameWithExt);
    }

    public static void ValidateFileNameAndExtension(string filePath, string expectedExt) {
        if (string.IsNullOrWhiteSpace(filePath))
            throw new ArgumentException(@"File path cannot be null, empty, or whitespace.", nameof(filePath));
        if (string.IsNullOrWhiteSpace(expectedExt))
            throw new ArgumentException(@"Expected extension cannot be null, empty, or whitespace.",
                nameof(expectedExt));

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
            throw new ArgumentException(
                $@"File must have a '{expectedExt}' extension. Found '{fileExt ?? "null"}'.",
                nameof(filePath)
            );
        }
    }

    public static void OpenInDefaultApp(string filePath) {
        try {
            if (File.Exists(filePath)) {
                var processStartInfo = new ProcessStartInfo { FileName = filePath, UseShellExecute = true };
                _ = Process.Start(processStartInfo);
            }
        } catch {
        }
    }
}