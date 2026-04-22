using Autodesk.Revit.DB.Electrical;
using Pe.Revit.Global.Revit.Lib.Electrical;
using Pe.Shared.RevitData;

namespace Pe.Revit.Global.Revit.Lib.Selection;

public static class ElementContextCollector {
    public static ElementContextQueryData Collect(
        Document doc,
        ElementContextQuery? query = null
    ) {
        var issues = new List<RevitDataIssue>();
        var requestedParameterNames = ElectricalCollectorSupport.NormalizeRequestedParameterNames(
            query?.ParameterQuery,
            issues,
            "ElementContext"
        );
        var resolution = ResolveQuery(doc, query, issues);
        var panelScheduleCounts = new FilteredElementCollector(doc)
            .OfClass(typeof(PanelScheduleView))
            .Cast<PanelScheduleView>()
            .GroupBy(schedule => schedule.GetPanel().Value())
            .ToDictionary(group => group.Key, group => group.Count());

        var entries = resolution.Elements
            .Select(element => TryCollectEntry(doc, element, panelScheduleCounts, requestedParameterNames, issues))
            .Where(entry => entry != null)
            .Cast<ElementContextEntry>()
            .ToList();

        return new ElementContextQueryData(
            doc.Title,
            doc.IsFamilyDocument,
            resolution.QueryKind,
            resolution.RequestedElementCount,
            entries.Count,
            entries,
            issues
        );
    }

    private static QueryResolution ResolveQuery(
        Document doc,
        ElementContextQuery? query,
        List<RevitDataIssue> issues
    ) {
        var effectiveQuery = query ?? new ElementContextQuery();
        return effectiveQuery.Kind switch {
            ElementContextQueryKind.ElementReferences => ResolveElementReferences(doc, effectiveQuery, issues),
            _ => ResolveCurrentSelection(doc)
        };
    }

    private static QueryResolution ResolveCurrentSelection(Document doc) {
        var selectionIds =
            RevitUiSession.CurrentUIApplication.GetActiveUIDocument()?.Selection.GetElementIds().ToList() ?? [];
        var elements = selectionIds
            .Select(doc.GetElement)
            .Where(element => element != null)
            .ToList();

        return new QueryResolution(
            ElementContextQueryKind.CurrentSelection,
            selectionIds.Count,
            elements
        );
    }

    private static QueryResolution ResolveElementReferences(
        Document doc,
        ElementContextQuery query,
        List<RevitDataIssue> issues
    ) {
        var elements = new List<Element>();
        var seenElementIds = new HashSet<long>();
        var elementIds = (query.ElementIds ?? [])
            .Distinct()
            .ToList();
        var uniqueIds = (query.ElementUniqueIds ?? [])
            .Where(value => !string.IsNullOrWhiteSpace(value))
            .Select(value => value.Trim())
            .Distinct(StringComparer.Ordinal)
            .ToList();

        foreach (var elementId in elementIds) {
            var element = doc.GetElement(elementId.ToElementId());
            if (element == null) {
                issues.Add(new RevitDataIssue(
                    "ElementContextElementIdNotFound",
                    RevitDataIssueSeverity.Warning,
                    $"Could not resolve element id {elementId}.",
                    TypeName: nameof(ElementId)
                ));
                continue;
            }

            if (seenElementIds.Add(element.Id.Value()))
                elements.Add(element);
        }

        foreach (var uniqueId in uniqueIds) {
            var element = doc.GetElement(uniqueId);
            if (element == null) {
                issues.Add(new RevitDataIssue(
                    "ElementContextUniqueIdNotFound",
                    RevitDataIssueSeverity.Warning,
                    $"Could not resolve element unique id '{uniqueId}'.",
                    TypeName: nameof(Element)
                ));
                continue;
            }

            if (seenElementIds.Add(element.Id.Value()))
                elements.Add(element);
        }

        return new QueryResolution(
            ElementContextQueryKind.ElementReferences,
            elementIds.Count + uniqueIds.Count,
            elements
        );
    }

