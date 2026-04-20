using System.Diagnostics;
using System.Text.RegularExpressions;

namespace Pe.Dev.RevitAutomation;

internal static class RevitProcessIdentityResolver {
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
}
