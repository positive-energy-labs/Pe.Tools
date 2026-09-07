using Pe.Shared.RevitData.Families;
using Pe.Revit.Extensions.FamDocument;

namespace Pe.Revit.FamilyFoundry.Operations;

/// <summary>
///     Name → Revit reference, for every declared plane name in a family.json: a Level datum, a template or
///     author `ReferencePlane`, or a reference line (`line:&lt;Name&gt;.start|end` is position only). No
///     reference resolves by assumption (F3): an unknown name throws with the name in the message.
/// </summary>
internal static class FamilyRefs {
    private const double PlaneExtent = 8.0;

    internal static IEnumerable<(Curve Curve, FamilyModelSketchCurve Spec)> SketchCurves(Document doc, Plane plane, FamilyModelLoop loop) {
        var lines = loop.Curves.Where(c => c.Kind == CurveKind.Line).ToList();
        for (var i = 0; i < lines.Count; i++) {
            var on = Resolve(doc, lines[i].On!).Plane;
            var start = Intersect(plane, Resolve(doc, lines[(i + lines.Count - 1) % lines.Count].On!).Plane, on);
            var end = Intersect(plane, on, Resolve(doc, lines[(i + 1) % lines.Count].On!).Plane);
            yield return (Line.CreateBound(start, end), lines[i]);
        }
        foreach (var circle in loop.Curves.Where(c => c.Kind == CurveKind.Circle)) {
            var center = Intersect(plane, Resolve(doc, circle.Center![0]).Plane, Resolve(doc, circle.Center[1]).Plane);
            var radius = Feet(doc, circle.Diameter!.Value) / 2;
            var normal = plane.Normal.Normalize();
            var x = (Math.Abs(normal.Z) > 0.9 ? XYZ.BasisX : XYZ.BasisZ).CrossProduct(normal).Normalize();
            yield return (Arc.Create(center, radius, 0, 2 * Math.PI, x, normal.CrossProduct(x)), circle);
        }
    }

    internal static void ConstrainSketchCurve(FamilyDocument doc, View view, CurveElement curve, FamilyModelSketchCurve spec) {
        if (spec.On is { } on) {
            Align(doc, view, curve.GeometryCurve.Reference, Resolve(doc, on).Reference);
            return;
        }
        var center = curve.CenterPointReference ?? throw new InvalidOperationException("Circle has no center reference.");
        foreach (var plane in spec.Center!) Align(doc, view, Resolve(doc, plane).Reference, center);
        if (curve.GeometryCurve is not Arc arc || arc.Reference is null) throw new InvalidOperationException("Circle has no arc reference.");
        var dimension = doc.Document.FamilyCreate.NewDiameterDimension(view, arc.Reference, arc.Center + arc.XDirection * arc.Radius * 0.5);
        if (spec.Diameter?.Parameter is { } label) doc.LabelDimensions([(dimension, Param(doc, label))]);
        else dimension.IsLocked = true;
    }

    internal static bool IsCircle(Arc arc) => !arc.IsBound || Math.Abs(arc.Length - 2 * Math.PI * arc.Radius) < 1e-4;

    internal static bool SameCircle(Arc a, Arc b) =>
        a.Center.IsAlmostEqualTo(b.Center, 1e-4) && Math.Abs(a.Radius - b.Radius) < 1e-4 &&
        Math.Abs(Math.Abs(a.Normal.DotProduct(b.Normal)) - 1) < 1e-4;

    internal static bool IsCompleteCircle(IEnumerable<Arc> source) {
        var arcs = source.ToList();
        if (arcs.Count == 0 || arcs.Any(arc => !SameCircle(arcs[0], arc))) return false;
        if (arcs.Count == 1) return IsCircle(arcs[0]);
        if (arcs.Any(arc => !arc.IsBound)) return false;

        var circle = arcs[0];
        var normal = circle.Normal.Normalize();
        var x = circle.XDirection.Normalize();
        var y = normal.CrossProduct(x).Normalize();
        var intervals = new List<(double Start, double End)>();
        var total = 0d;
        foreach (var arc in arcs) {
            double Angle(XYZ point) {
                var offset = (point - circle.Center).Normalize();
                var angle = Math.Atan2(offset.DotProduct(y), offset.DotProduct(x));
                return angle < 0 ? angle + 2 * Math.PI : angle;
            }
            static double Forward(double from, double to) => (to - from + 2 * Math.PI) % (2 * Math.PI);

            var start = Angle(arc.GetEndPoint(0));
            var end = Angle(arc.GetEndPoint(1));
            var midpoint = Angle(arc.Evaluate(0.5, true));
            var forward = Forward(start, end);
            if (Forward(start, midpoint) > forward + 1e-9) (start, forward) = (end, 2 * Math.PI - forward);
            total += forward;
            intervals.Add((start, Math.Min(start + forward, 2 * Math.PI)));
            if (start + forward > 2 * Math.PI) intervals.Add((0, start + forward - 2 * Math.PI));
        }

        var tolerance = 1e-4 / circle.Radius;
        if (Math.Abs(total - 2 * Math.PI) > tolerance) return false;
        var mergedEnd = 0d;
        foreach (var interval in intervals.OrderBy(interval => interval.Start)) {
            if (interval.Start > mergedEnd + tolerance) return false;
            mergedEnd = Math.Max(mergedEnd, interval.End);
        }
        return mergedEnd >= 2 * Math.PI - tolerance;
    }

