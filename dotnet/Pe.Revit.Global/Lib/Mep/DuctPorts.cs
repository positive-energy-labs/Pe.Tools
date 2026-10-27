using Autodesk.Revit.DB.Mechanical;
using Pe.Shared.RevitData.Ducts;
using DuctShape = Pe.Shared.RevitData.Ducts.DuctShape;

namespace Pe.Revit.Global.Lib.Mep;

/// <summary>
///     The Revit half of `ducts.ports`: a bounded exact-element read of every physical HVAC port, independent of
///     <see cref="DuctSnapshots" />' network analysis. Read-only: opens no transaction.
/// </summary>
public static class DuctPorts {
    public static DuctPortsData Read(Document document, IReadOnlyList<long> elementIds) {
        var ids = new DuctPortsRequest(elementIds).UniqueElementIds();
        // Same FOOTGUN as DuctSnapshots: under network-based calculations Revit 2025's Connector.Flow getter can raise an
        // uncatchable AccessViolationException. A try/catch cannot guard it, so the read is withheld, never attempted.
#if REVIT2023
        const bool network = false;
#else
        var network = DuctSettings.GetDuctSettings(document).NetworkBasedCalculations;
#endif
        var rows = new List<DuctPortElement>(ids.Count);
        foreach (var id in ids) {
            var element = document.GetElement(id.ToElementId())
                ?? throw new ArgumentException($"Element {id} does not exist in this document.");
            if (element is not MEPCurve && element is not FamilyInstance)
                throw new ArgumentException($"Element {id} is {element.GetType().Name}, not an MEPCurve or FamilyInstance.");
            DuctPhysicalPort[] ports;
            try { ports = DuctSnapshots.HvacConnectors(element).Select(port => ReadPort(id, port, network)).ToArray(); }
            catch (Exception ex) when (DuctSnapshots.IsRevitFailure(ex)) {
                throw new InvalidOperationException($"Element {id}: cannot inspect physical HVAC ports: {ex.Message}", ex);
            }
            var level = Fact(() => element.LevelId is { } levelId && levelId != ElementId.InvalidElementId
                    ? new DuctElementLevel(DuctReadState.Value, levelId.Value(), document.GetElement(levelId)?.Name, null)
                    : new DuctElementLevel(DuctReadState.Absent, null, null, null),
                error => new DuctElementLevel(DuctReadState.Error, null, null, error));
            rows.Add(new DuctPortElement(id, level, ports));
        }
        return new DuctPortsData(document.Title, DateTimeOffset.UtcNow, network, rows);
    }

    private static DuctPhysicalPort ReadPort(long ownerId, Connector port, bool network) {
        T Require<T>(string field, Func<T> read) {
            try { return read(); }
            catch (Exception ex) when (DuctSnapshots.IsRevitFailure(ex)) {
                throw new InvalidOperationException($"Element {ownerId} connector {port.Id}: cannot read {field}: {ex.Message}", ex);
            }
        }

        var origin = Require("Origin", () => port.Origin);
        var frame = Require("CoordinateSystem", () => port.CoordinateSystem);
        var (basisX, basisY, basisZ) = (frame.BasisX, frame.BasisY, frame.BasisZ);
        if (!Finite(origin) || !Finite(basisX) || !Finite(basisY) || !Finite(basisZ))
            throw new InvalidOperationException($"Element {ownerId} connector {port.Id}: Origin or connector frame is not finite.");
        var shape = Require("Shape", () => port.Shape) switch {
            ConnectorProfileType.Round => DuctShape.Round,
            ConnectorProfileType.Rectangular => DuctShape.Rectangular,
            ConnectorProfileType.Oval => DuctShape.Oval,
            _ => DuctShape.Other
        };
        var diameter = shape == DuctShape.Round ? Require("Radius", () => port.Radius * 24) : (double?)null;
        var width = shape is DuctShape.Rectangular or DuctShape.Oval ? Require("Width", () => port.Width * 12) : (double?)null;
        var height = shape is DuctShape.Rectangular or DuctShape.Oval ? Require("Height", () => port.Height * 12) : (double?)null;
        if (new[] { diameter, width, height }.Any(value => value is { } size && (!IsFinite(size) || size <= 0)))
            throw new InvalidOperationException($"Element {ownerId} connector {port.Id}: shape dimension is not finite and positive.");
        var connected = Require("IsConnected", () => port.IsConnected);
        // Every physical peer, where DuctSnapshots keeps only the first.
        var peers = Require("AllRefs", () => port.AllRefs.Cast<Connector>()
            .Where(other => other.Domain == Domain.DomainHvac &&
                            other.ConnectorType is ConnectorType.End or ConnectorType.Curve && other.Owner.Id != port.Owner.Id)
            .Select(other => new DuctRef(other.Owner.Id.Value(), other.Id))
            .Distinct().OrderBy(peer => peer.ElementId).ThenBy(peer => peer.Connector).ToArray());
        return new DuctPhysicalPort(port.Id, port.ConnectorType == ConnectorType.Curve ? "curve" : "end",
            [origin.X, origin.Y, origin.Z], [basisX.X, basisX.Y, basisX.Z],
            [basisY.X, basisY.Y, basisY.Z], [basisZ.X, basisZ.Y, basisZ.Z], shape,
            diameter, width, height, connected, peers,
            Fact(() => port.MEPSystem is { } system
                    ? new DuctPortSystem(DuctReadState.Value, system.Id.Value(), system.Name,
                        system.GetTypeId() is { } typeId && typeId != ElementId.InvalidElementId ? typeId.Value() : null,
                        (system as MechanicalSystem)?.SystemType.ToString() ?? system.GetType().Name, null)
                    : new DuctPortSystem(DuctReadState.Absent, null, null, null, null, null),
                error => new DuctPortSystem(DuctReadState.Error, null, null, null, null, error)),
            Fact(() => new DuctPortDirection(DuctReadState.Value, port.Direction switch {
                    FlowDirectionType.In => "in",
                    FlowDirectionType.Out => "out",
                    FlowDirectionType.Bidirectional => "bidirectional",
                    var other => other.ToString()
                }, null),
                error => new DuctPortDirection(DuctReadState.Error, null, error)),
            network
                ? new DuctPortFlow(DuctReadState.Absent, null, "Withheld: Connector.Flow can crash Revit under network-based calculations.")
                : Fact(() => new DuctPortFlow(DuctReadState.Value, Cfm(port.Flow), null),
                    error => new DuctPortFlow(DuctReadState.Error, null, error)),
            Fact(() => new DuctPortFlow(DuctReadState.Value, Cfm(port.AssignedFlow), null),
                error => new DuctPortFlow(DuctReadState.Error, null, error)),
            Fact(() => FlowParameter(port), error => new DuctFlowParameter(DuctReadState.Error, null, null, null, null, null, null, null, error)));
    }

