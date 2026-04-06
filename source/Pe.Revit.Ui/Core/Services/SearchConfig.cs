namespace Pe.Ui.Core.Services;

/// <summary>
///     Flags for specifying which fields to search within palette items
/// </summary>
[Flags]
public enum SearchFields {
    None = 0,
    TextPrimary = 1 << 0, // Main display text (e.g., command name, view name)
    TextSecondary = 1 << 1, // Subtitle/description text (e.g., menu paths, view type)
    TextPill = 1 << 2, // Badge/pill text (e.g., keyboard shortcuts)
    TextInfo = 1 << 3, // Full tooltip text for detailed information
    All = TextPrimary | TextSecondary | TextPill | TextInfo
}

/// <summary>
///     Configuration for search behavior in palette filtering
/// </summary>
public class SearchConfig {
    /// <summary>
    ///     Which fields to search. Default is TextPrimary only.
    /// </summary>
    public SearchFields SearchFields { get; set; } = SearchFields.TextPrimary;

    /// <summary>
    ///     Optional custom scoring function to adjust search scores.
    ///     Receives the item and the calculated base score, returns adjusted score.
    /// </summary>
    public Func<IPaletteListItem, double, double> CustomScoreAdjuster { get; set; }

    /// <summary>
    ///     Field weight multipliers for score calculation.
    ///     Default: Primary=1.0, Secondary=0.7, Pill=0.5, Info=0.3
    /// </summary>
    public SearchFieldWeights FieldWeights { get; set; } = new();

    /// <summary>
    ///     Minimum fuzzy score threshold (0.0 to 1.0). Default is 0.7.
    /// </summary>
    public double MinFuzzyScore { get; set; } = 0.7;

    /// <summary>
    ///     Creates a default search config (TextPrimary only)
    /// </summary>
    public static SearchConfig Default() => new();

    /// <summary>
    ///     Creates a config that searches primary and secondary fields
    /// </summary>
    public static SearchConfig PrimaryAndSecondary() =>
        new() { SearchFields = SearchFields.TextPrimary | SearchFields.TextSecondary };

    /// <summary>
    ///     Creates a config that searches all fields
    /// </summary>
    public static SearchConfig AllFields() => new() { SearchFields = SearchFields.All };
}

/// <summary>
///     Weight multipliers for different search fields
/// </summary>
public class SearchFieldWeights {
    public double Primary { get; set; } = 1.0;
    public double Secondary { get; set; } = 0.7;
    public double Pill { get; set; } = 0.5;
    public double Info { get; set; } = 0.3;
}