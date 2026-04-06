namespace Pe.Revit.Ui.Core.Services;

/// <summary>
///     Immutable snapshot of searchable fields for a palette item.
///     Captured in Revit context to avoid API access on background threads.
/// </summary>
public readonly record struct PaletteSearchSnapshot<TItem>(
    TItem Item,
    SearchableItemMetadata Metadata,
    string FilterKey,
    string? UsageKey
);
