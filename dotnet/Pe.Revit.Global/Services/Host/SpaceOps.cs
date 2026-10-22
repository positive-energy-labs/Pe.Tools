using Autodesk.Revit.DB;
using Pe.Revit.Space;
using Pe.Shared.HostContracts.Operations;
using static Pe.Revit.Space.SpaceView;
using ProjectDocument = Pe.Revit.Operations.ProjectDocument;

namespace Pe.Revit.Global.Services.Host;

/// <summary>Document-owned reads over the resident spatial world. Only Build performs a full ingest.</summary>
internal static class SpaceOps {
    /// <summary>Read rows passing Filter; omitted axes use the resolved defaults in the answer stamp.</summary>
    public sealed record RowsRequest(FilterRequest? Filter = null);

    /// <summary>Read Source's BVH through MaxDepth inclusive. Source defaults to host (0), depth to 8.</summary>
    public sealed record TreeRequest(int? Source = null, int? MaxDepth = null);

    /// <summary>Count rows overlapping Box, six ordered host-internal-feet bounds, under Filter.</summary>
    public sealed record CensusRequest(double[] Box, FilterRequest? Filter = null);

    /// <summary>
    /// Slice z0..z1 in host internal feet. XyClip is six ordered bounds; only x/y reject whole rows.
    /// MaxPieces defaults to 50000 and retains whole elements in resident order; zero emits none.
    /// </summary>
    public sealed record SliceRequest(double Z0, double Z1, FilterRequest? Filter = null, double[]? XyClip = null, int? MaxPieces = null);

    /// <summary>
    /// Probe At (three host-internal-feet coordinates). MaxDistanceFt defaults to 200.
    /// Purpose defaults to Obstructions; RoomHeights applies architectural height-role predicates.
    /// </summary>
    public sealed record ProbeRequest(double[] At, FilterRequest? Filter = null, double? MaxDistanceFt = null, ProbePurpose? Purpose = null);

    /// <summary>Sweep a positive width/height profile in feet along at least two host-coordinate triples, with nonnegative clearance.</summary>
    public sealed record SweepRequest(double[][] Polyline, double WidthFt, double HeightFt, double ClearanceFt, FilterRequest? Filter = null);

    [Op("revit.detail.space-status", Does = "Read whether the resident spatial world is built for the target project, its stamp (epoch, freshness, sources), the categories each source holds, level elevations, and world bounds.", Title = "Get Space World Status", Finds = ["space", "world", "status", "stamp", "sources", "levels"], Cost = OpCost.Cheap)]
    private static StatusAnswer Status(NoRequest _, ProjectDocument document) => SpaceView.Status(document.Value);

    [Op("revit.detail.space-build", Does = "Build the resident spatial world for the target project: tessellate host and every loaded link into one triangle soup with a BVH per source. Minutes on a large model; holds Revit for the whole ingest.", Title = "Build Space World", Finds = ["space", "world", "build", "ingest", "tessellate"], Cost = OpCost.Expensive)]
    private static StatusAnswer Build(NoRequest _, ProjectDocument document) {
        SpaceWorld.Build(document.Value);
        return SpaceView.Status(document.Value);
    }

    [Op("revit.detail.space-rows", Does = "Read every element row of the resident world that passes a filter, as parallel arrays with legend lists for category, kind, layer and height role, plus each row's box and triangle count.", Title = "Get Space Rows", Finds = ["space", "rows", "elements", "boxes", "categories"], Cost = OpCost.Bounded)]
    private static RowsAnswer Rows(RowsRequest request, ProjectDocument document) =>
        SpaceView.Rows(document.Value, (request.Filter ?? new FilterRequest()).ToFilter());

    [Op("revit.detail.space-tree", Does = "Read one source's BVH down to a depth: each node's box, depth, leaf flag and triangle count, so a viewer can draw how a sweep prunes.", Title = "Get Space BVH", Finds = ["space", "bvh", "tree", "nodes"], Cost = OpCost.Bounded)]
    private static TreeAnswer Tree(TreeRequest request, ProjectDocument document) =>
        SpaceView.Tree(document.Value, request.Source ?? 0, request.MaxDepth ?? 8);

