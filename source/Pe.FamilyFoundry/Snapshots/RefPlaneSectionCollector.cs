using Pe.Extensions.FamDocument;
using Pe.FamilyFoundry.Aggregators.Snapshots;

namespace Pe.FamilyFoundry.Snapshots;

/// <summary>
///     Collects reference planes and dimensions from family document.
///     Outputs separate MirrorSpec and OffsetSpec lists.
/// </summary>
public class RefPlaneSectionCollector : IFamilyDocCollector {
    public bool ShouldCollect(FamilySnapshot snapshot) =>
        snapshot.RefPlanesAndDims == null ||
        (snapshot.RefPlanesAndDims.MirrorSpecs.Count == 0 && snapshot.RefPlanesAndDims.OffsetSpecs.Count == 0);

    public void Collect(FamilySnapshot snapshot, FamilyDocument famDoc) =>
        snapshot.RefPlanesAndDims = CollectFromFamilyDoc(famDoc);

    private static RefPlaneSnapshot CollectFromFamilyDoc(FamilyDocument famDoc) {
        var mirrorSpecs = new List<MirrorSpec>();
        var offsetSpecs = new List<OffsetSpec>();
        var processedPlanePairs = new HashSet<string>();
        var processedMirrorSpecs = new HashSet<string>(); // Track unique mirror specs

        var dimensions = new FilteredElementCollector(famDoc.Document)
            .OfClass(typeof(Dimension))
            .Cast<Dimension>()
            .Where(d => d is not SpotDimension)
            .ToList();

        // First pass: Find 3-plane EQ dimensions (mirror patterns)
        foreach (var dim in dimensions) {
            if (dim.References.Size != 3 || !dim.AreSegmentsEqual) continue;

            var refPlanes = GetReferencePlanes(dim, famDoc.Document);
            if (refPlanes.Count != 3) continue;

            var centerPlane = FindCenterPlaneGeometrically(refPlanes);
            if (centerPlane == null) continue;

            var sidePlanes = refPlanes.Where(p => p != centerPlane).ToList();
            if (sidePlanes.Count != 2) continue;

            // Extract base name from side plane names
            var baseName = ExtractBaseName(sidePlanes[0].Name, sidePlanes[1].Name);
            if (string.IsNullOrEmpty(baseName)) continue;

            // Create unique key for this mirror spec
            var mirrorSpecKey = $"{baseName}|{centerPlane.Name}";
            if (processedMirrorSpecs.Contains(mirrorSpecKey)) continue;

            // Find the corresponding 2-plane dimension with parameter
            var parameterName = FindParameterDimension(dimensions, sidePlanes[0], sidePlanes[1], famDoc.Document);

            mirrorSpecs.Add(new MirrorSpec {
                Name = baseName,
                CenterAnchor = centerPlane.Name,
                Parameter = parameterName,
                Strength = GetStrength(sidePlanes[0])
            });

            // Track this mirror spec and plane pair as processed
            _ = processedMirrorSpecs.Add(mirrorSpecKey);
            var pairKey = GetPairKey(sidePlanes[0].Name, sidePlanes[1].Name);
            _ = processedPlanePairs.Add(pairKey);
        }

        // Second pass: Find 2-plane dimensions that aren't part of mirror patterns
        foreach (var dim in dimensions) {
            if (dim.References.Size != 2) continue;
            if (dim.AreSegmentsEqual) continue; // Skip EQ dims

            var refPlanes = GetReferencePlanes(dim, famDoc.Document);
            if (refPlanes.Count != 2) continue;

            var pairKey = GetPairKey(refPlanes[0].Name, refPlanes[1].Name);
            if (processedPlanePairs.Contains(pairKey)) continue;

            var (anchor, target, direction) = DetermineAnchorAndTarget(refPlanes[0], refPlanes[1]);

            offsetSpecs.Add(new OffsetSpec {
                Name = target.Name,
                AnchorName = anchor.Name,
                Direction = direction,
                Parameter = GetDimensionParameter(dim),
                Strength = GetStrength(target)
            });

            _ = processedPlanePairs.Add(pairKey);
        }

        return new RefPlaneSnapshot {
            Source = SnapshotSource.FamilyDoc,
            MirrorSpecs = mirrorSpecs,
            OffsetSpecs = offsetSpecs
        };
    }

