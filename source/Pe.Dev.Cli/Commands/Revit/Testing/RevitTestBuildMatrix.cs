using System.Xml.Linq;

namespace Pe.Dev.Cli;

internal sealed record RevitTestBuildMatrix(
    int DefaultRevitYear,
    IReadOnlyList<int> SupportedRevitYears,
    IReadOnlyList<string> TestConfigurations
) {
    private const string FilePath = "build/authored/BuildMatrix.props";

    public static RevitTestBuildMatrix Load(string repositoryRoot) {
        var path = Path.Combine(repositoryRoot, FilePath);
        var document = XDocument.Load(path);

        return new RevitTestBuildMatrix(
            ParseYear(RequireValue(document, "PeDefaultRevitYear")),
            document.Descendants()
                .Where(element => string.Equals(element.Name.LocalName, "PeRevitYear", StringComparison.Ordinal))
                .Select(element => new {
                    Year = ParseYear(RequireAttribute(element, "Include")),
                    Suffix = RequireAttribute(element, "Suffix")
                })
                .OrderBy(element => element.Year)
                .Select(element => element.Year)
                .ToArray(),
            document.Descendants()
                .Where(element => string.Equals(element.Name.LocalName, "PeRevitYear", StringComparison.Ordinal))
                .Select(element => RequireAttribute(element, "Suffix"))
                .Select(suffix => $"Debug.{suffix}.Tests")
                .Concat(document.Descendants()
                    .Where(element => string.Equals(element.Name.LocalName, "PeRevitYear", StringComparison.Ordinal))
                    .Select(element => $"Release.{RequireAttribute(element, "Suffix")}.Tests"))
                .ToArray()
        );
    }

    public string ResolveDefaultTestConfiguration(int revitYear) {
        var suffix = $".R{revitYear % 100:D2}.Tests";
        var match = this.TestConfigurations.FirstOrDefault(configuration =>
            configuration.StartsWith("Debug", StringComparison.OrdinalIgnoreCase) &&
            configuration.EndsWith(suffix, StringComparison.OrdinalIgnoreCase)
        );

        return match ?? $"Debug.R{revitYear % 100:D2}.Tests";
    }

    public static int ParseYearFromConfiguration(string configuration) {
        var match = System.Text.RegularExpressions.Regex.Match(
            configuration,
            @"\.R(?<year>\d{2}|\d{4})(?:\.|$)",
            System.Text.RegularExpressions.RegexOptions.IgnoreCase
        );
        if (!match.Success) {
            throw new ArgumentException(
                $"Could not infer a Revit year from configuration '{configuration}'. Pass --revit-year explicitly."
            );
        }

        return ParseYear(match.Groups["year"].Value);
    }

    private static string RequireValue(XDocument document, string propertyName) {
        var value = document.Descendants()
            .FirstOrDefault(element => string.Equals(element.Name.LocalName, propertyName, StringComparison.Ordinal))
            ?.Value
            .Trim();

        return string.IsNullOrWhiteSpace(value)
            ? throw new InvalidOperationException($"Required build property '{propertyName}' was not found in {FilePath}.")
            : value;
    }

    private static string RequireAttribute(XElement element, string attributeName) {
        var value = element.Attribute(attributeName)?.Value?.Trim();

        return string.IsNullOrWhiteSpace(value)
            ? throw new InvalidOperationException($"Required attribute '{attributeName}' was not found in {FilePath}.")
            : value;
    }

    private static int ParseYear(string value) => RevitTestCliOptions.ParseYear(value);
}
