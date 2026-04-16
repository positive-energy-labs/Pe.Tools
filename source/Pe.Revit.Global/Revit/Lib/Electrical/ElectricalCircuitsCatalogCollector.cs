using Autodesk.Revit.DB;
using Autodesk.Revit.DB.Electrical;
using Pe.Revit.Global.PolyFill;
using Pe.Shared.HostContracts.RevitData;

namespace Pe.Revit.Global.Revit.Lib.Electrical;

public static class ElectricalCircuitsCatalogCollector {
    private const double DefaultNearbyRadiusFeet = 8.0;
    private const int DefaultMaxNearbyCandidatesPerElement = 4;
    private const int DefaultMaxNearbyCandidatesPerCircuit = 8;

    public static ElectricalCircuitsCatalogData Collect(
        Document doc,
        ElectricalCircuitsCatalogRequest? request = null
    ) {
        var panelNames = ElectricalCollectorSupport.ToFilterSet(request?.Filter?.PanelNames);
        var circuitNumbers = ElectricalCollectorSupport.ToFilterSet(request?.Filter?.CircuitNumbers);
        var loadNames = ElectricalCollectorSupport.ToFilterSet(request?.Filter?.LoadNames);
        var issues = new List<RevitDataIssue>();
        var requestedParameterNames = ElectricalCollectorSupport.NormalizeRequestedParameterNames(
            request?.Options?.ParameterQuery,
            issues,
            "ElectricalCircuitsCatalog"
        );
        var wiresBySystemId = BuildWireMap(doc, issues);
        var nearbyCandidatePool = request?.Options?.IncludeNearbyProxyContext == true
            ? BuildNearbyProxyCandidatePool(doc, requestedParameterNames)
            : null;

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
            .Select(circuit => TryCollectEntry(
                circuit,
                wiresBySystemId,
                requestedParameterNames,
                request?.Options,
                nearbyCandidatePool,
                issues
            ))
            .Where(entry => entry != null)
            .Cast<ElectricalCircuitCatalogEntry>()
            .ToList();

        return new ElectricalCircuitsCatalogData(entries, issues);
    }

