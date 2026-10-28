using Autodesk.Revit.DB.Electrical;
using Autodesk.Revit.DB.Mechanical;
using Autodesk.Revit.DB.Plumbing;

namespace Pe.Revit.Space;

/// <summary>Operation-owned representation reader. Native wrappers never survive an element read.</summary>
internal sealed class Oriented(SceneBudget budget) {
    private readonly Dictionary<(string, string), LocalBox> _boxes = new();
    internal readonly Ingest.SymbolMeshes Meshes = new();
    private sealed record LocalBox(double[] Min, double[] Max);

    internal SceneOrientedBox? Family(Element element, Transform sourceToHost) {
        // IFC DirectShapes have identity symbol frames with already-positioned geometry. A symbol box
        // there would merely rotate the document AABB. Only a real family frame establishes orientation.
        if (element is not FamilyInstance family || family.HasModifiedGeometry()) return null;
        // Some MEP families expose only their cuffs at Medium. Use their full Fine symbol bounds.
        using var options = new Options { DetailLevel = ViewDetailLevel.Fine, ComputeReferences = false };
        budget.Geometry();
        using var geometry = family.get_Geometry(options);
        budget.AfterNative();
        if (geometry is null) return null;
        var objects = geometry.ToArray();
        try {
            if (objects.Length != 1 || objects[0] is not GeometryInstance instance) return null;
            using var placement = instance.Transform;
            using var total = family.GetTotalTransform();
            if (!placement.AlmostEqual(total)) return null;
            using var symbolId = instance.GetSymbolGeometryId();
            var key = (element.Document.GetDocumentKey(), symbolId.AsUniqueIdentifier());
            if (!this._boxes.TryGetValue(key, out var local)) {
                budget.Native();
                using var symbol = instance.GetSymbolGeometry();
                budget.AfterNative();
                // Nested families retain their actual geometry through the recursive mesh route.
                var nested = false;
                foreach (var child in symbol) using (child) nested |= child is GeometryInstance;
                if (nested) return null;
                using var bounds = symbol.GetBoundingBox();
                using var boxFrame = bounds.Transform;
                if (!boxFrame.IsIdentity) return null;
                local = new LocalBox(V(bounds.Min), V(bounds.Max));
                this._boxes.Add(key, local);
            }
            using var frame = sourceToHost.Multiply(total);
            var center = frame.OfPoint((P(local.Min) + P(local.Max)) * 0.5);
            var half = (P(local.Max) - P(local.Min)) * 0.5;
            var x = frame.BasisX; var y = frame.BasisY; var z = frame.BasisZ;
            if (!UnitFrame(x, y, z) || half.X <= 0 || half.Y <= 0 || half.Z <= 0) return null;
            // A reflected box is symmetric about its centre. Flip one axis to keep the wire frame right-handed.
            if (x.CrossProduct(y).DotProduct(z) < 0) z = -z;
            return new SceneOrientedBox(V(center), V(x), V(y), V(z), V(half));
        } finally { foreach (var item in objects) item.Dispose(); }
    }

