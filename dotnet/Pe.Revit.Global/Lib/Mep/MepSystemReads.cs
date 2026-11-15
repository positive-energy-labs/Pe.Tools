using Autodesk.Revit.DB.Mechanical;
using Autodesk.Revit.DB.Plumbing;
using Pe.Shared.RevitData.Mep;

namespace Pe.Revit.Global.Lib.Mep;

public sealed record MepReadRefusal(string Code, string Path, string Message);
public sealed record MepReadResult<T>(T? Value, MepReadRefusal? Refusal) where T : class {
    public static implicit operator MepReadResult<T>(T value) => new(value, null);
    public static implicit operator MepReadResult<T>(MepReadRefusal refusal) => new(null, refusal);
}

/// <summary>
///     Document-owned, read-only facts of any MEP system and of the segment size catalog. Domain is data: one
///     <see cref="Spec" /> row per domain, so a new domain is a new row, never a new read. Bounds refuse rather than
///     silently truncate. Duct systems read through the same rows and are UNPROVEN (the proof model is a piping system);
///     the duct snapshot reads (`ducts.snapshot.walk`) stay where they are.
/// </summary>
public static class MepSystemReads {
    /// <summary>A domain's connector domain and the Revit parameters its members carry; null means the domain has no such size.</summary>
    private sealed record Spec(string Name, Domain Connectors, BuiltInParameter Flow, BuiltInParameter? Diameter,
        BuiltInParameter? Inner, BuiltInParameter? Width, BuiltInParameter? Height, BuiltInParameter? Segment);

    private static readonly Spec Piping = new("piping", Domain.DomainPiping, BuiltInParameter.RBS_PIPE_FLOW_PARAM,
        BuiltInParameter.RBS_PIPE_DIAMETER_PARAM, BuiltInParameter.RBS_PIPE_INNER_DIAM_PARAM, null, null, BuiltInParameter.RBS_PIPE_SEGMENT_PARAM);
    private static readonly Spec Duct = new("duct", Domain.DomainHvac, BuiltInParameter.RBS_DUCT_FLOW_PARAM,
        BuiltInParameter.RBS_CURVE_DIAMETER_PARAM, null, BuiltInParameter.RBS_CURVE_WIDTH_PARAM, BuiltInParameter.RBS_CURVE_HEIGHT_PARAM, null);

    private static Spec SpecOf(MEPSystem system) => system is PipingSystem ? Piping : Duct;

    public static MepReadResult<MepSystemMembersData> Members(Document document, MepSystemMembersRequest request) {
        if ((Bound(request.MaxSystems, 1024, "maxSystems") ?? Bound(request.MaxElements, 16384, "maxElements")) is { } invalid)
            return invalid;
        if (request.Domain is not (null or "piping" or "duct"))
            return new MepReadRefusal("MepDomainInvalid", "$.domain", "Set domain to piping or duct, or omit it for both.");
        IEnumerable<MEPSystem> scope = request.SystemUniqueId is { } id
            ? document.GetElement(id) is MEPSystem system and (PipingSystem or MechanicalSystem) ? [system] : []
            : (request.Domain == "duct" ? Enumerable.Empty<MEPSystem>() : new FilteredElementCollector(document).OfClass(typeof(PipingSystem)).Cast<MEPSystem>())
                .Concat(request.Domain == "piping" ? [] : new FilteredElementCollector(document).OfClass(typeof(MechanicalSystem)).Cast<MEPSystem>());
        var systems = scope.Where(system => request.Domain is null || SpecOf(system).Name == request.Domain)
            .OrderBy(system => system.Id.Value()).Take(request.MaxSystems + 1).ToArray();
        if (RequireCount(systems.Length, request.MaxSystems, 1024, "maxSystems", "MEP systems", "Narrow domain to piping or duct, or pass systemUniqueId.") is { } overflow)
            return overflow;
        if (systems.Length == 0)
            return new MepReadRefusal("MepSystemsEmpty", "$.systemUniqueId", "No MEP systems match this scope. Choose a system in this document or change domain.");
        var selected = request.SystemUniqueId is null ? null : systems.Single();
        var members = selected is null ? [] : Network(selected).Where(element => KindOf(element) is not null)
            .GroupBy(element => element.Id.Value()).Select(group => group.First())
            .OrderBy(element => element.Id.Value()).Take(request.MaxElements + 1).ToArray();
        if (RequireCount(members.Length, request.MaxElements, 16384, "maxElements", "system members", "Choose a smaller system.") is { } memberOverflow)
            return memberOverflow;
        return new MepSystemMembersData(systems.Select(Row).ToArray(), request.SystemUniqueId,
            members.Select(element => Member(element, SpecOf(selected!))).ToArray());
    }

    /// <summary>Every segment of the document with its nominal, inner and outer sizes. Revit's segment elements are pipe segments.</summary>
    public static MepReadResult<MepSegmentSizesData> SegmentSizes(Document document, MepSegmentSizesRequest request) {
        if ((Bound(request.MaxSegments, 1024, "maxSegments") ?? Bound(request.MaxSizesPerSegment, 4096, "maxSizesPerSegment")) is { } invalid)
            return invalid;
        var segments = new FilteredElementCollector(document).OfClass(typeof(PipeSegment)).Cast<PipeSegment>()
            .OrderBy(segment => segment.Id.Value()).Take(request.MaxSegments + 1).ToArray();
        if (RequireCount(segments.Length, request.MaxSegments, 1024, "maxSegments", "segments", "Remove unused segments from the document.") is { } overflow)
            return overflow;
        var rows = new List<MepSegmentRow>();
        foreach (var segment in segments) {
            var sizes = segment.GetSizes().Take(request.MaxSizesPerSegment + 1).ToArray();
            if (RequireCount(sizes.Length, request.MaxSizesPerSegment, 4096, "maxSizesPerSegment", $"sizes of segment {segment.UniqueId}", "Reduce that segment's size catalog.") is { } sizeOverflow)
                return sizeOverflow;
            rows.Add(new MepSegmentRow(segment.UniqueId, segment.Id.Value(), segment.Name, Piping.Name, "pipe-segment",
                sizes.Select(size => new MepSizeRow(size.NominalDiameter, size.InnerDiameter, size.OuterDiameter)).ToArray()));
        }
        return new MepSegmentSizesData(rows);
    }