    private static ElectricalCircuitCatalogEntry? TryCollectEntry(
        ElectricalSystem circuit,
        IReadOnlyDictionary<long, List<ElectricalCircuitWireEntry>> wiresBySystemId,
        IReadOnlyList<string> requestedParameterNames,
        ElectricalCircuitsCatalogOptions? options,
        IReadOnlyList<NearbyProxyCandidate>? nearbyCandidatePool,
        List<RevitDataIssue> issues
    ) {
        try {
            var panel = circuit.BaseEquipment;
            var connectedElements = circuit.Elements
                .Cast<Element>()
                .Select(element => {
                    var identity = ElectricalCollectorSupport.CollectElementIdentity(element, requestedParameterNames);
                    return new ElectricalCircuitConnectedElementEntry(
                        element.Id.Value(),
                        element.UniqueId,
                        element.GetType().Name,
                        element.Category?.Name,
                        element.Name,
                        (element as FamilyInstance)?.Symbol?.Family?.Name,
                        (element as FamilyInstance)?.Symbol?.Name,
                        ElectricalCollectorSupport.ReadMark(element),
                        identity.EffectiveIdentity,
                        identity.EffectiveIdentitySource,
                        ElectricalCollectorSupport.DetermineCircuitConnectedElementRole(element),
                        ElectricalCollectorSupport.HasElectricalConnector(element as FamilyInstance),
                        ElectricalCollectorSupport.GetElectricalSystems(element as FamilyInstance).Count,
                        identity.RequestedParameters
                    );
                })
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
            var proxyLikeConnectedElementCount = connectedElements.Count(entry =>
                ElectricalCollectorSupport.IsProxyLikeRole(entry.Role)
            );
            var hasProxyLikeConnectedElements = proxyLikeConnectedElementCount > 0;
            ElectricalInsightRole? primaryConnectedRole =
                connectedRoles.Count == 1 ? connectedRoles[0] : null;
            var nearbyProxyCandidates = options?.IncludeNearbyProxyContext == true
                ? CollectNearbyProxyCandidates(
                    circuit,
                    connectedElements,
                    nearbyCandidatePool ?? [],
                    options
                )
                : null;

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
                hasProxyLikeConnectedElements,
                proxyLikeConnectedElementCount,
                hasProxyLikeConnectedElements,
                primaryConnectedRole,
                connectedRoles,
                connectedElements,
                wireEntries,
                nearbyProxyCandidates
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

    private static List<NearbyProxyCandidate> BuildNearbyProxyCandidatePool(
        Document doc,
        IReadOnlyList<string> requestedParameterNames
    ) =>
        new FilteredElementCollector(doc)
            .OfClass(typeof(FamilyInstance))
            .Cast<FamilyInstance>()
            .Select(family => {
                var role = ElectricalCollectorSupport.DetermineCircuitConnectedElementRole(family);
                var identity = ElectricalCollectorSupport.CollectElementIdentity(family, requestedParameterNames);
                var point = ElectricalCollectorSupport.TryGetElementPoint(family);
                return point == null
                    ? null
                    : new NearbyProxyCandidate(
                        family.Id.Value(),
                        family.UniqueId,
                        family.GetType().Name,
                        family.Category?.Name,
                        family.Name,
                        family.Symbol?.Family?.Name,
                        family.Symbol?.Name,
                        ElectricalCollectorSupport.ReadMark(family),
                        identity.EffectiveIdentity,
                        identity.EffectiveIdentitySource,
                        role,
                        point,
                        identity.RequestedParameters
                    );
            })
            .Where(candidate => candidate != null)
            .Cast<NearbyProxyCandidate>()
            .Where(candidate =>
                ElectricalCollectorSupport.IsNearbyProxyCandidateRole(candidate.Role) ||
                !string.IsNullOrWhiteSpace(candidate.EffectiveIdentity)
            )
            .ToList();

    private static List<ElectricalNearbyProxyCandidateEntry> CollectNearbyProxyCandidates(
        ElectricalSystem circuit,
        IReadOnlyList<ElectricalCircuitConnectedElementEntry> connectedElements,
        IReadOnlyList<NearbyProxyCandidate> nearbyCandidatePool,
        ElectricalCircuitsCatalogOptions options
    ) {
        var connectedElementIds = connectedElements
            .Select(entry => entry.ElementId)
            .ToHashSet();
        var connectedPoints = circuit.Elements
            .Cast<Element>()
            .Select(ElectricalCollectorSupport.TryGetElementPoint)
            .Where(point => point != null)
            .Cast<XYZ>()
            .ToList();
        if (connectedPoints.Count == 0)
            return [];

        var nearbyRadiusFeet = options.NearbyRadiusFeet > 0
            ? options.NearbyRadiusFeet
            : DefaultNearbyRadiusFeet;
        var maxNearbyCandidatesPerElement = options.MaxNearbyCandidatesPerElement > 0
            ? options.MaxNearbyCandidatesPerElement
            : DefaultMaxNearbyCandidatesPerElement;
        var maxNearbyCandidatesPerCircuit = options.MaxNearbyCandidatesPerCircuit > 0
            ? options.MaxNearbyCandidatesPerCircuit
            : DefaultMaxNearbyCandidatesPerCircuit;
        var loadNameTags = ExtractLoadNameTags(circuit.LoadName)
            .ToHashSet(StringComparer.OrdinalIgnoreCase);

        return connectedPoints
            .SelectMany(point => nearbyCandidatePool
                .Where(candidate => !connectedElementIds.Contains(candidate.ElementId))
                .Select(candidate => new CandidateDistance(candidate, candidate.Point.DistanceTo(point)))
                .Where(candidate => candidate.DistanceFeet <= nearbyRadiusFeet)
                .OrderBy(candidate => candidate.DistanceFeet)
                .Take(maxNearbyCandidatesPerElement))
            .GroupBy(candidate => candidate.Candidate.ElementId)
            .Select(group => group.OrderBy(candidate => candidate.DistanceFeet).First())
            .OrderBy(candidate => candidate.DistanceFeet)
            .Take(maxNearbyCandidatesPerCircuit)
            .Select(candidate => ToNearbyProxyCandidateEntry(candidate, loadNameTags))
            .ToList();
    }

    private static ElectricalNearbyProxyCandidateEntry ToNearbyProxyCandidateEntry(
        CandidateDistance candidateDistance,
        IReadOnlySet<string> loadNameTags
    ) {
        var candidate = candidateDistance.Candidate;
        var matchReason = DetermineMatchReason(candidate, loadNameTags);
        return new ElectricalNearbyProxyCandidateEntry(
            candidate.ElementId,
            candidate.ElementUniqueId,
            candidate.ClassName,
            candidate.CategoryName,
            candidate.Name,
            candidate.FamilyName,
            candidate.TypeName,
            candidate.Mark,
            candidate.EffectiveIdentity,
            candidate.EffectiveIdentitySource,
            candidate.Role,
            candidateDistance.DistanceFeet,
            matchReason,
            candidate.RequestedParameters
        );
    }

    private static ElectricalNearbyProxyCandidateMatchReason DetermineMatchReason(
        NearbyProxyCandidate candidate,
        IReadOnlySet<string> loadNameTags
    ) {
        if (!string.IsNullOrWhiteSpace(candidate.EffectiveIdentity) &&
            loadNameTags.Contains(candidate.EffectiveIdentity)) {
            return candidate.EffectiveIdentitySource switch {
                ElementIdentitySource.RequestedParameter => ElectricalNearbyProxyCandidateMatchReason.RequestedParameterIdentityMatch,
                ElementIdentitySource.Mark => ElectricalNearbyProxyCandidateMatchReason.MarkIdentityMatch,
                _ => ElectricalNearbyProxyCandidateMatchReason.NearbyIdentityCandidate
            };
        }

        return ElectricalNearbyProxyCandidateMatchReason.NearbyIdentityCandidate;
    }

    private static List<string> ExtractLoadNameTags(string? loadName) {
        if (string.IsNullOrWhiteSpace(loadName))
            return [];

        return System.Text.RegularExpressions.Regex.Matches(
                loadName.ToUpperInvariant(),
                @"\b[A-Z]{1,8}-\d+[A-Z]?\b"
            )
            .Cast<System.Text.RegularExpressions.Match>()
            .Select(match => match.Value)
            .Distinct(StringComparer.OrdinalIgnoreCase)
            .ToList();
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

    private sealed record NearbyProxyCandidate(
        long ElementId,
        string ElementUniqueId,
        string ClassName,
        string? CategoryName,
        string Name,
        string? FamilyName,
        string? TypeName,
        string? Mark,
        string? EffectiveIdentity,
        ElementIdentitySource EffectiveIdentitySource,
        ElectricalInsightRole Role,
        XYZ Point,
        List<RequestedElementParameterValue>? RequestedParameters
    );

    private sealed record CandidateDistance(
        NearbyProxyCandidate Candidate,
        double DistanceFeet
    );
}
