using Autodesk.Revit.UI;
using Pe.App.Services;
using Pe.Revit.Extensions.UiApplication;
using Pe.Revit.Global.PolyFill;
using Pe.Revit.Global.Services.Document;
using OperationCanceledException = Autodesk.Revit.Exceptions.OperationCanceledException;

namespace Pe.App.Commands.Palette.FamilyPalette;

/// <summary>
///     Static class containing collection and action handler methods for Family palette.
///     Separated from FamilyPaletteBase to support lazy loading and cleaner organization.
/// </summary>
internal static class FamilyActions {
    /// <summary>
    ///     Collects all families in the document.
    /// </summary>
    internal static IEnumerable<UnifiedFamilyItem> CollectFamilies(
        Document doc,
        UIDocument uidoc,
        FamilyInstancesOptions options
    ) {
        var families = new FilteredElementCollector(doc)
            .OfClass(typeof(Family))
            .Cast<Family>()
            .Where(f => !string.IsNullOrWhiteSpace(f.Name));

        families = ApplyFamilyCategoryFilters(families, options);

        if (options.FilterByActiveView) {
            var familyIds = CollectFilteredInstances(doc, uidoc, options, null)
                .Select(i => i.Symbol.Family.Id)
                .ToHashSet();
            families = families.Where(f => familyIds.Contains(f.Id));
        }

        foreach (var family in families.OrderBy(f => f.Name))
            yield return new UnifiedFamilyItem(family);
    }

    /// <summary>
    ///     Collects all family types (symbols) in the document.
    /// </summary>
    internal static IEnumerable<UnifiedFamilyItem> CollectFamilyTypes(
        Document doc,
        UIDocument uidoc,
        FamilyInstancesOptions options
    ) {
        var symbols = new FilteredElementCollector(doc)
            .OfClass(typeof(FamilySymbol))
            .Cast<FamilySymbol>();

        symbols = ApplyFamilyTypeCategoryFilters(symbols, options);

        if (options.FilterByActiveView) {
            var symbolIds = CollectFilteredInstances(doc, uidoc, options, null)
                .Select(i => i.Symbol.Id)
                .ToHashSet();
            symbols = symbols.Where(s => symbolIds.Contains(s.Id));
        }

        foreach (var symbol in symbols.OrderBy(s => s.Family.Name).ThenBy(s => s.Name))
            yield return new UnifiedFamilyItem(symbol);
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
            yield return new UnifiedFamilyItem(instance);
    }

    /// <summary>
    ///     Collects family instances filtered by the provided options.
    /// </summary>
    internal static IEnumerable<UnifiedFamilyItem> CollectFamilyInstances(
        Document doc,
        UIDocument uidoc,
        FamilyInstancesOptions options
    ) {
        var instances = CollectFilteredInstances(doc, uidoc, options, options.SelectedCategory);

        foreach (var instance in instances.OrderBy(i => i.Symbol.Name).ThenBy(i => i.Id.Value()))
            yield return new UnifiedFamilyItem(instance);
    }

    /// <summary>
    ///     Collects all unique categories from family instances in the document.
    /// </summary>
    internal static IEnumerable<string> CollectFamilyCategories(
        Document doc,
        UIDocument uidoc,
        FamilyInstancesOptions options
    ) {
        IEnumerable<string?> categoryNames;

        if (options.FilterByActiveView) {
            categoryNames = CollectFilteredInstances(doc, uidoc, options, string.Empty)
                .Select(i => i.Category?.Name);
        } else {
            var families = new FilteredElementCollector(doc)
                .OfClass(typeof(Family))
                .Cast<Family>();

            families = ApplyFamilyVisibilityFilters(families, options.ShowAnnotationSymbols);
            categoryNames = families.Select(f => f.FamilyCategory?.Name);
        }

        return categoryNames
            .Where(name => !string.IsNullOrEmpty(name))
            .Distinct()
            .OrderBy(name => name)!;
    }

