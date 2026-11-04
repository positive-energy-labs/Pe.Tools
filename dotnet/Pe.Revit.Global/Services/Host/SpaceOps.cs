using Autodesk.Revit.DB;
using Pe.Revit.Space;
using Pe.Shared.HostContracts.Operations;
using static Pe.Revit.Space.SpaceView;
using ProjectDocument = Pe.Revit.Operations.ProjectDocument;

namespace Pe.Revit.Global.Services.Host;

/// <summary>Document-owned reads over the operation-owned spatial world. Each operation captures only its own question's scope.</summary>
internal static class SpaceOps {
    /// <summary>Read rows passing Filter; omitted axes use the resolved defaults in the answer stamp.</summary>
    public sealed record RowsRequest(Region Region, FilterRequest? Filter = null);

    /// <summary>Read Source's BVH through MaxDepth inclusive. Source defaults to host (0), depth to 8.</summary>
    public sealed record TreeRequest(Region Region, int? Source = null, int? MaxDepth = null);

    /// <summary>Count rows overlapping Box, six ordered host-internal-feet bounds, under Filter.</summary>
    public sealed record CensusRequest(double[] Box, FilterRequest? Filter = null);

    /// <summary>
    /// Slice z0..z1 in host internal feet. XyClip is six ordered bounds; only x/y reject whole rows.
    /// MaxPieces defaults to 50000 and retains whole elements in source order; zero emits none.
    /// </summary>
    public sealed record SliceRequest(Region Region, double Z0, double Z1, FilterRequest? Filter = null, double[]? XyClip = null, int? MaxPieces = null);

    /// <summary>
    /// Probe At (three host-internal-feet coordinates). MaxDistanceFt defaults to 200.
    /// Purpose defaults to Obstructions; RoomHeights applies architectural height-role predicates.
    /// </summary>
    public sealed record ProbeRequest(Region Region, double[] At, FilterRequest? Filter = null, double? MaxDistanceFt = null, ProbePurpose? Purpose = null);

    /// <summary>Sweep a positive width/height profile in feet along at least two host-coordinate triples, with nonnegative clearance.</summary>
    public sealed record SweepRequest(Region Region, double[][] Polyline, double WidthFt, double HeightFt, double ClearanceFt, FilterRequest? Filter = null);

    [Op("revit.detail.space-status", OpSubject.Document, OpTouches.Metadata, OpEffect.Read, Does = "Read the current change epoch and level elevations without capturing geometry. Geometry is operation-owned; status reports no retained world.", Title = "Get Space World Status", Finds = ["space", "world", "status", "stamp", "sources", "levels"], Cost = OpCost.Cheap)]
    private static StatusAnswer Status(NoRequest _, ProjectDocument document) => SpaceView.Status(document.Value);

    [Op("revit.detail.space-rows", OpSubject.Region, OpTouches.Geometry, OpEffect.Read, Does = "Read element rows intersecting the declared room, space or box region and passing a filter, as parallel arrays with legend lists for category, kind, layer and height role, plus each row's box and triangle count.", Title = "Get Space Rows", Finds = ["space", "rows", "elements", "boxes", "categories"], Cost = OpCost.Expensive)]
    private static RowsAnswer Rows(RowsRequest request, ProjectDocument document) =>
        SpaceView.Rows(document.Value, (request.Filter ?? new FilterRequest()).ToFilter(), request.Region.Resolve(document.Value));

    [Op("revit.detail.space-tree", OpSubject.Region, OpTouches.Geometry, OpEffect.Read, Does = "Read one source's BVH captured inside a declared room, space or box region down to a depth: each node's box, depth, leaf flag and triangle count, so a viewer can draw how a sweep prunes.", Title = "Get Space BVH", Finds = ["space", "bvh", "tree", "nodes"], Cost = OpCost.Expensive)]
    private static TreeAnswer Tree(TreeRequest request, ProjectDocument document) =>
        SpaceView.Tree(document.Value, request.Source ?? 0, request.MaxDepth ?? 8, request.Region.Resolve(document.Value));

    [Op("revit.detail.space-census", OpSubject.Region, OpTouches.Geometry, OpEffect.Read, Does = "Count what lies inside a box, by source, category, kind and DWG layer, plus the ten fattest elements by triangle count. Reads only that box: an element is admitted when its own-frame box meets the box.", Title = "Census Space World", Finds = ["space", "census", "count", "categories", "box"], Cost = OpCost.Expensive)]
    private static CensusAnswer Census(CensusRequest request, ProjectDocument document) =>
        Verbs.Census(document.Value, Box(request.Box, nameof(request.Box)), (request.Filter ?? new FilterRequest()).ToFilter());

