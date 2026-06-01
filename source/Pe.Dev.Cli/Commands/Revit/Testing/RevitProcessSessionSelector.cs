using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Text.RegularExpressions;

namespace Pe.Dev.Cli;

internal sealed class RevitProcessSessionSelector {
    public IReadOnlyList<RevitProcessSessionIdentity> DiscoverSessions(int? revitYear = null) {
        var sessions = new List<RevitProcessSessionIdentity>();
        foreach (var process in Process.GetProcessesByName("Revit")) {
            try {
                if (process.MainWindowHandle == IntPtr.Zero)
                    continue;

                var title = RevitProcessSessionResolver.GetDisplayTitle(process);
                var parsedYear = RevitProcessSessionResolver.TryResolveRevitYear(process);
                if (revitYear.HasValue && parsedYear != revitYear.Value)
                    continue;

                sessions.Add(
                    new RevitProcessSessionIdentity(
                        process.Id,
                        process.StartTime.ToUniversalTime(),
                        title,
                        parsedYear,
                        process.Responding,
                        RevitProcessSessionResolver.IsHung(process)
                    )
                );
            } catch {
                // Ignore inaccessible process state and keep checking other sessions.
            } finally {
                process.Dispose();
            }
        }

        return sessions
            .OrderByDescending(session => session.ProcessStartUtc)
            .ThenByDescending(session => session.ProcessId)
            .ToArray();
    }
}

internal sealed record RevitProcessSessionIdentity(
    int ProcessId,
    DateTime ProcessStartUtc,
    string MainWindowTitle,
    int? RevitYear,
    bool Responding,
    bool Hung
);

internal static partial class RevitProcessSessionResolver {
    private static readonly Regex YearRegex = new(@"\b20\d{2}\b", RegexOptions.Compiled);

    public static string GetDisplayTitle(Process process) {
        var title = process.MainWindowTitle;
        if (!string.IsNullOrWhiteSpace(title))
            return title;

        var executablePath = TryGetExecutablePath(process);
        if (!string.IsNullOrWhiteSpace(executablePath))
            return executablePath;

        return process.ProcessName;
    }

    public static int? TryResolveRevitYear(Process process) {
        var titleYear = TryParseYear(process.MainWindowTitle);
        if (titleYear.HasValue)
            return titleYear;

        var executablePath = TryGetExecutablePath(process);
        return TryParseYear(executablePath);
    }

    public static bool IsHung(Process process) {
        try {
            return process.MainWindowHandle != IntPtr.Zero && IsHungAppWindow(process.MainWindowHandle);
        } catch {
            return false;
        }
    }

    private static int? TryParseYear(string? value) {
        if (string.IsNullOrWhiteSpace(value))
            return null;

        var match = YearRegex.Match(value);
        return match.Success && int.TryParse(match.Value, out var parsedYear)
            ? parsedYear
            : null;
    }

    private static string? TryGetExecutablePath(Process process) {
        try {
            return process.MainModule?.FileName;
        } catch {
            return null;
        }
    }

    [DllImport("user32.dll")]
    private static extern bool IsHungAppWindow(IntPtr hWnd);
}
