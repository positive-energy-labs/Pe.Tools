using Autodesk.Revit.DB;
using Autodesk.Revit.DB.Electrical;
using Pe.Revit.Global.PolyFill;
using Pe.Shared.HostContracts.RevitData;

namespace Pe.Revit.Global.Revit.Lib.Electrical;

public static class ElectricalCircuitsCatalogCollector {
    public static ElectricalCircuitsCatalogData Collect(
        Document doc,
        ElectricalCircuitsCatalogRequest? request = null
    ) {
        var panelNames = ElectricalCollectorSupport.ToFilterSet(request?.Filter?.PanelNames);
        var circuitNumbers = ElectricalCollectorSupport.ToFilterSet(request?.Filter?.CircuitNumbers);
        var loadNames = ElectricalCollectorSupport.ToFilterSet(request?.Filter?.LoadNames);
        var issues = new List<RevitDataIssue>();
        var wiresBySystemId = BuildWireMap(doc, issues);

        var entries = new FilteredElementCollector(doc)
            .OfClass(typeof(ElectricalSystem))
            .Cast<ElectricalSystem>()
            .Where(circuit => ElectricalCollectorSupport.MatchesCircuitFilter(
                circuit,
                panelNames,
                circuitNumbers,
                loadNames
            ))
            .OrderBy(circuit => circuit.PanelName, StringComparer.OrdinalIgnoreCase)
            .ThenBy(circuit => circuit.CircuitNumber, StringComparer.OrdinalIgnoreCase)
            .Select(circuit => TryCollectEntry(circuit, wiresBySystemId, issues))
            .Where(entry => entry != null)
            .Cast<ElectricalCircuitCatalogEntry>()
            .ToList();

        return new ElectricalCircuitsCatalogData(entries, issues);
    }

    private static ElectricalCircuitCatalogEntry? TryCollectEntry(
        ElectricalSystem circuit,
        IReadOnlyDictionary<long, List<ElectricalCircuitWireEntry>> wiresBySystemId,
        List<RevitDataIssue> issues
    ) {
        try {
            var panel = circuit.BaseEquipment;
            var connectedElements = circuit.Elements
                .Cast<Element>()
                .Select(element => new ElectricalCircuitConnectedElementEntry(
                    element.Id.Value(),
                    element.UniqueId,
                    element.GetType().Name,
                    element.Category?.Name,
                    element.Name,
                    (element as FamilyInstance)?.Symbol?.Family?.Name,
                    (element as FamilyInstance)?.Symbol?.Name,
                    ElectricalCollectorSupport.ReadMark(element),
                    ElectricalCollectorSupport.ReadTagInstance(element),
                    ElectricalCollectorSupport.DetermineCircuitConnectedElementRole(element),
                    ElectricalCollectorSupport.HasElectricalConnector(element as FamilyInstance),
                    ElectricalCollectorSupport.GetElectricalSystems(element as FamilyInstance).Count
                ))
                .OrderBy(entry => entry.Name, StringComparer.OrdinalIgnoreCase)
                .ThenBy(entry => entry.ElementId)
                .ToList();

            var wireEntries = wiresBySystemId.TryGetValue(circuit.Id.Value(), out var wires)
                ? wires
                : [];
            var connectedRoles = connectedElements
                .Select(entry => entry.Role)
                .Distinct()
                .OrderBy(role => role.ToString(), StringComparer.Ordinal)
                .ToList();
            var primaryConnectedRole = connectedRoles.Count == 1 ? connectedRoles[0] : null;

            return new ElectricalCircuitCatalogEntry(
                circuit.Id.Value(),
                circuit.UniqueId,
                circuit.CircuitNumber,
                circuit.LoadName,
                panel?.Id.Value(),
                panel?.UniqueId,
                circuit.PanelName,
                ElectricalCollectorSupport.ReadDisplay(circuit, "Slot Index"),
                ElectricalCollectorSupport.ReadDisplay(circuit, "Ways"),
                circuit.PolesNumber,
                ElectricalCollectorSupport.ReadDisplay(circuit, "Voltage"),
                ElectricalCollectorSupport.ReadDisplay(circuit, "Apparent Power"),
                ElectricalCollectorSupport.ReadDisplay(circuit, "Apparent Current"),
                ElectricalCollectorSupport.ReadDisplay(circuit, "True Power"),
                ElectricalCollectorSupport.ReadDisplay(circuit, "True Current"),
                ElectricalCollectorSupport.ReadDisplay(circuit, "Rating"),
                ElectricalCollectorSupport.ReadDisplay(circuit, "Frame"),
                ElectricalCollectorSupport.ReadBool(circuit, "Rating Override"),
                ElectricalCollectorSupport.ReadDisplay(circuit, "Rating Override Value"),
                circuit.WireSizeString,
                circuit.WireType?.Name,
                circuit.IsEmpty,
                circuit.IsMultipleNetwork,
                circuit.HasCustomCircuitPath,
                circuit.HasPathOffset,
                primaryConnectedRole,
                connectedRoles,
                connectedElements,
                wireEntries
            );
        } catch (Exception ex) {
            issues.Add(ElectricalCollectorSupport.Warning(
                "ElectricalCircuitCatalogFailed",
                ex.Message,
                circuit.LoadName ?? circuit.CircuitNumber
            ));
            return null;
        }
    }

    private static IReadOnlyDictionary<long, List<ElectricalCircuitWireEntry>> BuildWireMap(
        Document doc,
        List<RevitDataIssue> issues
    ) =>
        new FilteredElementCollector(doc)
            .OfClass(typeof(Wire))
            .Cast<Wire>()
            .SelectMany(wire => TryCollectWireRefs(doc, wire, issues))
            .GroupBy(item => item.SystemId)
            .ToDictionary(
                group => group.Key,
                group => group.Select(item => item.Entry)
                    .OrderBy(entry => entry.WireId)
                    .ToList()
            );

    private static IEnumerable<(long SystemId, ElectricalCircuitWireEntry Entry)> TryCollectWireRefs(
        Document doc,
        Wire wire,
        List<RevitDataIssue> issues
    ) {
        ElectricalCircuitWireEntry entry;
        try {
            entry = new ElectricalCircuitWireEntry(
                wire.Id.Value(),
                wire.UniqueId,
                doc.GetElement(wire.GetTypeId())?.Name,
                wire.WiringType.ToString(),
                wire.HotConductorNum,
                wire.NeutralConductorNum,
                wire.GroundConductorNum
            );
        } catch (Exception ex) {
            issues.Add(ElectricalCollectorSupport.Warning(
                "ElectricalCircuitWireCollectFailed",
                ex.Message,
                wire.Name
            ));
            return [];
        }

        var systemIds = wire.GetMEPSystems()
            .Cast<ElementId>()
            .Select(id => id.Value())
            .Distinct()
            .ToList();

        return systemIds.Select(systemId => (systemId, entry));
    }
}