    internal static SceneRun? Run(Element element, Transform transform) {
        if (element is not (Duct or Pipe or Conduit or CableTray or FlexDuct or FlexPipe) || element is not MEPCurve curve) return null;
        try {
            if (curve.Location is not LocationCurve location) return null;
            using var line = location.Curve;
            var localStart = line.GetEndPoint(0);
            var start = transform.OfPoint(localStart);
            var end = transform.OfPoint(line.GetEndPoint(1));
            using var manager = curve.ConnectorManager;
            using var connectors = manager.Connectors;
            var ends = connectors.Cast<Connector>().ToArray();
            try {
                var connector = ends.Where(c => c.ConnectorType == ConnectorType.End)
                    .OrderBy(c => c.Origin.DistanceTo(localStart)).FirstOrDefault();
                if (connector is null) return null;
                var shape = connector.Shape switch {
                    ConnectorProfileType.Round => SceneRunShape.Round,
                    ConnectorProfileType.Rectangular => SceneRunShape.Rectangular,
                    ConnectorProfileType.Oval => SceneRunShape.Oval,
                    _ => (SceneRunShape?)null
                };
                if (shape is null || line is not Line && shape != SceneRunShape.Round) return null;
                var insulation = element.get_Parameter(BuiltInParameter.RBS_REFERENCE_INSULATION_THICKNESS)?.AsDouble() ?? 0;
                if (!Finite(insulation) || insulation < 0) return null;
                double? width = shape == SceneRunShape.Round ? null : connector.Width + 2 * insulation;
                double? height = shape == SceneRunShape.Round ? null : connector.Height + 2 * insulation;
                double? diameter = shape == SceneRunShape.Round ? connector.Radius * 2 + 2 * insulation : null;
                if (new[] { width, height, diameter }.Any(n => n is { } v && (!Finite(v) || v <= 0))) return null;
                IReadOnlyList<IReadOnlyList<double>>? path = line is Line ? null
                    : line.Tessellate().Select(p => (IReadOnlyList<double>)V(transform.OfPoint(p))).ToArray();
                if (path is not null && (path.Count < 2 || path.Zip(path.Skip(1), (a, b) => P(a).DistanceTo(P(b))).Any(d => d < 1e-8))) return null;
                var tangent = path is null ? (end - start).Normalize() : (P(path[1]) - P(path[0])).Normalize();
                using var frame = connector.CoordinateSystem;
                var x = transform.OfVector(frame.BasisX);
                x = (x - tangent * x.DotProduct(tangent)).Normalize();
                if (!Finite(start.X, start.Y, start.Z, end.X, end.Y, end.Z, x.X, x.Y, x.Z)
                    || start.DistanceTo(end) <= 1e-9 || x.GetLength() < 0.99) return null;
                return new SceneRun(V(start), V(end), shape.Value, width, height, diameter, V(x), path);
            } finally { foreach (var connector in ends) connector.Dispose(); }
        } catch { return null; } // No inferred frame: unsupported runs use their native mesh.
    }

    internal static Aabb Bounds(SceneOrientedBox box) {
        var c = box.Center; var h = box.HalfSize;
        double E(int i) => Math.Abs(box.AxisX[i]) * h[0] + Math.Abs(box.AxisY[i]) * h[1] + Math.Abs(box.AxisZ[i]) * h[2];
        return new Aabb(c[0] - E(0), c[1] - E(1), c[2] - E(2), c[0] + E(0), c[1] + E(1), c[2] + E(2));
    }

    internal static Aabb Bounds(SceneRun run) {
        var points = run.Path ?? [run.Start, run.End];
        // Curved round sweeps fit inside a radius around each centreline point. Straight profiles use their exact frame.
        if (run.Path is not null) {
            var r = run.DiameterFt!.Value / 2;
            return new Aabb(points.Min(p => p[0]) - r, points.Min(p => p[1]) - r, points.Min(p => p[2]) - r,
                points.Max(p => p[0]) + r, points.Max(p => p[1]) + r, points.Max(p => p[2]) + r);
        }
        var a = P(run.Start); var b = P(run.End); var x = P(run.CrossSectionXAxis);
        var z = (b - a).Normalize(); var y = z.CrossProduct(x).Normalize();
        return Bounds(new SceneOrientedBox(V((a + b) * 0.5), V(x), V(y), V(z),
            [(run.DiameterFt ?? run.WidthFt)!.Value / 2, (run.DiameterFt ?? run.HeightFt)!.Value / 2, a.DistanceTo(b) / 2]));
    }

    private static bool UnitFrame(XYZ x, XYZ y, XYZ z) =>
        new[] { x, y, z }.All(v => Math.Abs(v.GetLength() - 1) < 1e-6)
        && Math.Abs(x.DotProduct(y)) < 1e-6 && Math.Abs(x.DotProduct(z)) < 1e-6 && Math.Abs(y.DotProduct(z)) < 1e-6;
    private static double[] V(XYZ v) => [v.X, v.Y, v.Z];
    private static XYZ P(IReadOnlyList<double> v) => new(v[0], v[1], v[2]);
    private static bool Finite(params double[] values) => values.All(v => !double.IsNaN(v) && !double.IsInfinity(v));
}