    [Op("revit.detail.space-census", Does = "Count what the resident world holds inside a box, by source, category, kind and DWG layer, plus the ten fattest elements by triangle count.", Title = "Census Space World", Finds = ["space", "census", "count", "categories", "box"], Cost = OpCost.Bounded)]
    private static CensusAnswer Census(CensusRequest request, ProjectDocument document) =>
        Verbs.Census(document.Value, Box(request.Box, nameof(request.Box)), (request.Filter ?? new FilterRequest()).ToFilter());

    [Op("revit.detail.space-slice", Does = "Slice the resident world with a horizontal band z0..z1: every triangle clipped to the band and flattened to convex xy pieces per element, the exact footprint the partition solver reads; capped at maxPieces with whole elements, and the answer says when it truncated and the total it found. xyClip rejects elements whose box misses the rectangle.", Title = "Slice Space World", Finds = ["space", "slice", "band", "footprint", "plan"], Cost = OpCost.Bounded)]
    private static SliceCapped Slice(SliceRequest request, ProjectDocument document) {
        Finite(request.Z0, nameof(request.Z0));
        Finite(request.Z1, nameof(request.Z1));
        return SpaceView.Slice(document.Value, request.Z0, request.Z1, (request.Filter ?? new FilterRequest()).ToFilter(),
            request.XyClip is null ? null : Box(request.XyClip, nameof(request.XyClip)), request.MaxPieces ?? 50_000);
    }

    [Op("revit.detail.space-probe", Does = "Probe straight down and straight up from one point: the first thing under it and over it, with the Handle and distance of each; null when nothing is hit within maxDistanceFt.", Title = "Probe Space World", Finds = ["space", "probe", "floor", "ceiling", "ray"], Cost = OpCost.Cheap)]
    private static ProbeAnswer Probe(ProbeRequest request, ProjectDocument document) {
        var distance = request.MaxDistanceFt ?? 200;
        Positive(distance, nameof(request.MaxDistanceFt));
        var purpose = request.Purpose ?? ProbePurpose.Obstructions;
        if (!Enum.IsDefined(typeof(ProbePurpose), purpose)) throw new ArgumentOutOfRangeException(nameof(request.Purpose));
        return Verbs.Probe(document.Value, Point(request.At, nameof(request.At)),
            (request.Filter ?? new FilterRequest()).ToFilter(), distance, purpose);
    }

    [Op("revit.detail.space-sweep", Does = "Sweep a rectangular profile (widthFt across, heightFt up) along a polyline and answer HIT, NEAR or CLEAR per segment with the exact gap and the nearest element's Handle.", Title = "Sweep Space World", Finds = ["space", "sweep", "clearance", "duct", "collision"], Cost = OpCost.Cheap)]
    private static SweepAnswer Sweep(SweepRequest request, ProjectDocument document) {
        if (request.Polyline is not { Length: >= 2 }) throw new ArgumentException("polyline needs at least two coordinate triples.");
        Positive(request.WidthFt, nameof(request.WidthFt));
        Positive(request.HeightFt, nameof(request.HeightFt));
        Finite(request.ClearanceFt, nameof(request.ClearanceFt));
        if (request.ClearanceFt < 0) throw new ArgumentOutOfRangeException(nameof(request.ClearanceFt));
        return Verbs.Sweep(document.Value, request.Polyline.Select(p => Point(p, nameof(request.Polyline))).ToList(),
            request.WidthFt, request.HeightFt, request.ClearanceFt, (request.Filter ?? new FilterRequest()).ToFilter());
    }

    private static Aabb Box(double[]? values, string name) {
        if (values is not { Length: 6 }) throw new ArgumentException("Expected six ordered host-internal-feet bounds.", name);
        foreach (var value in values) Finite(value, name);
        if (values[0] > values[3] || values[1] > values[4] || values[2] > values[5])
            throw new ArgumentException("Bounds must be ordered minX, minY, minZ, maxX, maxY, maxZ.", name);
        return new Aabb(values[0], values[1], values[2], values[3], values[4], values[5]);
    }

    private static XYZ Point(double[]? values, string name) {
        if (values is not { Length: 3 }) throw new ArgumentException("Expected three host-internal-feet coordinates.", name);
        foreach (var value in values) Finite(value, name);
        return new XYZ(values[0], values[1], values[2]);
    }

    private static void Positive(double value, string name) {
        Finite(value, name);
        if (value <= 0) throw new ArgumentOutOfRangeException(name, "Must be positive.");
    }

    private static void Finite(double value, string name) {
        if (double.IsNaN(value) || double.IsInfinity(value)) throw new ArgumentException("Must be finite.", name);
    }
}
