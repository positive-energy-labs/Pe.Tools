using Autodesk.Revit.DB;
using Autodesk.Revit.DB.Electrical;
using Pe.Revit.Global.PolyFill;
using Pe.Revit.Global.Revit.Lib.Electrical;
using Pe.Revit.Global.Services.Document;
using Pe.Shared.HostContracts.RevitData;

namespace Pe.Revit.Global.Revit.Lib.Selection;

public static class SelectionContextCollector {
    public static SelectionContextData Collect(Document doc) {
        var issues = new List<RevitDataIssue>();
        var selectionIds = DocumentManager.uiapp.ActiveUIDocument?.Selection.GetElementIds().ToList() ?? [];
        var panelScheduleCounts = new FilteredElementCollector(doc)
            .OfClass(typeof(PanelScheduleView))
            .Cast<PanelScheduleView>()
            .GroupBy(schedule => schedule.GetPanel().Value())
            .ToDictionary(group => group.Key, group => group.Count());

        var entries = selectionIds
            .Select(id => doc.GetElement(id))
            .Where(element => element != null)
            .Select(element => TryCollectEntry(doc, element!, panelScheduleCounts, issues))
            .Where(entry => entry != null)
            .Cast<SelectionContextEntry>()
            .ToList();

        return new SelectionContextData(
            doc.Title,
            doc.IsFamilyDocument,
            selectionIds.Count,
            entries,
            issues
        );
    }

    private static SelectionContextEntry? TryCollectEntry(
        Document doc,
        Element element,
        IReadOnlyDictionary<long, int> panelScheduleCounts,
        List<RevitDataIssue> issues
    ) {
        try {
            var family = element as FamilyInstance;
            var panelScheduleCount = panelScheduleCounts.TryGetValue(element.Id.Value(), out var count) ? count : 0;
            var panel = TryCollectPanelContext(family, panelScheduleCount);
            var circuit = TryCollectCircuitContext(element);
            var wire = TryCollectWireContext(doc, element);
            var panelSchedule = TryCollectPanelScheduleContext(doc, element);
            var loadClassification = TryCollectLoadClassificationContext(doc, element);
            var connectors = TryCollectConnectorSummary(family);
            var electrical = TryCollectElectricalContext(doc, element, family, panelScheduleCount);

            return new SelectionContextEntry(
                element.Id.Value(),
                element.UniqueId,
                element.GetType().Name,
                element.Category?.Name,
                element.Name,
                family?.Symbol?.Family?.Name,
                family?.Symbol?.Name,
                ElectricalCollectorSupport.ReadMark(element),
                ElectricalCollectorSupport.ReadTagInstance(element),
                GetLevelName(doc, element),
                electrical,
                connectors,
                circuit,
                panel,
                wire,
                panelSchedule,
                loadClassification
            );
        } catch (Exception ex) {
            issues.Add(new RevitDataIssue(
                "SelectionContextCollectFailed",
                RevitDataIssueSeverity.Warning,
                ex.Message,
                TypeName: element.GetType().Name
            ));
            return null;
        }
    }

    private static SelectionConnectorSummary? TryCollectConnectorSummary(FamilyInstance? family) {
        var connectors = family?.MEPModel?.ConnectorManager?.Connectors.Cast<Connector>().ToList();
        return connectors == null
            ? null
            : new SelectionConnectorSummary(
                connectors.Count,
                connectors.Count(connector => connector.Domain == Domain.DomainElectrical)
            );
    }

    private static SelectionElectricalContext? TryCollectElectricalContext(
        Document doc,
        Element element,
        FamilyInstance? family,
        int panelScheduleCount
    ) {
        var role = ElectricalCollectorSupport.DetermineSelectionRole(element, panelScheduleCount);
        var systems = GetSystems(doc, element, family)
            .OrderBy(system => system.PanelName, StringComparer.OrdinalIgnoreCase)
            .ThenBy(system => system.CircuitNumber, StringComparer.OrdinalIgnoreCase)
            .ToList();
        var primarySystem = systems.Count == 1 ? systems[0] : null;
        var baseEquipment = systems.Count == 1
            ? doc.GetElement(new ElementId(primarySystem!.SystemId)) is ElectricalSystem circuit && circuit.BaseEquipment != null
                ? ToElementRef(circuit.BaseEquipment as FamilyInstance, circuit.BaseEquipment)
                : null
            : null;

        if (role == ElectricalInsightRole.Element && systems.Count == 0)
            return null;

        return new SelectionElectricalContext(role, systems, primarySystem, baseEquipment);
    }

    private static IEnumerable<SelectionSystemRef> GetSystems(
        Document doc,
        Element element,
        FamilyInstance? family
    ) {
        if (element is ElectricalSystem circuit) {
            yield return ToSystemRef(circuit);
            yield break;
        }

        if (element is Wire wire) {
            foreach (var system in wire.GetMEPSystems()
                         .Cast<ElementId>()
                         .Select(doc.GetElement)
                         .OfType<ElectricalSystem>()
                         .GroupBy(system => system.Id.Value())
                         .Select(group => group.First()))
                yield return ToSystemRef(system);

            yield break;
        }

        if (family == null)
            yield break;

        var systems = family.MEPModel is ElectricalEquipment equipment
            ? ElectricalCollectorSupport.GetAssignedCircuits(equipment)
            : ElectricalCollectorSupport.GetElectricalSystems(family);

        foreach (var system in systems
                     .GroupBy(system => system.Id.Value())
                     .Select(group => group.First()))
            yield return ToSystemRef(system);
    }

