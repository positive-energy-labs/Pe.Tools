using Microsoft.Extensions.Logging;
using Pe.Shared.StorageRuntime;
using System.Text;

namespace Pe.Host.Services;

internal sealed class HostFileLoggerProvider : ILoggerProvider {
    private readonly HostLogFileWriter _writer;

    public HostFileLoggerProvider(string filePath) {
        _writer = new HostLogFileWriter(filePath);
    }

    public ILogger CreateLogger(string categoryName) => new HostFileLogger(categoryName, _writer);

    public void Dispose() => _writer.Dispose();
}

internal static class HostLogStorage {
    public static string ResolveFilePath() {
        var globalLogPath = StorageClient.Default.Global().Log().FilePath;
        var directoryPath = Path.GetDirectoryName(globalLogPath)
                            ?? throw new InvalidOperationException("Global log directory could not be resolved.");
        _ = Directory.CreateDirectory(directoryPath);
        return Path.Combine(directoryPath, "host.log.txt");
    }
}

internal sealed class HostFileLogger(string categoryName, HostLogFileWriter writer) : ILogger {
    private readonly string _categoryName = categoryName;
    private readonly HostLogFileWriter _writer = writer;

    public IDisposable? BeginScope<TState>(TState state) where TState : notnull => null;

    public bool IsEnabled(LogLevel logLevel) => logLevel != LogLevel.None;

    public void Log<TState>(
        LogLevel logLevel,
        EventId eventId,
        TState state,
        Exception? exception,
        Func<TState, Exception?, string> formatter
    ) {
        if (!IsEnabled(logLevel))
            return;

        var message = formatter(state, exception);
        if (string.IsNullOrWhiteSpace(message) && exception == null)
            return;

        try {
            _writer.Append(_categoryName, logLevel, eventId, message, exception);
        } catch {
            // Never let file logging destabilize the host logging pipeline.
        }
    }
}

internal sealed class HostLogFileWriter(string filePath) : IDisposable {
    private const string TimestampFormat = "yyyy-MM-dd HH:mm:ss";
    private const int MaxLines = 2000;
    private const long TrimThresholdBytes = 1_048_576;

    private readonly object _sync = new();

    public string FilePath { get; } = EnsureFileDirectory(filePath);

    public void Append(string categoryName, LogLevel logLevel, EventId eventId, string message, Exception? exception) {
        lock (_sync) {
            TrimIfNeeded();

            var builder = new StringBuilder()
                .Append(DateTime.Now.ToString(TimestampFormat))
                .Append(" [")
                .Append(ToShortLevel(logLevel))
                .Append("] ")
                .Append(categoryName);

            if (eventId.Id != 0 || !string.IsNullOrWhiteSpace(eventId.Name)) {
                builder
                    .Append(" (")
                    .Append(eventId.Name ?? eventId.Id.ToString())
                    .Append(')');
            }

            builder.Append(": ").AppendLine(message);

            if (exception != null)
                builder.AppendLine(exception.ToString());

            File.AppendAllText(FilePath, builder.ToString());
        }
    }

    public void Dispose() { }

    private void TrimIfNeeded() {
        if (!File.Exists(FilePath))
            return;

        var fileInfo = new FileInfo(FilePath);
        if (fileInfo.Length <= TrimThresholdBytes)
            return;

        var trimmedLines = File.ReadLines(FilePath)
            .TakeLast(MaxLines)
            .ToArray();
        File.WriteAllLines(FilePath, trimmedLines);
    }

    private static string EnsureFileDirectory(string filePath) {
        if (string.IsNullOrWhiteSpace(filePath))
            throw new ArgumentException("File path is required.", nameof(filePath));

        var fullPath = Path.GetFullPath(filePath);
        var directoryPath = Path.GetDirectoryName(fullPath)
                            ?? throw new InvalidOperationException("Log file directory could not be resolved.");
        _ = Directory.CreateDirectory(directoryPath);
        return fullPath;
    }

    private static string ToShortLevel(LogLevel logLevel) =>
        logLevel switch {
            LogLevel.Trace => "TRC",
            LogLevel.Debug => "DBG",
            LogLevel.Information => "INF",
            LogLevel.Warning => "WRN",
            LogLevel.Error => "ERR",
            LogLevel.Critical => "CRT",
            _ => "UNK"
        };
}