    internal static bool SameCurve(Curve? a, Curve b) {
        if (a == null || a.GetType() != b.GetType()) return false;
        if (a is Arc arcA && b is Arc arcB && IsCircle(arcA) && IsCircle(arcB))
            return SameCircle(arcA, arcB);
        if (!a.IsBound || !b.IsBound) return false;
        var (a0, a1, b0, b1) = (a.GetEndPoint(0), a.GetEndPoint(1), b.GetEndPoint(0), b.GetEndPoint(1));
        return (a0.IsAlmostEqualTo(b0, 1e-4) && a1.IsAlmostEqualTo(b1, 1e-4)) || (a0.IsAlmostEqualTo(b1, 1e-4) && a1.IsAlmostEqualTo(b0, 1e-4));
    }

    internal static string DescribeCurve(Curve curve) => curve is Arc arc
        ? $"Arc(bound={arc.IsBound}, circle={IsCircle(arc)}, center={arc.Center}, radius={arc.Radius:R}, normal={arc.Normal})"
        : curve.IsBound
            ? $"{curve.GetType().Name}({curve.GetEndPoint(0)} -> {curve.GetEndPoint(1)})"
            : $"{curve.GetType().Name}(unbound)";

    public static ReferencePlane? FindPlane(Document doc, string name) =>
        new FilteredElementCollector(doc).OfClass(typeof(ReferencePlane)).Cast<ReferencePlane>()
            .FirstOrDefault(p => string.Equals(p.Name, name, StringComparison.Ordinal));

    public static Level? FindLevel(Document doc, string name) =>
        new FilteredElementCollector(doc).OfClass(typeof(Level)).Cast<Level>()
            .FirstOrDefault(l => string.Equals(l.Name, name, StringComparison.Ordinal));

    public static IEnumerable<ModelCurve> ReferenceLines(Document doc) =>
        new FilteredElementCollector(doc).OfClass(typeof(CurveElement)).Cast<CurveElement>()
            .OfType<ModelCurve>().Where(c => c.IsReferenceLine).OrderBy(c => c.Id.Value());

    public static ModelCurve? FindRefLine(Document doc, string name) =>
        name.StartsWith("line-", StringComparison.Ordinal) && int.TryParse(name[5..], out var index) && index > 0
            ? ReferenceLines(doc).ElementAtOrDefault(index - 1) : null;

    /// <summary>Datum level or reference plane by name; throws when absent.</summary>
    public static (Reference Reference, Plane Plane) Resolve(Document doc, string name) {
        if (FindPlane(doc, name) is { } rp) return (rp.GetReference(), rp.GetPlane());
        if (FindLevel(doc, name) is { } level)
            return (new Reference(level), Plane.CreateByNormalAndOrigin(XYZ.BasisZ, new XYZ(0, 0, level.Elevation)));
        throw new InvalidOperationException($"Plane '{name}' is not a level or reference plane in this family; declare it in datums or refPlanes.");
    }

    public static SketchPlane SketchPlaneFor(Document doc, string name) {
        if (FindPlane(doc, name) is { } rp) return SketchPlane.Create(doc, rp.Id);
        if (FindLevel(doc, name) is { } level) return SketchPlane.Create(doc, level.Id);
        if (name.StartsWith("line:", StringComparison.Ordinal))
            throw new InvalidOperationException($"'{name}': a form cannot be sketched on a reference line or its endpoint (form-sketch-plane-on-reference-line).");
        throw new InvalidOperationException($"Plane '{name}' is not a level or reference plane in this family.");
    }

    /// <summary>Intersection point of three planes; throws when two are parallel.</summary>
    public static XYZ Intersect(Plane a, Plane b, Plane c) {
        var (n1, n2, n3) = (a.Normal, b.Normal, c.Normal);
        var (d1, d2, d3) = (n1.DotProduct(a.Origin), n2.DotProduct(b.Origin), n3.DotProduct(c.Origin));
        var denominator = n1.DotProduct(n2.CrossProduct(n3));
        if (Math.Abs(denominator) < 1e-9) throw new InvalidOperationException("Planes do not meet in a point (two are parallel).");
        return ((n2.CrossProduct(n3) * d1) + (n3.CrossProduct(n1) * d2) + (n1.CrossProduct(n2) * d3)) / denominator;
    }

