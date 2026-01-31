using Autodesk.Revit.UI;
using Pe.App.Services;
using Pe.Extensions.UiApplication;
using Pe.Global.PolyFill;
using Pe.Global.Services.Document;

namespace Pe.App.Commands.Palette.FamilyPalette;

/// <summary>
///     Static class containing collection and action handler methods for Family palette.
///     Separated from FamilyPaletteBase to support lazy loading and cleaner organization.
/// </summary>
internal static class FamilyActions {
    /// <summary>
    ///     Collects all families in the document.
    /// </summary>
    internal static IEnumerable<UnifiedFamilyItem> CollectFamilies(Document doc) {
        foreach (var family in new FilteredElementCollector(doc)
                     .OfClass(typeof(Family))
                     .Cast<Family>()
                     .Where(f => !string.IsNullOrWhiteSpace(f.Name))
                     .OrderBy(f => f.Name))
            yield return new UnifiedFamilyItem(family, doc);
    }

    /// <summary>
    ///     Collects all family types (symbols) in the document.
    /// </summary>
    internal static IEnumerable<UnifiedFamilyItem> CollectFamilyTypes(Document doc) {
        foreach (var symbol in new FilteredElementCollector(doc)
                     .OfClass(typeof(FamilySymbol))
                     .Cast<FamilySymbol>()
                     .OrderBy(s => s.Family.Name)
                     .ThenBy(s => s.Name))
            yield return new UnifiedFamilyItem(symbol, doc);
    }

    /// <summary>
    ///     Collects all family instances in the document.
    /// </summary>
    internal static IEnumerable<UnifiedFamilyItem> CollectFamilyInstances(Document doc) {
        foreach (var instance in new FilteredElementCollector(doc)
                     .OfClass(typeof(FamilyInstance))
                     .Cast<FamilyInstance>()
                     .OrderBy(i => i.Symbol.Name)
                     .ThenBy(i => i.Id.Value()))
            yield return new UnifiedFamilyItem(instance, doc);
    }

    /// <summary>
    ///     Handles placing a family type in the active view.
    /// </summary>
    internal static void HandlePlace(Document doc, UIDocument uidoc, UnifiedFamilyItem? item) {
        if (item?.FamilySymbol == null) return;
        try {
            var trans = new Transaction(doc, $"Place {item.FamilySymbol.Family.Name}");
            _ = trans.Start();
            if (!item.FamilySymbol.IsActive) item.FamilySymbol.Activate();
            _ = trans.Commit();
            uidoc.PromptForFamilyInstancePlacement(item.FamilySymbol);
        } catch (Autodesk.Revit.Exceptions.OperationCanceledException) {
            // User canceled placement - expected behavior
        }
    }

    /// <summary>
    ///     Opens and activates a family for editing.
    /// </summary>
    internal static void HandleOpenEditFamily(UIApplication uiapp, UnifiedFamilyItem? item) {
        if (item?.Family != null)
            uiapp.OpenAndActivateFamily(item.Family);
    }

    /// <summary>
    ///     Opens a family and activates the specific type.
    /// </summary>
    internal static void HandleOpenEditFamilyType(UIApplication uiapp, UnifiedFamilyItem? item) {
        if (item?.FamilySymbol != null)
            OpenAndActivateFamilyType(uiapp, item.FamilySymbol);
    }

    /// <summary>
    ///     Opens RevitLookup to snoop the selected item.
    /// </summary>
    internal static void HandleSnoop(UIApplication uiapp, Document doc, UnifiedFamilyItem? item) {
        if (item == null) return;
        object objectToSnoop = item.ItemType switch {
            FamilyItemType.Family => item.Family!,
            FamilyItemType.FamilyType => item.FamilySymbol!,
            FamilyItemType.FamilyInstance => item.FamilyInstance!,
            _ => throw new InvalidOperationException()
        };
        var title = item.ItemType switch {
            FamilyItemType.Family => $"Family: {item.Family!.Name}",
            FamilyItemType.FamilyType => $"Type: {item.FamilySymbol!.Family.Name}: {item.FamilySymbol.Name}",
            FamilyItemType.FamilyInstance => $"Instance: {item.FamilyInstance!.Symbol.Name} ({item.FamilyInstance.Id})",
            _ => string.Empty
        };
        _ = RevitDbExplorerService.TrySnoopObject(uiapp, doc, objectToSnoop, title);
    }

    /// <summary>
    ///     Checks if a family type can be placed in the active view.
    /// </summary>
    internal static bool CanPlaceInView(View activeView) =>
        !activeView.IsTemplate
            && activeView.ViewType != ViewType.Legend
            && activeView.ViewType != ViewType.DrawingSheet
            && activeView.ViewType != ViewType.DraftingView
            && activeView.ViewType != ViewType.SystemBrowser
            && activeView is not ViewSchedule;

    /// <summary>
    ///     Opens a family and activates a specific type within it.
    /// </summary>
    private static void OpenAndActivateFamilyType(UIApplication uiapp, FamilySymbol symbol) {
        uiapp.OpenAndActivateFamily(symbol.Family);

        var famDoc = DocumentManager.FindOpenFamilyDocument(symbol.Family);
        if (famDoc?.IsFamilyDocument != true) return;

        var familyManager = famDoc.FamilyManager;
        var targetType = familyManager.Types.Cast<FamilyType>().FirstOrDefault(t => t.Name == symbol.Name);
        if (targetType == null) return;

        using var tx = new Transaction(famDoc, $"Set {symbol.Name} Type");
        _ = tx.Start();
        familyManager.CurrentType = targetType;
        _ = tx.Commit();
    }
}
