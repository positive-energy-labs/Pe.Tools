using System.Text;

namespace Pe.Shared.StorageRuntime;

public sealed class ManagedLogFile {
    private const string TimestampFormat = "yyyy-MM-dd HH:mm:ss";
    private readonly object _sync = new();
    private readonly int _maxLines;
    private readonly long _trimThresholdBytes;

    public ManagedLogFile(string filePath, int maxLines, long trimThresholdBytes) {
        if (string.IsNullOrWhiteSpace(filePath))
            throw new ArgumentException("File path is required.", nameof(filePath));
        if (maxLines <= 0)
            throw new ArgumentOutOfRangeException(nameof(maxLines), "Max lines must be greater than zero.");
        if (trimThresholdBytes <= 0)
            throw new ArgumentOutOfRangeException(
                nameof(trimThresholdBytes),
                "Trim threshold must be greater than zero.");

        this.FilePath = EnsureFileDirectory(filePath);
        _maxLines = maxLines;
        _trimThresholdBytes = trimThresholdBytes;
    }

    public string FilePath { get; }

    public void Append(string text) {
        if (string.IsNullOrEmpty(text))
            return;

        lock (_sync) {
            this.TrimIfNeeded();
            File.AppendAllText(this.FilePath, text);
        }
    }

    public void AppendTimestampedMessage(string message) {
        var logEntry = $"({DateTime.Now.ToString(TimestampFormat)}) {message}{Environment.NewLine}{Environment.NewLine}";
        this.Append(logEntry);
    }

    public void AppendStructuredEntry(
        string levelCode,
        string source,
        string message,
        string? eventName = null,
        Exception? exception = null
    ) {
        if (string.IsNullOrWhiteSpace(levelCode))
            throw new ArgumentException("Level code is required.", nameof(levelCode));
        if (string.IsNullOrWhiteSpace(source))
            throw new ArgumentException("Source is required.", nameof(source));
        if (string.IsNullOrWhiteSpace(message) && exception == null)
            return;

        var builder = new StringBuilder()
            .Append(DateTime.Now.ToString(TimestampFormat))
            .Append(" [")
            .Append(levelCode)
            .Append("] ")
            .Append(source);

        if (!string.IsNullOrWhiteSpace(eventName)) {
            _ = builder
                .Append(" (")
                .Append(eventName)
                .Append(')');
        }

        if (!string.IsNullOrWhiteSpace(message))
            _ = builder.Append(": ").AppendLine(message);

        if (exception != null)
            _ = builder.AppendLine(exception.ToString());

        this.Append(builder.ToString());
    }

    public string[] ReadAllLines() =>
        File.Exists(this.FilePath)
            ? File.ReadAllLines(this.FilePath)
            : [];

    private void TrimIfNeeded() {
        if (!File.Exists(this.FilePath))
            return;

        var fileInfo = new FileInfo(this.FilePath);
        if (fileInfo.Length <= _trimThresholdBytes)
            return;

        var lines = File.ReadAllLines(this.FilePath);
        if (lines.Length <= _maxLines)
            return;

        File.WriteAllLines(this.FilePath, lines.Skip(lines.Length - _maxLines).ToArray());
    }

    private static string EnsureFileDirectory(string filePath) {
        var fullPath = Path.GetFullPath(filePath);
        var directoryPath = Path.GetDirectoryName(fullPath)
                            ?? throw new InvalidOperationException("Log file directory could not be resolved.");
        _ = Directory.CreateDirectory(directoryPath);
        return fullPath;
    }
}
