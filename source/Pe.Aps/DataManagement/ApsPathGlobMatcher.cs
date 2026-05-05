using System.Text.RegularExpressions;

namespace Pe.Aps.DataManagement;

internal sealed class ApsPathGlobMatcher {
    private readonly Regex[] _patterns;

    public ApsPathGlobMatcher(IEnumerable<string> patterns) {
        this._patterns = patterns
            .Where(pattern => !string.IsNullOrWhiteSpace(pattern))
            .Select(pattern => pattern.Trim())
            .Distinct(StringComparer.OrdinalIgnoreCase)
            .Select(BuildRegex)
            .ToArray();
    }

    public bool IsMatch(string path, bool treatAsFolder = false) {
        if (this._patterns.Length == 0)
            return false;

        var normalized = Normalize(path);
        var normalizedFolder = treatAsFolder && !normalized.EndsWith("/", StringComparison.Ordinal)
            ? normalized + "/"
            : normalized;

        return this._patterns.Any(pattern =>
            pattern.IsMatch(normalized) ||
            (treatAsFolder && pattern.IsMatch(normalizedFolder)));
    }

    private static Regex BuildRegex(string pattern) {
        var normalized = Normalize(pattern);
        var regex = Regex.Escape(normalized)
            .Replace(@"\*\*", "__DOUBLE_STAR__")
            .Replace(@"\*", "__SINGLE_STAR__")
            .Replace(@"\?", "__QUESTION__")
            .Replace("__DOUBLE_STAR__", ".*")
            .Replace("__SINGLE_STAR__", "[^/]*")
            .Replace("__QUESTION__", "[^/]");

        return new Regex($"^{regex}$", RegexOptions.IgnoreCase | RegexOptions.CultureInvariant);
    }

    private static string Normalize(string path) =>
        path.Trim().Replace('\\', '/');
}