    private static IEnumerable<Element> Network(MEPSystem system) => system switch {
        PipingSystem piping => piping.PipingNetwork.Cast<Element>(),
        MechanicalSystem duct => duct.DuctNetwork.Cast<Element>(),
        _ => []
    };

    private static string? KindOf(Element element) => element is MEPCurve ? "curve" : element.Category?.Id.Value() switch {
        (long)BuiltInCategory.OST_PipeFitting or (long)BuiltInCategory.OST_DuctFitting => "fitting",
        (long)BuiltInCategory.OST_PipeAccessory or (long)BuiltInCategory.OST_DuctAccessory => "accessory",
        (long)BuiltInCategory.OST_DuctTerminal => "terminal",
        _ => null
    };

    private static MepSystemRow Row(MEPSystem system) {
        var spec = SpecOf(system);
        return new(system.UniqueId, system.Id.Value(), system.Name, spec.Name,
            Reference(() => system.Document.GetElement(system.GetTypeId())),
            system switch { PipingSystem p => p.SystemType.ToString(), MechanicalSystem m => m.SystemType.ToString(), _ => "unknown" },
            Read(() => system is PipingSystem piping ? piping.GetFlow() : Param(system, spec.Flow)),
            Read(() => {
                var equipment = system.BaseEquipment;
                if (equipment is null) return null;
                // Direction is whatever Revit reports. A base connector leaves the system's members (Revit's own rule),
                // so it is named by BaseEquipmentConnector; Out ids stay empty when Revit reports none, never a guessed root.
                var baseId = system.BaseEquipmentConnector?.Id;
                var ports = MepConnectors.Physical(equipment, spec.Connectors)
                    .Where(port => port.MEPSystem?.Id == system.Id || port.Id == baseId).OrderBy(port => port.Id).Select(port => Port(port, spec)).ToArray();
                return new MepSource(Ref(equipment), baseId, ports.Where(port => port.Direction.Value == "Out").Select(port => port.ConnectorId).ToArray(), ports);
            }));
    }

    private static MepMember Member(Element element, Spec spec) => new(element.UniqueId, element.Id.Value(), element.Name, KindOf(element)!,
        Number(element, spec.Flow), Number(element, spec.Diameter), Number(element, spec.Inner), Number(element, spec.Width),
        Number(element, spec.Height), Number(element, BuiltInParameter.CURVE_ELEM_LENGTH),
        Reference(() => spec.Segment is { } id && element.get_Parameter(id) is { HasValue: true } parameter
            ? element.Document.GetElement(parameter.AsElementId()) : null),
        Reference(() => element.Document.GetElement(element.GetTypeId())),
        MepConnectors.Physical(element, spec.Connectors).OrderBy(port => port.Id).Select(port => Port(port, spec)).ToArray());

    private static MepPort Port(Connector port, Spec spec) => new(port.Id, Read(() => port.Direction.ToString()),
        MepConnectors.Peers(port, spec.Connectors).Select(peer => new MepPeer(peer.Owner.UniqueId, peer.Owner.Id.Value(), peer.Id))
            .Distinct().OrderBy(peer => peer.ElementId).ThenBy(peer => peer.ConnectorId).ToArray());

    private static double? Param(Element element, BuiltInParameter id) =>
        element.get_Parameter(id) is { HasValue: true, StorageType: StorageType.Double } parameter
            ? !double.IsNaN(parameter.AsDouble()) && !double.IsInfinity(parameter.AsDouble())
                ? parameter.AsDouble() : throw new InvalidOperationException($"{id} is not finite.") : null;
    private static MepFact<double?> Number(Element element, BuiltInParameter? id) =>
        id is { } parameter ? Read(() => Param(element, parameter)) : new(MepReadState.Absent, null);
    private static MepFact<MepElementRef> Reference(Func<Element?> read) => Read(() => read() is { } element ? Ref(element) : null);
    private static MepElementRef Ref(Element element) => new(element.UniqueId, element.Id.Value(), element.Name);
    private static MepFact<T> Read<T>(Func<T?> read) {
        try {
            var value = read();
            return new(value is null ? MepReadState.Absent : MepReadState.Value, value);
        } catch (Exception ex) when (DuctSnapshots.IsRevitFailure(ex)) {
            return new(MepReadState.Error, default, $"{ex.GetType().FullName}: {ex.Message}");
        }
    }
    private static MepReadRefusal? Bound(int value, int maximum, string name) => value < 1 || value > maximum
        ? new("MepBoundInvalid", "$." + name, $"{name} must be from 1 to {maximum}; set {name} within that range.") : null;
    private static MepReadRefusal? RequireCount(int count, int bound, int maximum, string field, string name, string narrow) => count > bound
        ? new("MepBoundExceeded", "$." + field, $"More than {bound} {name} (requested {field}={bound}). {narrow} Or raise {field} up to {maximum}.") : null;
}
