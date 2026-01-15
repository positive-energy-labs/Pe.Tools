using Pe.Ui.Core;
using System.Windows.Media.Imaging;
using Color = System.Windows.Media.Color;

namespace Pe.App.Commands.Palette.ViewPalette;

/// <summary>
///     Type discriminator for unified view items.
/// </summary>
public enum ViewItemType {
    View,
    Schedule,
    Sheet
}

/// <summary>
///     Unified wrapper for View, ViewSchedule, and ViewSheet that implements IPaletteListItem.
///     Uses a single View property since ViewSchedule and ViewSheet inherit from View.
/// </summary>
public class UnifiedViewItem : IPaletteListItem {
    private readonly SheetLookupCache _sheetCache;

    public UnifiedViewItem(View view, ViewItemType itemType, SheetLookupCache sheetCache) {
        this.View = view;
        this.ItemType = itemType;
        this._sheetCache = sheetCache;
    }

    /// <summary>
    ///     The underlying Revit View (always set).
    ///     For schedules and sheets, cast to ViewSchedule/ViewSheet as needed.
    /// </summary>
    public View View { get; }

    /// <summary>
    ///     The type of view this item represents.
    /// </summary>
    public ViewItemType ItemType { get; }

    /// <summary>
    ///     Convenience accessor for schedules. Returns null if ItemType is not Schedule.
    /// </summary>
    public ViewSchedule? AsSchedule => this.View as ViewSchedule;

    /// <summary>
    ///     Convenience accessor for sheets. Returns null if ItemType is not Sheet.
    /// </summary>
    public ViewSheet? AsSheet => this.View as ViewSheet;

    public string TextPrimary => this.ItemType switch {
        ViewItemType.Sheet => $"{this.AsSheet?.SheetNumber} - {this.View.Name}",
        _ => this.View.Name
    };

    public string TextSecondary => this.ItemType switch {
        ViewItemType.View => this.GetViewSheetInfo(),
        ViewItemType.Schedule => this.GetScheduleSheetInfo(),
        ViewItemType.Sheet => this.GetSheetViewCount(),
        _ => string.Empty
    };

    public string TextPill => this.ItemType switch {
        ViewItemType.View => this.View.FindParameter("View Use")?.AsString() ?? string.Empty,
        ViewItemType.Schedule => this.View.FindParameter("Discipline")?.AsValueString() ?? string.Empty,
        ViewItemType.Sheet => this.GetSheetPrefix(),
        _ => string.Empty
    };

    // Tooltip not used - sidebar preview panel displays detailed info
    public Func<string> GetTextInfo => null;

    public BitmapImage? Icon => null;
    public Color? ItemColor => null;

    private string GetViewSheetInfo() {
        var sheetInfo = this._sheetCache?.GetSheetInfo(this.View.Id);
        return sheetInfo == null ? "Not Sheeted" : $"Sheeted on: {sheetInfo.SheetNumber} - {sheetInfo.SheetName}";
    }

    private string GetScheduleSheetInfo() {
        var schedule = this.AsSchedule;
        if (schedule == null) return string.Empty;

        var instances = schedule.GetScheduleInstances(-1);
        if (instances.Count == 0) return string.Empty;

        var sheetNumbers = new List<string>();
        var doc = schedule.Document;
        foreach (var instId in instances) {
            var inst = doc.GetElement(instId);
            if (inst?.OwnerViewId == null) continue;
            var ownerView = doc.GetElement(inst.OwnerViewId) as ViewSheet;
            if (ownerView != null)
                sheetNumbers.Add(ownerView.SheetNumber);
        }

        return sheetNumbers.Count > 0
            ? $"Sheeted on ({sheetNumbers.Count}): {string.Join(", ", sheetNumbers)}"
            : string.Empty;
    }

    private string GetSheetViewCount() {
        var sheet = this.AsSheet;
        if (sheet == null) return string.Empty;

        var viewCount = sheet.GetAllPlacedViews().Count;
        return viewCount > 0 ? $"{viewCount} views" : string.Empty;
    }

    private string GetSheetPrefix() {
        var sheet = this.AsSheet;
        if (sheet == null) return string.Empty;

        var sheetNum = sheet.SheetNumber;
        if (string.IsNullOrEmpty(sheetNum) || sheetNum == "-") return string.Empty;

        var firstDigitIndex = sheetNum.TakeWhile(c => !char.IsDigit(c)).Count();
        return firstDigitIndex == 0 ? string.Empty : sheetNum[..firstDigitIndex];
    }
}