using Pe.Extensions.FamDocument;
using Pe.FamilyFoundry.Aggregators.Snapshots;

namespace Pe.FamilyFoundry.Snapshots;

/// <summary>
///     Collects only canonical, reference-plane-constrained extrusion specs.
///     Unconstrained or non-canonical extrusions are intentionally ignored.
/// </summary>
public class ExtrusionSectionCollector : IFamilyDocCollector {
    private const double DotOrthoTolerance = 0.15;

    public bool ShouldCollect(FamilySnapshot snapshot) =>
        snapshot.Extrusions == null ||
        (snapshot.Extrusions.Rectangles.Count == 0 && snapshot.Extrusions.Circles.Count == 0);

    public void Collect(FamilySnapshot snapshot, FamilyDocument famDoc) =>
        snapshot.Extrusions = CollectFromFamilyDoc(famDoc.Document);

    private static ExtrusionSnapshot CollectFromFamilyDoc(Document doc) {
        var result = new ExtrusionSnapshot { Source = SnapshotSource.FamilyDoc };

        var extrusions = new FilteredElementCollector(doc)
            .OfClass(typeof(Extrusion))
            .Cast<Extrusion>()
            .Where(e => e.Sketch != null)
            .ToList();

        foreach (var extrusion in extrusions) {
            try {
                var sketch = extrusion.Sketch;
                var constraints = GetDimensionConstraints(sketch, doc);
                if (constraints.Count < 2)
                    continue;

                if (TryBuildRectangleSpec(extrusion, constraints, out var rectangle)) {
                    result.Rectangles.Add(rectangle);
                    continue;
                }

                if (TryBuildCircleSpec(extrusion, constraints, out var circle))
                    result.Circles.Add(circle);
            } catch {
                // Never fail full pipeline due to one unsupported/problematic extrusion.
            }
        }

        return result;
    }

    private static bool TryBuildRectangleSpec(
        Extrusion extrusion,
        List<DimConstraint> constraints,
        out ConstrainedRectangleExtrusionSpec spec
    ) {
        spec = null;
        if (!IsRectangleProfile(extrusion.Sketch.Profile))
            return false;

        if (!TryPickOrthogonalPairs(constraints, out var pairA, out var pairB))
            return false;

        spec = new ConstrainedRectangleExtrusionSpec {
            Name = $"Extrusion_{extrusion.Id.IntegerValue}",
            IsSolid = extrusion.IsSolid,
            StartOffset = extrusion.StartOffset,
            EndOffset = extrusion.EndOffset,
            SketchPlaneName = extrusion.Sketch.SketchPlane?.Name ?? string.Empty,
            PairAPlane1 = pairA.Plane1.Name,
            PairAPlane2 = pairA.Plane2.Name,
            PairAParameter = pairA.ParameterName,
            PairBPlane1 = pairB.Plane1.Name,
            PairBPlane2 = pairB.Plane2.Name,
            PairBParameter = pairB.ParameterName
        };
        return true;
    }

    private static bool TryBuildCircleSpec(
        Extrusion extrusion,
        List<DimConstraint> constraints,
        out ConstrainedCircleExtrusionSpec spec
    ) {
        spec = null;
        if (!IsCircleProfile(extrusion.Sketch.Profile))
            return false;

        if (!TryPickOrthogonalPairs(constraints, out var pairA, out var pairB))
            return false;

        spec = new ConstrainedCircleExtrusionSpec {
            Name = $"Extrusion_{extrusion.Id.IntegerValue}",
            IsSolid = extrusion.IsSolid,
            StartOffset = extrusion.StartOffset,
            EndOffset = extrusion.EndOffset,
            SketchPlaneName = extrusion.Sketch.SketchPlane?.Name ?? string.Empty,
            PairAPlane1 = pairA.Plane1.Name,
            PairAPlane2 = pairA.Plane2.Name,
            PairAParameter = pairA.ParameterName,
            PairBPlane1 = pairB.Plane1.Name,
            PairBPlane2 = pairB.Plane2.Name,
            PairBParameter = pairB.ParameterName
        };
        return true;
    }