    /// <summary>Run one optional fact read; a Revit refusal becomes that fact's error instead of failing the row.</summary>
    private static T Fact<T>(Func<T> read, Func<string, T> failed) {
        try { return read(); }
        catch (Exception ex) when (DuctSnapshots.IsRevitFailure(ex)) { return failed($"{ex.GetType().FullName}: {ex.Message}"); }
    }

    // The family connector's RBS_DUCT_FLOW_PARAM association, matched by parameter id on the instance, then its type.
    // Native-observed only for a shared project parameter; family-to-project id identity is otherwise unproven.
    private static DuctFlowParameter FlowParameter(Connector port) {
        DuctFlowParameter Absent(string why) => new(DuctReadState.Absent, null, null, null, null, null, null, why, null);
        if (port.GetMEPConnectorInfo() is not MEPFamilyConnectorInfo info) return Absent("connector has no family connector info");
        var associated = info.GetAssociateFamilyParameterId(new ElementId(BuiltInParameter.RBS_DUCT_FLOW_PARAM));
        if (associated is null || associated == ElementId.InvalidElementId) return Absent("family associates no parameter with connector Flow");
        var own = Match(port.Owner, associated);
        var symbol = own.Count == 0 ? (port.Owner as FamilyInstance)?.Symbol : null;
        var matches = symbol is null ? own : Match(symbol, associated);
        var provenance = $"connector Flow association (RBS_DUCT_FLOW_PARAM) id {associated.Value()}, exact-id match on {(symbol is null ? "instance" : "type")} parameters; family-to-project id identity unproven beyond shared parameters";
        if (matches.Count != 1)
            return new(DuctReadState.Error, null, null, null, null, null, null, provenance,
                $"associated id {associated.Value()} matched {matches.Count} element parameters; refusing to guess");
        var parameter = matches[0];
        if (parameter.StorageType != StorageType.Double || parameter.Definition.GetDataType() != SpecTypeId.AirFlow)
            return new(DuctReadState.Error, null, parameter.Definition.Name, null, null, null, null, provenance,
                $"matched parameter is {parameter.StorageType} {parameter.Definition.GetDataType().TypeId}, not an airflow number");
        return new(DuctReadState.Value, associated.Value(), parameter.Definition.Name,
            parameter.IsShared ? parameter.GUID.ToString() : null, !parameter.IsReadOnly, parameter.HasValue,
            parameter.HasValue ? Cfm(parameter.AsDouble()) : null, provenance, null);
    }

    private static List<Parameter> Match(Element element, ElementId id) =>
        element.Parameters.Cast<Parameter>().Where(parameter => parameter.Id == id).ToList();

    private static double Cfm(double internalFlow) => UnitUtils.ConvertFromInternalUnits(internalFlow, UnitTypeId.CubicFeetPerMinute);

    private static bool Finite(XYZ point) => IsFinite(point.X) && IsFinite(point.Y) && IsFinite(point.Z);

    private static bool IsFinite(double value) => !double.IsNaN(value) && !double.IsInfinity(value);
}
