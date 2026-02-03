using Pe.Global.PolyFill;
using Pe.Ui.Core;
using System.Windows.Media.Imaging;
using Color = System.Windows.Media.Color;

namespace Pe.App.Commands.Palette.FamilyPalette;

/// <summary>
///     Type discriminator for unified family items.
/// </summary>
public enum FamilyItemType {
    Family,
    FamilyType,
    FamilyInstance
}

/// <summary>
///     Unified wrapper for Family, FamilySymbol, and FamilyInstance that implements IPaletteListItem.
///     Enables a single tabbed palette for all family-related elements in project documents.
/// </summary>
public class UnifiedFamilyItem : IPaletteListItem {
    private readonly Lazy<string> _textSecondary;

    public UnifiedFamilyItem(Family family) {
        this.ItemType = FamilyItemType.Family;
        this.Family = family;
        this._textSecondary = new Lazy<string>(this.GetFamilyTypeNames);
    }

    public UnifiedFamilyItem(FamilySymbol familySymbol) {
        this.ItemType = FamilyItemType.FamilyType;
        this.FamilySymbol = familySymbol;
        // Family name is a simple property access, no need for lazy
        this._textSecondary = new Lazy<string>(() => familySymbol.Family.Name);
    }

    public UnifiedFamilyItem(FamilyInstance familyInstance) {
        this.ItemType = FamilyItemType.FamilyInstance;
        this.FamilyInstance = familyInstance;
        this._textSecondary = new Lazy<string>(this.GetInstanceLocation);
    }

    /// <summary>
    ///     The type of family item this represents.
    /// </summary>
    public FamilyItemType ItemType { get; }

    /// <summary>
    ///     The underlying Family. Only set when ItemType is Family.
    /// </summary>
    public Family? Family { get; }

    /// <summary>
    ///     The underlying FamilySymbol. Only set when ItemType is FamilyType.
    /// </summary>
    public FamilySymbol? FamilySymbol { get; }

    /// <summary>
    ///     The underlying FamilyInstance. Only set when ItemType is FamilyInstance.
    /// </summary>
    public FamilyInstance? FamilyInstance { get; }

    /// <summary>
    ///     Gets a unique persistence key for usage tracking.
    /// </summary>
    public string PersistenceKey => this.ItemType switch {
        FamilyItemType.Family => $"F:{this.Family!.Id}",
        FamilyItemType.FamilyType => $"T:{this.FamilySymbol!.Id}",
        FamilyItemType.FamilyInstance => $"I:{this.FamilyInstance!.Id}",
        _ => string.Empty
    };

    public string TextPrimary => this.ItemType switch {
        FamilyItemType.Family => this.Family!.Name,
        FamilyItemType.FamilyType => this.FamilySymbol!.Name,
        FamilyItemType.FamilyInstance => $"{this.FamilyInstance!.Symbol.Name} ({this.FamilyInstance.Id.Value()})",
        _ => string.Empty
    };

    public string TextSecondary => this._textSecondary.Value;

    /// <summary>
    ///     TextPill returns the filter category for each item type:
    ///     - Family: Category name (filter by category)
    ///     - FamilyType: Family name (filter by family)
    ///     - FamilyInstance: Type name (filter by type)
    /// </summary>
    public string TextPill => this.ItemType switch {
        FamilyItemType.Family => this.Family!.FamilyCategory?.Name ?? string.Empty,
        FamilyItemType.FamilyType => this.FamilySymbol!.Family.Name,
        FamilyItemType.FamilyInstance => this.FamilyInstance!.Symbol.Name,
        _ => string.Empty
    };

    public Func<string>? GetTextInfo => null; // Sidebar preview provides detailed info

    public BitmapImage? Icon => null;
    public Color? ItemColor => null;

    /// <summary>
    ///     Gets the Family for any item type.
    /// </summary>
    public Family? GetFamily() => this.ItemType switch {
        FamilyItemType.Family => this.Family,
        FamilyItemType.FamilyType => this.FamilySymbol?.Family,
        FamilyItemType.FamilyInstance => this.FamilyInstance?.Symbol.Family,
        _ => null
    };

    private string GetFamilyTypeNames() {
        // Just show the count - much cheaper than enumerating all names
        var count = this.Family!.GetFamilySymbolIds().Count;
        return count == 1 ? "1 type" : $"{count} types";
    }

    private string GetInstanceLocation() {
        var location = this.FamilyInstance!.Location;

        if (location is LocationPoint locPoint) {
            var pt = locPoint.Point;
            return $"Location: ({pt.X:F2}, {pt.Y:F2}, {pt.Z:F2})";
        }

        if (location is LocationCurve locCurve) {
            var midpoint = locCurve.Curve.Evaluate(0.5, true);
            return $"Location: ({midpoint.X:F2}, {midpoint.Y:F2}, {midpoint.Z:F2})";
        }

        return $"ID: {this.FamilyInstance.Id}";
    }
}