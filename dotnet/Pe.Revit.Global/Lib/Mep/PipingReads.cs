using Autodesk.Revit.DB.Plumbing;
using Pe.Shared.RevitData.Piping;

namespace Pe.Revit.Global.Lib.Mep;

/// <summary>Document-owned, read-only piping facts. Bounds refuse rather than silently truncate a network.</summary>
public static class PipingReads {
    public static PipingSystemsData Systems(Document document, PipingSystemsRequest request) {
        Bound(request.MaxSystems, 1024, nameof(request.MaxSystems));
        Bound(request.MaxElements, 16384, nameof(request.MaxElements));
        var systems = new FilteredElementCollector(document).OfClass(typeof(PipingSystem)).Cast<PipingSystem>()
            .OrderBy(system => system.Id.Value()).Take(request.MaxSystems + 1).ToArray();
        RequireCount(systems.Length, request.MaxSystems, "piping systems");
        var selected = request.SystemUniqueId is null ? null : systems.SingleOrDefault(system => system.UniqueId == request.SystemUniqueId)
            ?? throw new ArgumentException("SystemUniqueId must identify a piping system in this document.");
        var members = selected is null ? [] : selected.PipingNetwork.Cast<Element>()
            .Where(element => element is Pipe || element.Category?.Id.Value() is (long)BuiltInCategory.OST_PipeFitting or (long)BuiltInCategory.OST_PipeAccessory)
            .DistinctBy(element => element.Id.Value()).OrderBy(element => element.Id.Value()).Take(request.MaxElements + 1).ToArray();
        RequireCount(members.Length, request.MaxElements, "system members");
        return new(systems.Select(system => new PipingSystemRow(system.UniqueId, system.Id.Value(), system.Name,
                Reference(() => document.GetElement(system.GetTypeId())), system.SystemType.ToString(),
                Read<double?>(() => system.GetFlow()), Read(() => {
                    var equipment = system.BaseEquipment;
                    if (equipment is null) return null;
                    // Direction is reported by Revit. Empty means no source connector reported Out, never a guessed root.
                    var ports = MepConnectors.Physical(equipment, Domain.DomainPiping)
                        .Where(port => port.MEPSystem?.Id == system.Id).Select(Port).ToArray();
                    return new PipingSource(Ref(equipment), ports.Where(port => port.Direction.Value == "Out").Select(port => port.ConnectorId).ToArray(), ports);
                }))).ToArray(), request.SystemUniqueId, members.Select(Member).ToArray());
    }

    public static PipeSizeCatalogData Sizes(Document document, PipeSizeCatalogRequest request) {
        Bound(request.MaxSegments, 1024, nameof(request.MaxSegments));
        Bound(request.MaxSizesPerSegment, 4096, nameof(request.MaxSizesPerSegment));
        var segments = new FilteredElementCollector(document).OfClass(typeof(PipeSegment)).Cast<PipeSegment>()
            .OrderBy(segment => segment.Id.Value()).Take(request.MaxSegments + 1).ToArray();
        RequireCount(segments.Length, request.MaxSegments, "pipe segments");
        return new(segments.Select(segment => {
            var sizes = segment.GetSizes().Take(request.MaxSizesPerSegment + 1).ToArray();
            RequireCount(sizes.Length, request.MaxSizesPerSegment, $"sizes of segment {segment.UniqueId}");
            return new PipeSegmentRow(segment.UniqueId, segment.Id.Value(), segment.Name,
                sizes.Select(size => new PipeSizeRow(size.NominalDiameter, size.InnerDiameter, size.OuterDiameter)).ToArray());
        }).ToArray());
    }

    private static PipingMember Member(Element element) => new(element.UniqueId, element.Id.Value(), element.Name,
        element is Pipe ? "pipe" : element.Category?.Id.Value() == (long)BuiltInCategory.OST_PipeFitting ? "fitting" : "accessory",
        Number(element, BuiltInParameter.RBS_PIPE_FLOW_PARAM), Number(element, BuiltInParameter.RBS_PIPE_DIAMETER_PARAM),
        Number(element, BuiltInParameter.RBS_PIPE_INNER_DIAM_PARAM), Number(element, BuiltInParameter.CURVE_ELEM_LENGTH),
        Reference(() => element.get_Parameter(BuiltInParameter.RBS_PIPE_SEGMENT_PARAM) is { HasValue: true } parameter
            ? element.Document.GetElement(parameter.AsElementId()) : null),
        Reference(() => element is Pipe ? element.Document.GetElement(element.GetTypeId()) : null),
        MepConnectors.Physical(element, Domain.DomainPiping).OrderBy(port => port.Id).Select(Port).ToArray());

    private static PipingPort Port(Connector port) => new(port.Id, Read(() => port.Direction.ToString()),
        MepConnectors.Peers(port, Domain.DomainPiping).Select(peer => new PipingPeer(peer.Owner.UniqueId, peer.Owner.Id.Value(), peer.Id))
            .Distinct().OrderBy(peer => peer.ElementId).ThenBy(peer => peer.ConnectorId).ToArray());

    private static PipingFact<double?> Number(Element element, BuiltInParameter id) => Read<double?>(() =>
        element.get_Parameter(id) is { HasValue: true, StorageType: StorageType.Double } parameter
            ? double.IsFinite(parameter.AsDouble()) ? parameter.AsDouble() : throw new InvalidOperationException($"{id} is not finite.") : null);
    private static PipingFact<PipingElementRef> Reference(Func<Element?> read) => Read(() => read() is { } element ? Ref(element) : null);
    private static PipingElementRef Ref(Element element) => new(element.UniqueId, element.Id.Value(), element.Name);
    private static PipingFact<T> Read<T>(Func<T?> read) {
        try {
            var value = read();
            return new(value is null ? PipingReadState.Absent : PipingReadState.Value, value);
        } catch (Exception ex) when (DuctSnapshots.IsRevitFailure(ex)) {
            return new(PipingReadState.Error, default, $"{ex.GetType().FullName}: {ex.Message}");
        }
    }
    private static void Bound(int value, int maximum, string name) {
        if (value < 1 || value > maximum) throw new ArgumentOutOfRangeException(name, $"Expected 1 to {maximum}.");
    }
    private static void RequireCount(int count, int maximum, string name) {
        if (count > maximum) throw new ArgumentException($"More than {maximum} {name}; increase the requested bound.");
    }
}
