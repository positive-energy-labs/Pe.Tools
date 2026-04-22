using Pe.Shared.SettingsLayout;

namespace Pe.Host.Services;

internal sealed class HostFileLoggerProvider(ManagedLogFile logFile) : ILoggerProvider {
    private readonly ManagedLogFile _logFile = logFile;

    public ILogger CreateLogger(string categoryName) => new HostFileLogger(categoryName, this._logFile);

    public void Dispose() { }
}

internal sealed class HostFileLogger(string categoryName, ManagedLogFile logFile) : ILogger {
    private readonly string _categoryName = categoryName;
    private readonly ManagedLogFile _logFile = logFile;

    public IDisposable? BeginScope<TState>(TState state) where TState : notnull => null;

    public bool IsEnabled(LogLevel logLevel) => logLevel != LogLevel.None;

    public void Log<TState>(
        LogLevel logLevel,
        EventId eventId,
        TState state,
        Exception? exception,
        Func<TState, Exception?, string> formatter
    ) {
        if (!this.IsEnabled(logLevel))
            return;

        var message = formatter(state, exception);
        if (string.IsNullOrWhiteSpace(message) && exception == null)
            return;

        try {
            this._logFile.AppendStructuredEntry(
                ToShortLevel(logLevel), this._categoryName,
                message,
                ResolveEventName(eventId),
                exception
            );
        } catch {
            // Never let file logging destabilize the host logging pipeline.
        }
    }

    private static string? ResolveEventName(EventId eventId) =>
        eventId.Id != 0 || !string.IsNullOrWhiteSpace(eventId.Name)
            ? eventId.Name ?? eventId.Id.ToString()
            : null;

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