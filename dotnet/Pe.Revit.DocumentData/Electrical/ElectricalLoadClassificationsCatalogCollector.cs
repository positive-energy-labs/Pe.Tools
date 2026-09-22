using Autodesk.Revit.DB.Electrical;
using Pe.Shared.RevitData;

namespace Pe.Revit.DocumentData.Electrical;

public static class ElectricalLoadClassificationsCatalogCollector {
    public static ElectricalLoadClassificationsCatalogData Collect(
        Document doc,
        ElectricalLoadClassificationFilter? filter = null
    ) {
        var names = ElectricalCollectorSupport.ToFilterSet(filter?.Names);
        var abbreviations = ElectricalCollectorSupport.ToFilterSet(filter?.Abbreviations);
        var issues = new List<RevitDataIssue>();

        var entries = new FilteredElementCollector(doc)
            .OfClass(typeof(ElectricalLoadClassification))
            .Cast<ElectricalLoadClassification>()
            .Where(classification => ElectricalCollectorSupport.MatchesLoadClassificationFilter(
                classification,
                names,
                abbreviations
            ))
            .OrderBy(classification => classification.Name, StringComparer.OrdinalIgnoreCase)
            .Select(classification => TryCollectEntry(doc, classification, issues))
            .Where(entry => entry != null)
            .Cast<ElectricalLoadClassificationCatalogEntry>()
            .ToList();

        return new ElectricalLoadClassificationsCatalogData(entries, issues);
    }

    private static ElectricalLoadClassificationCatalogEntry? TryCollectEntry(
        Document doc,
        ElectricalLoadClassification classification,
        List<RevitDataIssue> issues
    ) {
        try {
            var demandFactor = doc.GetElement(classification.DemandFactorId) as ElectricalDemandFactorDefinition;
            var other = TryGetOtherLoadFlag(classification);
            return new ElectricalLoadClassificationCatalogEntry(
                classification.Id.Value(),
                classification.UniqueId,
                classification.Name,
                classification.Abbreviation,
                classification.Motor,
                other,
                classification.SpaceLoadClass.ToString(),
                demandFactor == null
                    ? null
                    : new ElectricalDemandFactorDefinitionEntry(
                        demandFactor.Id.Value(),
                        demandFactor.UniqueId,
                        demandFactor.Name,
                        demandFactor.RuleType.ToString(),
                        demandFactor.IncludeAdditionalLoad,
                        ElectricalCollectorSupport.ReadDisplay(demandFactor, "Additional Load"),
                        demandFactor.GetValuesCount()
                    )
            );
        } catch (Exception ex) {
            issues.Add(ElectricalCollectorSupport.Warning(
                "ElectricalLoadClassificationCatalogFailed",
                ex.Message,
                classification.Name
            ));
            return null;
        }
    }

    private static bool TryGetOtherLoadFlag(ElectricalLoadClassification classification) {
        var property = typeof(ElectricalLoadClassification).GetProperty("Other");
        if (property?.PropertyType == typeof(bool) && property.GetValue(classification) is bool value)
            return value;

        return false;
    }
}
