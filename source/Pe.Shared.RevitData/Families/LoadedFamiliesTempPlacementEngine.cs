using Pe.RevitData.PolyFill;

using Autodesk.Revit.DB.Structure;

namespace Pe.RevitData.Families;

public static class LoadedFamiliesTempPlacementEngine {
    public static LoadedFamiliesMatrixEvaluationContext CreateEvaluationContext(
        Document doc,
        IReadOnlyCollection<long>? selectedFamilyIds = null
    ) {
        if (doc == null)
            throw new ArgumentNullException(nameof(doc));
        if (doc.IsFamilyDocument)
            throw new InvalidOperationException("Expected a project document.");

        var families = GetSelectedFamilies(doc, selectedFamilyIds);
        var familiesById = families.ToDictionary(family => family.Id.Value());
        var symbolsByFamilyId = families.ToDictionary(
            family => family.Id.Value(),
            GetAllSymbols
        );

        return new LoadedFamiliesMatrixEvaluationContext(doc, families, familiesById, symbolsByFamilyId);
    }

    public static void PlaceOneTempInstancePerPlaceableSymbol(LoadedFamiliesMatrixEvaluationContext context) {
        if (context == null)
            throw new ArgumentNullException(nameof(context));
        if (context.EvaluationTransaction?.HasStarted() != true)
            throw new InvalidOperationException("Evaluation transaction must be active before placing temp instances.");

        foreach (var family in context.Families) {
            if (!context.SymbolsByFamilyId.TryGetValue(family.Id.Value(), out var symbols))
                continue;

            foreach (var symbol in symbols) {
                context.PlacementAttempts++;
                if (!TryActivateSymbol(symbol, family, context))
                    continue;

                var tempInstanceResult = TryCreateTempInstance(context.ProjectDocument, symbol);
                if (tempInstanceResult.Instance == null) {
                    context.AddIssue(family.Id.Value(), new ProjectLoadedFamilyIssue(
                        "TempInstanceCreationFailed",
                        ProjectLoadedFamilyIssueSeverity.Warning,
                        tempInstanceResult.Message ?? $"Could not place temporary instance for symbol '{symbol.Name}'.",
                        family.Name,
                        symbol.Name,
                        null
                    ));
                    continue;
                }

                context.PlacementSuccesses++;
                context.RegisterPlacement(new TempPlacedSymbolRecord(
                    family.Id.Value(),
                    symbol.Id.Value(),
                    symbol.Name,
                    family.FamilyCategory?.Id ?? ElementId.InvalidElementId,
                    tempInstanceResult.Instance.Id,
                    tempInstanceResult.Instance,
                    true
                ));
            }
        }
    }

    private static bool TryActivateSymbol(
        FamilySymbol symbol,
        Family family,
        LoadedFamiliesMatrixEvaluationContext context
    ) {
        if (symbol.IsActive)
            return true;

        try {
            symbol.Activate();
            return true;
        } catch (Exception ex) {
            context.AddIssue(family.Id.Value(), new ProjectLoadedFamilyIssue(
                "TypeActivationFailed",
                ProjectLoadedFamilyIssueSeverity.Warning,
                ex.Message,
                family.Name,
                symbol.Name,
                null
            ));
            return false;
        }
    }

    private static TempInstanceResult TryCreateTempInstance(Document doc, FamilySymbol symbol) {
        try {
            return new TempInstanceResult(
                doc.Create.NewFamilyInstance(
                XYZ.Zero,
                symbol,
                StructuralType.NonStructural
                ),
                null
            );
        } catch (Exception ex) {
            return new TempInstanceResult(null, ex.Message);
        }
    }

    private static List<Family> GetSelectedFamilies(
        Document doc,
        IReadOnlyCollection<long>? selectedFamilyIds
    ) {
        var includeAllFamilyIds = selectedFamilyIds == null || selectedFamilyIds.Count == 0;
        return new FilteredElementCollector(doc)
            .OfClass(typeof(Family))
            .Cast<Family>()
            .Where(family => !family.IsInPlace)
            .Where(family => !string.IsNullOrWhiteSpace(family.Name))
            .Where(family => includeAllFamilyIds || selectedFamilyIds!.Contains(family.Id.Value()))
            .OrderBy(family => family.Name, StringComparer.OrdinalIgnoreCase)
            .ToList();
    }

    private static List<FamilySymbol> GetAllSymbols(Family family) {
        var symbolIds = family.GetFamilySymbolIds();
        if (symbolIds == null || symbolIds.Count == 0)
            return [];

        return symbolIds
            .Select(id => family.Document.GetElement(id) as FamilySymbol)
            .Where(symbol => symbol != null)
            .Cast<FamilySymbol>()
            .OrderBy(symbol => symbol.Name, StringComparer.Ordinal)
            .ToList();
    }

    private sealed record TempInstanceResult(
        FamilyInstance? Instance,
        string? Message
    );
}