    public static XYZ Direction(Axis axis) => axis switch {
        Axis.PlusX => XYZ.BasisX, Axis.MinusX => -XYZ.BasisX,
        Axis.PlusY => XYZ.BasisY, Axis.MinusY => -XYZ.BasisY,
        Axis.PlusZ => XYZ.BasisZ, _ => -XYZ.BasisZ
    };

    /// <summary>A stock view: the plan for Z-normal work, else the elevation whose direction best fits.</summary>
    public static View ViewFor(Document doc, StockView? stock, XYZ? normal = null) {
        var views = new FilteredElementCollector(doc).OfClass(typeof(View)).Cast<View>().Where(v => !v.IsTemplate).ToList();
        if (stock is { } s) {
            var name = s switch { StockView.RefLevel => "Ref. Level", _ => s.ToString() };
            return views.FirstOrDefault(v => string.Equals(v.Name, name, StringComparison.Ordinal))
                   ?? throw new InvalidOperationException($"Stock view '{name}' is not in this family.");
        }
        var n = normal ?? XYZ.BasisZ;
        if (Math.Abs(n.Z) > 0.95)
            return views.FirstOrDefault(v => v.ViewType is ViewType.FloorPlan or ViewType.CeilingPlan or ViewType.EngineeringPlan)
                   ?? throw new InvalidOperationException("No plan view in this family.");
        return views.Where(v => v.ViewType is ViewType.Elevation or ViewType.Section)
                   .OrderByDescending(v => Math.Abs(v.ViewDirection.DotProduct(n))).FirstOrDefault()
               ?? throw new InvalidOperationException("No elevation view in this family.");
    }

    /// <summary>Plan view for plane creation: `NewReferencePlane` needs a view whose plane the free line lies in.</summary>
    public static View ViewForPlaneCreation(Document doc, XYZ normal) => ViewFor(doc, null, Math.Abs(normal.Z) > 0.95 ? XYZ.BasisX : XYZ.BasisZ);

    public static (XYZ Bubble, XYZ Free, XYZ Cut) PlaneEndpoints(XYZ normal, XYZ origin) {
        var seed = Math.Abs(normal.Z) > 0.9 ? XYZ.BasisX : XYZ.BasisZ;
        var direction = seed.CrossProduct(normal).Normalize();
        var cut = normal.CrossProduct(direction).Normalize();
        return (origin + (direction * PlaneExtent), origin - (direction * PlaneExtent), cut);
    }

    public static FamilyParameter Param(Document doc, string reference) {
        var name = reference.StartsWith("param:", StringComparison.Ordinal) ? reference[6..] : reference;
        return doc.FamilyManager.get_Parameter(name) ?? throw new InvalidOperationException($"Parameter '{name}' is not in this family.");
    }

    public static double Feet(Document doc, PortableLength length) {
        if (length.Feet is { } f) return f;
        var p = Param(doc, length.Parameter!);
        var t = doc.FamilyManager.CurrentType;
        var v = t is not null && t.HasValue(p) ? t.AsDouble(p) : null;
        return v is > 1e-9 ? v.Value : 1.0; // ponytail: seed only; the labeled dimension owns the truth after regen
    }

    public static void Associate(Document doc, Parameter target, string reference, List<LogEntry> logs, string key) {
        var source = Param(doc, reference);
        var fm = doc.FamilyManager;
        if (!fm.CanElementParameterBeAssociated(target)) {
            logs.Add(new LogEntry(key).Error($"'{target.Definition.Name}' cannot be associated."));
            return;
        }
        var existing = fm.GetAssociatedFamilyParameter(target);
        if (existing?.Id == source.Id) return;
        if (existing is not null) fm.AssociateElementParameterToFamilyParameter(target, null);
        fm.AssociateElementParameterToFamilyParameter(target, source);
        logs.Add(new LogEntry(key).Success($"Associated '{target.Definition.Name}' to '{source.Definition.Name}'."));
    }

    public static void Align(Document doc, View view, Reference a, Reference b) {
        try { _ = doc.FamilyCreate.NewAlignment(view, a, b); }
        catch (Exception first) {
            try { _ = doc.FamilyCreate.NewAlignment(view, b, a); }
            catch (Exception second) {
                throw new AggregateException($"Alignment failed in view '{view.Name}' for {a.ElementId}/{a.ElementReferenceType} and {b.ElementId}/{b.ElementReferenceType}, in both argument orders.", first, second);
            }
        }
    }
}