    private static bool TryPickOrthogonalPairs(
        List<DimConstraint> constraints,
        out DimConstraint pairA,
        out DimConstraint pairB
    ) {
        pairA = default;
        pairB = default;

        for (var i = 0; i < constraints.Count; i++) {
            for (var j = i + 1; j < constraints.Count; j++) {
                var a = constraints[i];
                var b = constraints[j];
                var absDot = Math.Abs(a.Normal.DotProduct(b.Normal));
                if (absDot > DotOrthoTolerance)
                    continue;

                pairA = a;
                pairB = b;
                return true;
            }
        }

        return false;
    }

    private static List<DimConstraint> GetDimensionConstraints(Sketch sketch, Document doc) {
        var constraints = new List<DimConstraint>();
        var seen = new HashSet<string>(StringComparer.Ordinal);

        foreach (var id in sketch.GetAllElements()) {
            var dim = doc.GetElement(id) as Dimension;
            if (dim == null || dim.References.Size != 2)
                continue;

            FamilyParameter? familyLabel = null;
            try {
                familyLabel = dim.FamilyLabel;
            } catch {
                // Some dimensions cannot be labeled and throw on getter.
                continue;
            }

            if (familyLabel == null)
                continue;

            var r1 = doc.GetElement(dim.References.get_Item(0)) as ReferencePlane;
            var r2 = doc.GetElement(dim.References.get_Item(1)) as ReferencePlane;
            if (r1 == null || r2 == null)
                continue;
            if (string.IsNullOrWhiteSpace(r1.Name) || string.IsNullOrWhiteSpace(r2.Name))
                continue;

            var labelName = familyLabel.Definition?.Name;
            if (string.IsNullOrWhiteSpace(labelName))
                continue;

            var key = string.CompareOrdinal(r1.Name, r2.Name) < 0
                ? $"{r1.Name}|{r2.Name}|{labelName}"
                : $"{r2.Name}|{r1.Name}|{labelName}";
            if (!seen.Add(key))
                continue;

            constraints.Add(new DimConstraint(r1, r2, labelName));
        }

        return constraints;
    }

    private static bool IsRectangleProfile(CurveArrArray profile) {
        if (profile == null || profile.Size != 1)
            return false;

        var loop = profile.get_Item(0);
        if (loop == null || loop.Size != 4)
            return false;

        var lines = loop.Cast<Curve>().Select(c => c as Line).ToList();
        if (lines.Any(l => l == null))
            return false;

        var dirs = lines.Select(l => (l.GetEndPoint(1) - l.GetEndPoint(0)).Normalize()).ToList();
        for (var i = 0; i < dirs.Count; i++) {
            var next = (i + 1) % dirs.Count;
            var dot = Math.Abs(dirs[i].DotProduct(dirs[next]));
            if (dot > DotOrthoTolerance)
                return false;
        }

        return true;
    }

    private static bool IsCircleProfile(CurveArrArray profile) {
        if (profile == null || profile.Size != 1)
            return false;

        var loop = profile.get_Item(0);
        if (loop == null || loop.Size == 0)
            return false;

        var arcs = loop.Cast<Curve>().Select(c => c as Arc).ToList();
        if (arcs.Any(a => a == null))
            return false;

        var center = arcs[0].Center;
        var radius = arcs[0].Radius;
        const double tol = 1e-6;
        return arcs.All(a => a.Center.IsAlmostEqualTo(center, tol) && Math.Abs(a.Radius - radius) <= tol);
    }

    private readonly record struct DimConstraint(
        ReferencePlane Plane1,
        ReferencePlane Plane2,
        string ParameterName
    ) {
        public XYZ Normal => Plane1.Normal.Normalize();
    }
}
