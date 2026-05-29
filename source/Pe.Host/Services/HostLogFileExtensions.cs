using Pe.Shared.StorageRuntime;
using System.Diagnostics;

namespace Pe.Host.Services;

internal static class HostLogFileExtensions {
    public static void AppendDemystifiedEntry(
        this ManagedLogFile logFile,
        string levelCode,
        string source,
        string message,
        string? eventName = null,
        Exception? exception = null
    ) => logFile.AppendStructuredEntry(
        levelCode,
        source,
        FormatMessage(message, exception),
        eventName
    );

    private static string FormatMessage(string message, Exception? exception) =>
        exception == null
            ? message
            : string.Join(Environment.NewLine, message, exception.Demystify().ToString());
}