    [Op("revit.detail.space-slice", OpSubject.Region, OpTouches.Geometry, OpEffect.Read, Does = "Slice the operation-owned world with a horizontal band z0..z1: every triangle clipped to the band and flattened to convex xy pieces per element, the exact footprint the partition solver reads; capped at maxPieces with whole elements, and the answer says when it truncated and the total it found. Reads only the band (within xyClip when given): an element is admitted when its own-frame box meets that region, and xyClip rejects elements whose box misses the rectangle.", Title = "Slice Space World", Finds = ["space", "slice", "band", "footprint", "plan"], Cost = OpCost.Expensive)]
    private static SliceCapped Slice(SliceRequest request, ProjectDocument document) {
        Finite(request.Z0, nameof(request.Z0));
        Finite(request.Z1, nameof(request.Z1));
        var region = request.Region.Resolve(document.Value);
        if (request.Z0 < region.MinZ || request.Z1 > region.MaxZ || request.Z1 <= request.Z0)
            throw new ArgumentException("Slice heights must lie inside the region.");
        return SpaceView.Slice(document.Value, request.Z0, request.Z1, (request.Filter ?? new FilterRequest()).ToFilter(),
            region, request.MaxPieces ?? 50_000);
    }

    [Op("revit.detail.space-probe", OpSubject.Region, OpTouches.Geometry, OpEffect.Read, Does = "Probe straight down and straight up from one point: the first thing under it and over it, with the Handle and distance of each; null when nothing is hit within maxDistanceFt. The region is admission only: the point must lie inside it, and the column may leave it (a floor slab and ceiling sit at or past a room's box). Only the column is read. Cost is reported in the geometry stamp; large reads remain available.", Title = "Probe Space World", Finds = ["space", "probe", "floor", "ceiling", "ray"], Cost = OpCost.Expensive)]
    private static ProbeAnswer Probe(ProbeRequest request, ProjectDocument document) {
        var distance = request.MaxDistanceFt ?? 200;
        Positive(distance, nameof(request.MaxDistanceFt));
        var purpose = request.Purpose ?? ProbePurpose.Obstructions;
        if (!Enum.IsDefined(typeof(ProbePurpose), purpose)) throw new ArgumentOutOfRangeException(nameof(request.Purpose));
        var at = Point(request.At, nameof(request.At));
        request.Region.Resolve(document.Value).AdmitProbe(at);
        // The region is admission only: Verbs.Probe prepares the probe's own column, never the region box.
        return Verbs.Probe(document.Value, at, (request.Filter ?? new FilterRequest()).ToFilter(), distance, purpose);
    }

    [Op("revit.detail.space-sweep", OpSubject.Region, OpTouches.Geometry, OpEffect.Read, Does = "Sweep a rectangular profile (widthFt across, heightFt up) along a polyline and answer HIT, NEAR or CLEAR per segment with the exact gap and the nearest element's Handle. The region is admission only: every polyline point must lie inside it, while the profile and clearance may extend past it. Only the sweep's own reach is read (plus CAD ribbons when the filter asks for Curve2D). Cost is reported in the geometry stamp; large reads remain available.", Title = "Sweep Space World", Finds = ["space", "sweep", "clearance", "duct", "collision"], Cost = OpCost.Expensive)]
    private static SweepAnswer Sweep(SweepRequest request, ProjectDocument document) {
        if (request.Polyline is not { Length: >= 2 }) throw new ArgumentException("polyline needs at least two coordinate triples.");
        Positive(request.WidthFt, nameof(request.WidthFt));
        Positive(request.HeightFt, nameof(request.HeightFt));
        Finite(request.ClearanceFt, nameof(request.ClearanceFt));
        if (request.ClearanceFt < 0) throw new ArgumentOutOfRangeException(nameof(request.ClearanceFt));
        var polyline = request.Polyline.Select(p => Point(p, nameof(request.Polyline))).ToList();
        request.Region.Resolve(document.Value).AdmitSweep(polyline);
        // The region is admission only: Verbs.Sweep prepares the sweep's own reach and its Curve2D ribbons, never the region box.
        return Verbs.Sweep(document.Value, polyline, request.WidthFt, request.HeightFt, request.ClearanceFt,
            (request.Filter ?? new FilterRequest()).ToFilter());
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
