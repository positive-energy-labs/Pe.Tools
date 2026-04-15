using Autodesk.Revit.DB;
using Autodesk.Revit.DB.Electrical;
using Pe.Revit.Global.PolyFill;
using Pe.Shared.HostContracts.RevitData;

namespace Pe.Revit.Global.Revit.Lib.Electrical;

public static class ElectricalLoadClassificationsCatalogCollector {
    public static ElectricalLoadClassificationsCatalogData Collect(
        Document doc,
        ElectricalLoadClassificationsCatalogRequest? request = null
    ) {
        var names = ElectricalCollectorSupport.ToFilterSet(request?.Filter?.Names);
        var abbreviations = ElectricalCollectorSupport.ToFilterSet(request?.Filter?.Abbreviations);
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
            return new ElectricalLoadClassificationCatalogEntry(
                classification.Id.Value(),
                classification.UniqueId,
                classification.Name,
                classification.Abbreviation,
                classification.Motor,
                classification.Other,
                classification.SpaceLoadClass.ToString(),
                demandFactor == null ? null : new ElectricalDemandFactorDefinitionEntry(
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
}
