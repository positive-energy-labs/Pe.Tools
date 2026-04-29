using System.Xml.Linq;

namespace Pe.Dev.Cli;

internal sealed record RevitTestBuildMatrix(
    int DefaultRevitYear,
    IReadOnlyList<int> SupportedRevitYears,
    IReadOnlyList<string> TestConfigurations
) {
    private const string FilePath = "build/BuildConfiguration.props";

    public static RevitTestBuildMatrix Load(string repositoryRoot) {
        var path = Path.Combine(repositoryRoot, FilePath);
        var document = XDocument.Load(path);

        return new RevitTestBuildMatrix(
            ParseYear(RequireValue(document, "PeDefaultRevitYear")),
            SplitList(RequireValue(document, "PeSupportedRevitYears")).Select(ParseYear).ToArray(),
            SplitList(RequireValue(document, "PeRevitTestConfigurations"))
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

    private static IReadOnlyList<string> SplitList(string value) =>
        value.Split(';', StringSplitOptions.TrimEntries | StringSplitOptions.RemoveEmptyEntries);

    private static int ParseYear(string value) => RevitTestCliOptions.ParseYear(value);
}