    private static ElementContextEntry? TryCollectEntry(
        Document doc,
        Element element,
        IReadOnlyDictionary<long, int> panelScheduleCounts,
        IReadOnlyList<string> requestedParameterNames,
        List<RevitDataIssue> issues
    ) {
        try {
            var family = element as FamilyInstance;
            var identity = ElectricalCollectorSupport.CollectElementIdentity(element, requestedParameterNames);
            var panelScheduleCount = panelScheduleCounts.TryGetValue(element.Id.Value(), out var count) ? count : 0;
            var panel = TryCollectPanelContext(family, panelScheduleCount);
            var circuit = TryCollectCircuitContext(element);
            var wire = TryCollectWireContext(doc, element);
            var panelSchedule = TryCollectPanelScheduleContext(doc, element);
            var loadClassification = TryCollectLoadClassificationContext(doc, element);
            var connectors = TryCollectConnectorSummary(family);
            var electrical = TryCollectElectricalContext(doc, element, family, panelScheduleCount);

            return new ElementContextEntry(
                element.Id.Value(),
                element.UniqueId,
                element.GetType().Name,
                element.Category?.Name,
                element.Name,
                family?.Symbol?.Family?.Name,
                family?.Symbol?.Name,
                ElectricalCollectorSupport.ReadMark(element),
                identity.EffectiveIdentity,
                identity.EffectiveIdentitySource,
                identity.RequestedParameters,
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
                "ElementContextCollectFailed",
                RevitDataIssueSeverity.Warning,
                ex.Message,
                TypeName: element.GetType().Name
            ));
            return null;
        }
    }

    private static ElementContextConnectorSummary? TryCollectConnectorSummary(FamilyInstance? family) {
        var connectors = family?.MEPModel?.ConnectorManager?.Connectors.Cast<Connector>().ToList();
        return connectors == null
            ? null
            : new ElementContextConnectorSummary(
                connectors.Count,
                connectors.Count(connector => connector.Domain == Domain.DomainElectrical)
            );
    }

    private static ElementContextElectricalData? TryCollectElectricalContext(
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
            ? doc.GetElement(primarySystem!.SystemId.ToElementId()) is ElectricalSystem circuit &&
              circuit.BaseEquipment != null
                ? ToElementRef(circuit.BaseEquipment, circuit.BaseEquipment)
                : null
            : null;

        if (role == ElectricalInsightRole.Element && systems.Count == 0)
            return null;

        return new ElementContextElectricalData(role, systems, primarySystem, baseEquipment);
    }

    private static IEnumerable<ElementContextSystemRef> GetSystems(
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

    private static ElementContextCircuitData? TryCollectCircuitContext(Element element) {
        if (element is not ElectricalSystem circuit)
            return null;

        var connectedElements = circuit.Elements
            .Cast<Element>()
            .Select(connected => ToElementRef(connected as FamilyInstance, connected))
            .OrderBy(entry => entry.Name, StringComparer.OrdinalIgnoreCase)
            .ThenBy(entry => entry.ElementId)
            .ToList();

        return new ElementContextCircuitData(
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

    private static ElementContextPanelData? TryCollectPanelContext(FamilyInstance? family, int panelScheduleCount) {
        if (family?.MEPModel is not ElectricalEquipment equipment)
            return null;

        var assignedCircuits = ElectricalCollectorSupport.GetAssignedCircuits(equipment).Count;
        if (ElectricalCollectorSupport.DeterminePanelRole(equipment, assignedCircuits, panelScheduleCount) !=
            ElectricalInsightRole.Panel)
            return null;

        return new ElementContextPanelData(
            family.Id.Value(),
            family.UniqueId,
            ElectricalCollectorSupport.GetPanelName(family) ?? family.Name,
            family.Symbol?.Family?.Name,
            family.Symbol?.Name,
            ElectricalCollectorSupport.GetDistributionSystemName(equipment),
            assignedCircuits
        );
    }

    private static ElementContextWireData? TryCollectWireContext(Document doc, Element element) {
        if (element is not Wire wire)
            return null;

        var systems = wire.GetMEPSystems()
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

        return new ElementContextWireData(
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

    private static ElementContextPanelScheduleData? TryCollectPanelScheduleContext(Document doc, Element element) {
        if (element is not PanelScheduleView schedule)
            return null;

        var panel = doc.GetElement(schedule.GetPanel()) as FamilyInstance;
        var template = doc.GetElement(schedule.GetTemplate()) as PanelScheduleTemplate;
        return new ElementContextPanelScheduleData(
            schedule.Id.Value(),
            schedule.UniqueId,
            schedule.Name,
            ElectricalCollectorSupport.GetPanelName(panel),
            template?.Name
        );
    }

    private static ElementContextLoadClassificationData? TryCollectLoadClassificationContext(Document doc,
        Element element) {
        if (element is not ElectricalLoadClassification classification)
            return null;

        var demandFactor = doc.GetElement(classification.DemandFactorId) as ElectricalDemandFactorDefinition;
        return new ElementContextLoadClassificationData(
            classification.Id.Value(),
            classification.UniqueId,
            classification.Name,
            classification.Abbreviation,
            demandFactor?.Name
        );
    }

    private static ElementContextSystemRef ToSystemRef(ElectricalSystem system) =>
        new(
            system.Id.Value(),
            system.UniqueId,
            nameof(ElectricalSystem),
            system.Name,
            system.CircuitNumber,
            system.PanelName,
            system.LoadName
        );

    private static ElementContextElementRef ToElementRef(FamilyInstance? family, Element element) =>
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

    private sealed record QueryResolution(
        ElementContextQueryKind QueryKind,
        int RequestedElementCount,
        List<Element> Elements
    );
}