    private static string FindParameterDimension(
        List<Dimension> dimensions,
        ReferencePlane plane1,
        ReferencePlane plane2,
        Document doc
    ) {
        foreach (var dim in dimensions) {
            if (dim.References.Size != 2) continue;
            if (dim.AreSegmentsEqual) continue;

            var refPlanes = GetReferencePlanes(dim, doc);
            if (refPlanes.Count != 2) continue;

            var hasBoth = refPlanes.Any(p => p.Id == plane1.Id) && refPlanes.Any(p => p.Id == plane2.Id);
            if (!hasBoth) continue;

            var param = GetDimensionParameter(dim);
            if (!string.IsNullOrEmpty(param)) return param;
        }

        return null;
    }

    private static string ExtractBaseName(string name1, string name2) {
        // Find longest common prefix
        var minLength = Math.Min(name1.Length, name2.Length);
        var commonPrefix = "";

        for (var i = 0; i < minLength; i++) {
            if (name1[i] == name2[i])
                commonPrefix += name1[i];
            else
                break;
        }

        if (commonPrefix.Length < 2) return null;

        // Trim trailing whitespace and opening parenthesis
        return commonPrefix.TrimEnd(' ', '(');
    }

    private static string GetPairKey(string name1, string name2) =>
        string.Compare(name1, name2, StringComparison.Ordinal) < 0
            ? $"{name1}|{name2}"
            : $"{name2}|{name1}";

    private static (ReferencePlane anchor, ReferencePlane target, OffsetDirection direction) DetermineAnchorAndTarget(
        ReferencePlane plane1,
        ReferencePlane plane2
    ) {
        // Use naming heuristics: center planes are typically anchors
        var isCenterPlane1 = plane1.Name.Contains("Center") || plane1.Name.Contains("Ref.");
        var isCenterPlane2 = plane2.Name.Contains("Center") || plane2.Name.Contains("Ref.");

        ReferencePlane anchor, target;
        if (isCenterPlane1 && !isCenterPlane2) {
            anchor = plane1;
            target = plane2;
        } else if (isCenterPlane2 && !isCenterPlane1) {
            anchor = plane2;
            target = plane1;
        } else {
            // Default: first plane is anchor
            anchor = plane1;
            target = plane2;
        }

        // Determine direction
        var anchorMid = (anchor.BubbleEnd + anchor.FreeEnd) * 0.5;
        var targetMid = (target.BubbleEnd + target.FreeEnd) * 0.5;
        var diff = targetMid - anchorMid;
        var dot = diff.DotProduct(anchor.Normal);

        var direction = dot > 0 ? OffsetDirection.Positive : OffsetDirection.Negative;

        return (anchor, target, direction);
    }

    private static ReferencePlane FindCenterPlaneGeometrically(List<ReferencePlane> planes) {
        if (planes.Count != 3) return null;

        var normal = planes[0].Normal;
        var midpoints = planes.Select(p => (p, mid: (p.BubbleEnd + p.FreeEnd) * 0.5)).ToList();
        var origin = midpoints[0].mid;
        var positions = midpoints.Select(m => (m.p, pos: (m.mid - origin).DotProduct(normal))).ToList();
        positions.Sort((a, b) => a.pos.CompareTo(b.pos));

        return positions[1].p;
    }

    private static List<ReferencePlane> GetReferencePlanes(Dimension dim, Document doc) {
        var refPlanes = new List<ReferencePlane>();
        for (var i = 0; i < dim.References.Size; i++) {
            var reference = dim.References.get_Item(i);
            var elem = doc.GetElement(reference);
            if (elem is ReferencePlane rp && !string.IsNullOrEmpty(rp.Name))
                refPlanes.Add(rp);
        }

        return refPlanes;
    }

    private static string GetDimensionParameter(Dimension dim) {
        try {
            return dim.FamilyLabel?.Definition?.Name;
        } catch {
            return null;
        }
    }

    private static RpStrength GetStrength(ReferencePlane rp) {
        try {
            var strength = rp.get_Parameter(BuiltInParameter.ELEM_REFERENCE_NAME).AsInteger();
            return (RpStrength)strength;
        } catch {
            return RpStrength.NotARef;
        }
    }
}

/// <summary>
///     Snapshot data for reference planes and dimensions.
/// </summary>
public class RefPlaneSnapshot {
    public SnapshotSource Source { get; set; }
    public List<MirrorSpec> MirrorSpecs { get; set; } = [];
    public List<OffsetSpec> OffsetSpecs { get; set; } = [];
}
