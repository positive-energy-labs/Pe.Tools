using Autodesk.Revit.DB.Mechanical;
using Pe.Shared.RevitData.Ducts;
using DuctShape = Pe.Shared.RevitData.Ducts.DuctShape;

namespace Pe.Revit.Global.Lib.Mep;

/// <summary>Bounded exact-element physical HVAC port read, independent of duct network analysis.</summary>
public static class DuctPorts {
    public static DuctPortsData Read(Document document, IReadOnlyList<long> elementIds) {
        var ids = new DuctPortsRequest(elementIds).UniqueElementIds();
        var rows = new List<DuctPortElement>(ids.Count);
        foreach (var id in ids) {
            var element = document.GetElement(new ElementId(id))
                ?? throw new ArgumentException($"Element {id} does not exist in this document.");
            if (element is not MEPCurve && element is not FamilyInstance)
                throw new ArgumentException($"Element {id} is {element.GetType().Name}, not an MEPCurve or FamilyInstance.");
            DuctPhysicalPort[] ports;
            try { ports = DuctSnapshots.Hvac(element).Select(port => ReadPort(id, port)).ToArray(); }
            catch (Exception ex) {
                throw new InvalidOperationException($"Element {id}: cannot inspect physical HVAC ports: {ex.Message}", ex);
            }
            rows.Add(new DuctPortElement(id, ports));
        }
        return new DuctPortsData(document.Title, DateTimeOffset.UtcNow, rows);
    }

    private static DuctPhysicalPort ReadPort(long ownerId, Connector port) {
        T Require<T>(string field, Func<T> read) {
            try { return read(); }
            catch (Exception ex) {
                throw new InvalidOperationException($"Element {ownerId} connector {port.Id}: cannot read {field}: {ex.Message}", ex);
            }
        }

        var origin = Require("Origin", () => port.Origin);
        var frame = Require("CoordinateSystem", () => port.CoordinateSystem);
        var basisX = frame.BasisX;
        var basisY = frame.BasisY;
        var basisZ = frame.BasisZ;
        if (!Finite(origin) || !Finite(basisX) || !Finite(basisY) || !Finite(basisZ))
            throw new InvalidOperationException($"Element {ownerId} connector {port.Id}: Origin or connector frame is not finite.");
        var shape = Require("Shape", () => port.Shape) switch {
            ConnectorProfileType.Round => DuctShape.Round,
            ConnectorProfileType.Rectangular => DuctShape.Rectangular,
            ConnectorProfileType.Oval => DuctShape.Oval,
            _ => DuctShape.Other
        };
        var diameter = shape == DuctShape.Round ? Require("Radius", () => port.Radius * 24) : (double?)null;
        var width = shape is DuctShape.Rectangular or DuctShape.Oval
            ? Require("Width", () => port.Width * 12) : (double?)null;
        var height = shape is DuctShape.Rectangular or DuctShape.Oval
            ? Require("Height", () => port.Height * 12) : (double?)null;
        if (new[] { diameter, width, height }.Any(value => value is { } size && (!IsFinite(size) || size <= 0)))
            throw new InvalidOperationException($"Element {ownerId} connector {port.Id}: shape dimension is not finite and positive.");
        var connected = Require("IsConnected", () => port.IsConnected);
        var peers = Require("AllRefs", () => port.AllRefs.Cast<Connector>()
            .Where(other => other.Domain == Domain.DomainHvac &&
                (other.ConnectorType is ConnectorType.End or ConnectorType.Curve) && other.Owner.Id != port.Owner.Id)
            .Select(other => new DuctRef(other.Owner.Id.Value, other.Id))
            .Distinct().OrderBy(peer => peer.ElementId).ThenBy(peer => peer.Connector).ToArray());
        return new DuctPhysicalPort(port.Id, port.ConnectorType == ConnectorType.Curve ? "curve" : "end",
            [origin.X, origin.Y, origin.Z], [basisX.X, basisX.Y, basisX.Z],
            [basisY.X, basisY.Y, basisY.Z], [basisZ.X, basisZ.Y, basisZ.Z], shape,
            diameter, width, height, connected, peers);
    }

    private static bool Finite(XYZ point) =>
        IsFinite(point.X) && IsFinite(point.Y) && IsFinite(point.Z);

    private static bool IsFinite(double value) => !double.IsNaN(value) && !double.IsInfinity(value);
}