    private static IEnumerable<FamilyInstance> CollectFilteredInstances(
        Document doc,
        UIDocument uidoc,
        FamilyInstancesOptions options,
        string? selectedCategoryOverride
    ) {
        var instances = options.FilterByActiveView
            ? new FilteredElementCollector(doc, uidoc.ActiveView.Id)
                .OfClass(typeof(FamilyInstance))
                .Cast<FamilyInstance>()
            : new FilteredElementCollector(doc)
                .OfClass(typeof(FamilyInstance))
                .Cast<FamilyInstance>();

        var selectedCategory = selectedCategoryOverride ?? options.SelectedCategory;

        if (!options.ShowAnnotationSymbols) {
            instances = instances
                .Where(i => i.Category?.CategoryType != CategoryType.Annotation)
                .Where(i => i.Category?.Name != "Detail Items");
        }

        if (!string.IsNullOrEmpty(selectedCategory))
            instances = instances.Where(i => i.Category?.Name == selectedCategory);

        return instances;
    }

    private static IEnumerable<Family> ApplyFamilyCategoryFilters(
        IEnumerable<Family> families,
        FamilyInstancesOptions options
    ) {
        families = ApplyFamilyVisibilityFilters(families, options.ShowAnnotationSymbols);

        if (!string.IsNullOrEmpty(options.SelectedCategory))
            families = families.Where(f => f.FamilyCategory?.Name == options.SelectedCategory);

        return families;
    }

    private static IEnumerable<Family> ApplyFamilyVisibilityFilters(
        IEnumerable<Family> families,
        bool showAnnotationSymbols
    ) {
        if (showAnnotationSymbols) return families;

        return families
            .Where(f => f.FamilyCategory?.CategoryType != CategoryType.Annotation)
            .Where(f => f.FamilyCategory?.Name != "Detail Items");
    }

    private static IEnumerable<FamilySymbol> ApplyFamilyTypeCategoryFilters(
        IEnumerable<FamilySymbol> symbols,
        FamilyInstancesOptions options
    ) {
        if (!options.ShowAnnotationSymbols) {
            symbols = symbols
                .Where(s => s.Family?.FamilyCategory?.CategoryType != CategoryType.Annotation)
                .Where(s => s.Family?.FamilyCategory?.Name != "Detail Items");
        }

        if (!string.IsNullOrEmpty(options.SelectedCategory))
            symbols = symbols.Where(s => s.Family?.FamilyCategory?.Name == options.SelectedCategory);

        return symbols;
    }

    /// <summary>
    ///     Handles placing a family type in the active view.
    /// </summary>
    internal static void HandlePlace(Document doc, UIDocument uidoc, UnifiedFamilyItem item) {
        if (item?.FamilySymbol == null) return;
        try {
            var trans = new Transaction(doc, $"Place {item.FamilySymbol.Family.Name}");
            _ = trans.Start();
            if (!item.FamilySymbol.IsActive) item.FamilySymbol.Activate();
            _ = trans.Commit();
            uidoc.PromptForFamilyInstancePlacement(item.FamilySymbol);
        } catch (OperationCanceledException) {
            // User canceled placement - expected behavior
        }
    }

    /// <summary>
    ///     Zooms to and selects an element in the view.
    /// </summary>
    internal static void HandleZoomToFamilyInstance(UnifiedFamilyItem item) {
        var uidoc = DocumentManager.GetActiveUIDocument();
        if (item.FamilyInstance == null) return;
        var id = item.FamilyInstance.Id;
        if (id == null) return;
        uidoc.ShowElements(id);
        uidoc.Selection.SetElementIds([id]);
    }

    /// <summary>
    ///     Opens and activates a family for editing. For family types/instances, it attempts to open the family to that type
    /// </summary>
    internal static void HandleOpenEditFamily(UnifiedFamilyItem item) {
        if (item == null) return;
        if (item.ItemType == FamilyItemType.Family && item.Family != null) {
            DocumentManager.uiapp.OpenAndActivateFamily(item.Family);
        } else {
            var sym = item.GetFamilySymbol();
            if (sym != null) {
                OpenAndActivateFamilyType(sym);
                return;
            } else {
                var fam = item.GetFamily();
                if (fam == null) return;
                DocumentManager.uiapp.OpenAndActivateFamily(fam);
            }
        }
    }

    /// <summary>
    ///     Opens RevitLookup to snoop the selected item.
    /// </summary>
    internal static void HandleSnoop(Document doc, UnifiedFamilyItem item) {
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
        _ = RevitDbExplorerService.TrySnoopObject(doc, objectToSnoop, title);
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
    private static void OpenAndActivateFamilyType(FamilySymbol symbol) {
        DocumentManager.uiapp.OpenAndActivateFamily(symbol.Family);

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