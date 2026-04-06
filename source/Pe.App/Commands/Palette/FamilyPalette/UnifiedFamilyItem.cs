using Pe.Revit.Global.PolyFill;
using Pe.Revit.Ui.Core;
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

    public UnifiedFamilyItem(Family family) {
        this.ItemType = FamilyItemType.Family;
        this.Family = family;
    }

    public UnifiedFamilyItem(FamilySymbol familySymbol) {
        this.ItemType = FamilyItemType.FamilyType;
        this.FamilySymbol = familySymbol;
    }

    public UnifiedFamilyItem(FamilyInstance familyInstance) {
        this.ItemType = FamilyItemType.FamilyInstance;
        this.FamilyInstance = familyInstance;
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
        FamilyItemType.Family => $"F:{this.Family?.Id}",
        FamilyItemType.FamilyType => $"T:{this.FamilySymbol?.Id}",
        FamilyItemType.FamilyInstance => $"I:{this.FamilyInstance?.Id}",
        _ => string.Empty
    };

    public string TextPrimary => this.ItemType switch {
        FamilyItemType.Family => this.GetFamily()?.Name ?? "Unknown",
        FamilyItemType.FamilyType => this.GetFamilySymbol()?.Name ?? "Unknown",
        FamilyItemType.FamilyInstance => $"{this.GetFamilySymbol()?.Name ?? "Unknown"}",
        _ => string.Empty
    };

    public string TextSecondary => this.ItemType switch {
        FamilyItemType.Family => this.GetFamilyTypeNames(),
        FamilyItemType.FamilyType => this.GetFamily()?.Name ?? "Unknown",
        _ => string.Empty
    };
    public string TextPill => this.GetFamily()?.FamilyCategory?.Name ?? "Unknown";

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

    public FamilySymbol? GetFamilySymbol() => this.ItemType switch {
        FamilyItemType.FamilyType => this.FamilySymbol,
        FamilyItemType.FamilyInstance => this.FamilyInstance?.Symbol,
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