    private static SelectionCircuitContext? TryCollectCircuitContext(Element element) {
        if (element is not ElectricalSystem circuit)
            return null;

        var connectedElements = circuit.Elements
            .Cast<Element>()
            .Select(connected => ToElementRef(connected as FamilyInstance, connected))
            .OrderBy(entry => entry.Name, StringComparer.OrdinalIgnoreCase)
            .ThenBy(entry => entry.ElementId)
            .ToList();

        return new SelectionCircuitContext(
            circuit.Id.Value(),
            circuit.UniqueId,
            circuit.CircuitNumber,
            circuit.LoadName,
            circuit.PanelName,
            ElectricalCollectorSupport.ReadDisplay(circuit, "Voltage"),
            ElectricalCollectorSupport.ReadDisplay(circuit, "Apparent Power"),
            ElectricalCollectorSupport.ReadDisplay(circuit, "Apparent Current"),
            ElectricalCollectorSupport.ReadDisplay(circuit, "Rating"),
            ElectricalCollectorSupport.ReadDisplay(circuit, "Frame"),
            connectedElements
        );
    }

    private static SelectionPanelContext? TryCollectPanelContext(FamilyInstance? family, int panelScheduleCount) {
        if (family?.MEPModel is not ElectricalEquipment equipment)
            return null;

        var assignedCircuits = ElectricalCollectorSupport.GetAssignedCircuits(equipment).Count;
        if (ElectricalCollectorSupport.DeterminePanelRole(equipment, assignedCircuits, panelScheduleCount) != ElectricalInsightRole.Panel)
            return null;

        return new SelectionPanelContext(
            family.Id.Value(),
            family.UniqueId,
            family.Name,
            family.Symbol?.Family?.Name,
            family.Symbol?.Name,
            ElectricalCollectorSupport.GetDistributionSystemName(equipment),
            assignedCircuits
        );
    }

    private static SelectionWireContext? TryCollectWireContext(Document doc, Element element) {
        if (element is not Wire wire)
            return null;

        var systems = wire.GetMEPSystems()
            .Cast<ElementId>()
            .Select(id => doc.GetElement(id))
            .OfType<ElectricalSystem>()
            .Select(ToSystemRef)
            .OrderBy(system => system.PanelName, StringComparer.OrdinalIgnoreCase)
            .ThenBy(system => system.CircuitNumber, StringComparer.OrdinalIgnoreCase)
            .ToList();

        var owners = wire.ConnectorManager.Connectors
            .Cast<Connector>()
            .SelectMany(connector => connector.AllRefs.Cast<Connector>())
            .Select(connector => connector.Owner)
            .Where(owner => owner != null && owner.Id.Value() != wire.Id.Value())
            .GroupBy(owner => owner!.Id.Value())
            .Select(group => group.First()!)
            .Select(owner => ToElementRef(owner as FamilyInstance, owner))
            .OrderBy(entry => entry.Name, StringComparer.OrdinalIgnoreCase)
            .ThenBy(entry => entry.ElementId)
            .ToList();

        return new SelectionWireContext(
            wire.Id.Value(),
            wire.UniqueId,
            doc.GetElement(wire.GetTypeId())?.Name,
            wire.WiringType.ToString(),
            wire.HotConductorNum,
            wire.NeutralConductorNum,
            wire.GroundConductorNum,
            systems,
            owners
        );
    }

    private static SelectionPanelScheduleContext? TryCollectPanelScheduleContext(Document doc, Element element) {
        if (element is not PanelScheduleView schedule)
            return null;

        var panel = doc.GetElement(schedule.GetPanel()) as FamilyInstance;
        var template = doc.GetElement(schedule.GetTemplate()) as PanelScheduleTemplate;
        return new SelectionPanelScheduleContext(
            schedule.Id.Value(),
            schedule.UniqueId,
            schedule.Name,
            panel?.Name,
            template?.Name
        );
    }

    private static SelectionLoadClassificationContext? TryCollectLoadClassificationContext(Document doc, Element element) {
        if (element is not ElectricalLoadClassification classification)
            return null;

        var demandFactor = doc.GetElement(classification.DemandFactorId) as ElectricalDemandFactorDefinition;
        return new SelectionLoadClassificationContext(
            classification.Id.Value(),
            classification.UniqueId,
            classification.Name,
            classification.Abbreviation,
            demandFactor?.Name
        );
    }

    private static SelectionSystemRef ToSystemRef(ElectricalSystem system) =>
        new(
            system.Id.Value(),
            system.UniqueId,
            nameof(ElectricalSystem),
            system.Name,
            system.CircuitNumber,
            system.PanelName,
            system.LoadName
        );

    private static SelectionElementRef ToElementRef(FamilyInstance? family, Element element) =>
        new(
            element.Id.Value(),
            element.UniqueId,
            element.GetType().Name,
            element.Category?.Name,
            element.Name,
            family?.Symbol?.Family?.Name,
            family?.Symbol?.Name,
            ElectricalCollectorSupport.ReadMark(element)
        );

    private static string? GetLevelName(Document doc, Element element) {
        var levelId = element.LevelId;
        if (levelId == ElementId.InvalidElementId)
            return null;

        return doc.GetElement(levelId)?.Name;
    }
}
