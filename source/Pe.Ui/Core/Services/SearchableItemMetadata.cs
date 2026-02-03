namespace Pe.Ui.Core.Services;

/// <summary>
///     Searchable metadata for palette items. Built on-demand per snapshot.
/// </summary>
public class SearchableItemMetadata {
    /// <summary> Primary text in lowercase (e.g., command name) </summary>
    public string PrimaryLower { get; init; } = string.Empty;

    /// <summary> Secondary text in lowercase (e.g., menu path) </summary>
    public string SecondaryLower { get; init; } = string.Empty;

    /// <summary> Pill text in lowercase (e.g., keyboard shortcuts) </summary>
    public string PillLower { get; init; } = string.Empty;

    /// <summary> Info text in lowercase (e.g., tooltip text) </summary>
    public string InfoLower { get; init; } = string.Empty;

    /// <summary> Pre-split words from primary text for word boundary matching </summary>
    public string[] PrimaryWords { get; init; } = Array.Empty<string>();

    /// <summary> Pre-computed acronym from primary text for acronym matching </summary>
    public string PrimaryAcronym { get; init; } = string.Empty;

    /// <summary> All text fields combined for multi-field operations </summary>
    public string[] AllWords { get; init; } = Array.Empty<string>();
}