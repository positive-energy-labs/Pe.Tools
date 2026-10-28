namespace Pe.Revit.Space;

/// <summary>One operation's source triangles, tags, and query tree.</summary>
internal sealed class Partition {
    private Tri[] _tris = [];
    private PrimRow[] _prims = [];
    private int[] _start = [0];
    private readonly LinkedGeometryStore? _store;
    private bool _scene;
    private int _sceneElements, _sceneTriangles;

    public Partition(int source, Document doc, SourceKind kind, long? linkInstanceId, Transform transform, string? generation = null) {
        this.Source = source;
        this.Doc = doc;
        this.Kind = kind;
        this.LinkInstanceId = linkInstanceId;
        this.Transform = transform;
        this.DocumentKey = doc.GetDocumentKey();
        this.Bvh = Bvh.Build([]);
        this._store = generation is null ? null : LinkedGeometryStore.For(doc, linkInstanceId, transform, generation);
    }

    public int Source { get; }
    public Document Doc { get; }
    public SourceKind Kind { get; }
    public long? LinkInstanceId { get; }
    public Transform Transform { get; }
    public string DocumentKey { get; }

    public Tri[] Tris => this._tris;
    public PrimRow[] Prims => this._prims;

    /// <summary>Prefix offsets into <see cref="Tris" />: row i owns [Starts[i], Starts[i + 1]).
    /// Exposed so a verb can reject a whole element by its Box before touching a triangle.</summary>
    public int[] Starts => this._start;

    /// <summary>The distinct categories this partition holds, derived once per Adopt so that
    /// resolving an unfiltered answer costs nothing per call.</summary>
    public IReadOnlyList<string> Categories { get; private set; } = [];
    public Bvh Bvh { get; private set; }
    public long BuiltAtEpoch { get; private set; }
    public bool Dirty { get; set; } = true;
    public int Skipped { get; private set; }

    public SourceRow Row => new(
        this.Source, this.DocumentKey, this.LinkInstanceId, this.Kind,
        this.BuiltAtEpoch, this.Dirty, this._scene ? this._sceneElements : this._prims.Length,
        this._scene ? this._sceneTriangles : this._tris.Length, this.Skipped);

    /// <summary>The one full ingest. Never called from a verb.</summary>
    public void Build(long epoch) {
        using var cache = this._store?.Open();
        var sink = new List<Tri>();
        var rows = new List<PrimRow>();
        this.Skipped = 0;
        foreach (var element in new FilteredElementCollector(this.Doc).WhereElementIsNotElementType()) {
            if (!Ingest.Allowed(element)) { this.Skipped++; continue; }
            if (this.ReadElement(element, sink, rows, true, null) == 0) this.Skipped++;
        }
        // ponytail: List doubling means the sink peaks near 1.5x the final array before ToArray
        // trims it. That is transient garbage, not resident. A chunked writer would remove it.
        this.Adopt(sink.ToArray(), rows.ToArray());
        this.BuiltAtEpoch = epoch;
        this.Dirty = false;
    }

    internal void BuildElements(IEnumerable<Element> elements, long epoch, Aabb? region = null) {
        using var cache = this._store?.Open();
        var sink = new List<Tri>();
        var rows = new List<PrimRow>();
        this.Skipped = 0;
        foreach (var element in elements) {
            if (!Ingest.Allowed(element)) continue;
            if (this.ReadElement(element, sink, rows, false, region) == 0) this.Skipped++;
        }
        // Scene capture only clips and writes triangles; it never traverses a triangle BVH.
        this.Adopt(sink.ToArray(), rows.ToArray(), false);
        this.BuiltAtEpoch = epoch;
        this.Dirty = false;
    }

    private int ReadElement(Element element, List<Tri> sink, List<PrimRow> rows, bool includeCurves, Aabb? region) {
        // A host boundary element needs native per-solid rejection before the element's row bounds and
        // Medium/Fine choice are derived. An uncropped cached row cannot reconstruct those decisions.
        if (this._store is null || (this.Kind == SourceKind.Host && region is { } bounds && !this.InsideRegion(element, bounds)))
            return Ingest.Element(element, this.Source, rows.Count, sink, this.Transform, rows, includeCurves, region);
        // Disk rows are uncropped and source-neutral. The caller's region is applied only after capture.
        var captured = this._store.Read(element.UniqueId + (includeCurves ? "/curves" : "/mesh"), () => {
            var triangles = new List<Tri>();
            var prims = new List<PrimRow>();
            Ingest.Element(element, 0, 0, triangles, this.Transform, prims, includeCurves);
            return new LinkedGeometryStore.Geometry(prims.ToArray(), triangles.ToArray());
        });
        var start = 0;
        var added = 0;
        foreach (var row in captured.Rows) {
            if ((includeCurves || row.Kind != PrimKind.Curve2D) && (region is null || row.Box.Overlaps(region.Value))) {
                var prim = rows.Count;
                for (var i = start; i < start + row.Triangles; i++) {
                    var triangle = captured.Triangles[i];
                    triangle.Prim = prim;
                    sink.Add(triangle);
                }
                rows.Add(row with { Source = this.Source });
                added++;
            }
            start += row.Triangles;
        }
        return added;
    }

    internal void BeginScene(long epoch) { this._scene = true; this.BuiltAtEpoch = epoch; this.Dirty = false; }
    internal void RecordScene(LinkedGeometryStore.Geometry geometry) {
        this._sceneElements += geometry.Rows.Length; this._sceneTriangles += geometry.Triangles.Length;
        this.Categories = this.Categories.Concat(geometry.Rows.Select(row => row.Category)).Distinct(StringComparer.OrdinalIgnoreCase).ToArray();
    }

    internal IDisposable? OpenScene() => this._store?.Open();

    internal LinkedGeometryStore.Geometry CaptureScene(Element element, Aabb? region, SceneBudget budget, bool coarse = false) {
        LinkedGeometryStore.Geometry Capture(Aabb? bounds) {
            var triangles = new List<Tri>();
            var rows = new List<PrimRow>();
            Ingest.Element(element, 0, 0, triangles, this.Transform, rows, false, bounds, budget, coarse);
            return new LinkedGeometryStore.Geometry(rows.ToArray(), triangles.ToArray());
        }
        budget.Check();
        var result = coarse || this._store is null || (this.Kind == SourceKind.Host && region is { } box && !this.InsideRegion(element, box))
            ? Capture(region)
            : this._store.Read(element.UniqueId + "/mesh", () => Capture(null));
        return result;
    }

    /// <summary>
    ///     The one context query of this source instance: ids whose bounds meet any reach box, counted without
    ///     loading. Exclusion classes are quick filters over those ids alone (id-seeded collectors, no reach term);
    ///     only what survives is iterated, and iterating loads (≈14 KB per element in the Chadds IFC link). The reach
    ///     query is the time cost: it scales with outlines × elements tested (501 outlines over Chadds' host took
    ///     19.5 s), so outlines merge and their extent filters first. One reach query per source.
    /// </summary>
    /// <param name="reach">Host-frame boxes, each as its 8 corners; mapped into this instance's frame here.</param>
    /// <param name="bound">Host-frame box every reach box is clamped to, as 8 corners: nothing within reach lies outside it.</param>
    internal SceneReach Reach(IReadOnlyList<XYZ[]> reach, XYZ[] bound) {
        var clock = System.Diagnostics.Stopwatch.StartNew();
        if (reach.Count == 0) return new SceneReach(0, [], new Dictionary<string, int>(), 0, 0, 0, 0, 0);
        using var inverse = this.Transform.Inverse;
        var limit = Bounds(bound.Select(inverse.OfPoint));
        var local = Merge(reach.Select(corners => Clamp(Bounds(corners.Select(inverse.OfPoint)), limit))
            .Where(box => box.Min.X <= box.Max.X && box.Min.Y <= box.Max.Y && box.Min.Z <= box.Max.Z).ToList());
        if (local.Count == 0) return new SceneReach(0, [], new Dictionary<string, int>(), 0, 0, 0, 0, 0);
        var boxes = local.Select(box => (ElementFilter)Intersecting(box)).ToList();
        // The extent of every reach box goes first, so the OR tests only elements already inside it.
        using var extent = Intersecting(local.Aggregate(Union));
        var near = boxes.Count == 1 ? boxes[0] : new LogicalOrFilter(boxes);
        HashSet<ElementId> inside;
        using (var collector = new FilteredElementCollector(this.Doc).WhereElementIsNotElementType().WherePasses(extent).WherePasses(near))
            inside = [.. collector.ToElementIds()];
        var queried = clock.Elapsed.TotalMilliseconds;
        if (boxes.Count > 1) near.Dispose();
        foreach (var box in boxes) box.Dispose();
        var excluded = new Dictionary<string, int>(StringComparer.Ordinal);
        var keep = new HashSet<ElementId>(inside);
        // Each class is counted over the reach ids only (an id-seeded collector), never over the whole document.
        foreach (var (name, match) in Exclusions) {
            if (inside.Count == 0) break;
            using var collector = new FilteredElementCollector(this.Doc, inside).WherePasses(match);
            var members = collector.ToElementIds();
            if (members.Count == 0) continue;
            excluded[name] = members.Count;
            keep.ExceptWith(members);
        }
        var classified = clock.Elapsed.TotalMilliseconds;
        var kept = new List<Element>();
        var rejected = 0;
        if (keep.Count > 0) {
            // Revit refuses to iterate an id-seeded collector with no filter; the ids are non-type already.
            using var collector = new FilteredElementCollector(this.Doc, keep).WhereElementIsNotElementType();
            // The managed gate stays as a witness: what it rejects here was loaded for nothing and is disclosed.
            foreach (var element in collector)
                if (Ingest.Allowed(element)) kept.Add(element); else rejected++;
        }
        var total = clock.Elapsed.TotalMilliseconds;
        return new SceneReach(inside.Count, kept, excluded, rejected, total, queried, classified - queried, total - classified);
    }

    /// <summary>
    ///     Classes that pass `CategoryType.Model` but are not context, excluded before iteration in every
    ///     source, each counted per read so every model proves what it matched (READING-REVIT, what passes as
    ///     geometry but is not): MEP centre-line helpers
    ///     (class Element), insulation (drawn from its host), view-owned elements, CAD (model-level CAD is
    ///     disclosed, not drawn, until kaitpw rules), and the link classes Cleremont found.
    /// </summary>
    private static readonly (string Name, ElementFilter Match)[] Exclusions = [
        OfCategories("centre-line", Enum.GetValues(typeof(BuiltInCategory)).Cast<BuiltInCategory>()
            .Where(c => c.ToString().EndsWith("CenterLine", StringComparison.Ordinal)).ToArray()),
        OfCategories("insulation", BuiltInCategory.OST_DuctInsulations, BuiltInCategory.OST_PipeInsulations),
        ("view-specific", new ElementOwnerViewFilter(ElementId.InvalidElementId, true)),
        OfClasses("cad", typeof(ImportInstance)),
        OfCategories("sketch", BuiltInCategory.OST_SketchLines, BuiltInCategory.OST_Lines,
            BuiltInCategory.OST_RailingRailPathExtensionLines, BuiltInCategory.OST_RailingRailPathLines),
        OfCategories("curtain-grid", BuiltInCategory.OST_CurtainGrids, BuiltInCategory.OST_CurtainGridsWall,
            BuiltInCategory.OST_CurtainGridsRoof, BuiltInCategory.OST_CurtainGridsSystem, BuiltInCategory.OST_CurtainGridsCurtaSystem),
        OfCategories("separation", BuiltInCategory.OST_RoomSeparationLines, BuiltInCategory.OST_MEPSpaceSeparationLines),
        OfClasses("origin", typeof(BasePoint), typeof(InternalOrigin)),
        OfCategories("beam-system", BuiltInCategory.OST_StructuralFramingSystem),
        OfCategories("planting", BuiltInCategory.OST_Planting, BuiltInCategory.OST_Entourage),
        OfCategories("site", BuiltInCategory.OST_Topography, BuiltInCategory.OST_Toposolid, BuiltInCategory.OST_Mass),
        // Ingest.Allowed refuses these after loading; refusing them here first spends no load (326 in one SA 19 link read).
        OfCategories("non-geometry", BuiltInCategory.OST_Cameras, BuiltInCategory.OST_Levels, BuiltInCategory.OST_Grids,
            BuiltInCategory.OST_CLines, BuiltInCategory.OST_ReferenceLines, BuiltInCategory.OST_VolumeOfInterest,
            BuiltInCategory.OST_SectionBox, BuiltInCategory.OST_Matchline, BuiltInCategory.OST_Rooms, BuiltInCategory.OST_MEPSpaces,
            BuiltInCategory.OST_Areas, BuiltInCategory.OST_Views, BuiltInCategory.OST_Schedules, BuiltInCategory.OST_Sheets,
            BuiltInCategory.OST_DuctSystem, BuiltInCategory.OST_PipingSystem, BuiltInCategory.OST_ElectricalCircuit,
            BuiltInCategory.OST_SwitchSystem),
    ];

    private static (string, ElementFilter) OfCategories(string name, params BuiltInCategory[] categories) =>
        (name, new ElementMulticategoryFilter(categories.Distinct().ToList()));

    private static (string, ElementFilter) OfClasses(string name, params Type[] types) => (name, types.Length == 1
        ? new ElementClassFilter(types[0]) : new LogicalOrFilter(types.Select(t => (ElementFilter)new ElementClassFilter(t)).ToList()));

    private static (XYZ Min, XYZ Max) Bounds(IEnumerable<XYZ> corners) {
        double minX = double.MaxValue, minY = double.MaxValue, minZ = double.MaxValue;
        double maxX = double.MinValue, maxY = double.MinValue, maxZ = double.MinValue;
        foreach (var p in corners) {
            minX = Math.Min(minX, p.X); minY = Math.Min(minY, p.Y); minZ = Math.Min(minZ, p.Z);
            maxX = Math.Max(maxX, p.X); maxY = Math.Max(maxY, p.Y); maxZ = Math.Max(maxZ, p.Z);
        }
        return (new XYZ(minX, minY, minZ), new XYZ(maxX, maxY, maxZ));
    }

    private static (XYZ Min, XYZ Max) Union((XYZ Min, XYZ Max) a, (XYZ Min, XYZ Max) b) => (
        new XYZ(Math.Min(a.Min.X, b.Min.X), Math.Min(a.Min.Y, b.Min.Y), Math.Min(a.Min.Z, b.Min.Z)),
        new XYZ(Math.Max(a.Max.X, b.Max.X), Math.Max(a.Max.Y, b.Max.Y), Math.Max(a.Max.Z, b.Max.Z)));

    private static (XYZ Min, XYZ Max) Clamp((XYZ Min, XYZ Max) a, (XYZ Min, XYZ Max) b) => (
        new XYZ(Math.Max(a.Min.X, b.Min.X), Math.Max(a.Min.Y, b.Min.Y), Math.Max(a.Min.Z, b.Min.Z)),
        new XYZ(Math.Min(a.Max.X, b.Max.X), Math.Min(a.Max.Y, b.Max.Y), Math.Min(a.Max.Z, b.Max.Z)));

    private static double Volume((XYZ Min, XYZ Max) b) => (b.Max.X - b.Min.X) * (b.Max.Y - b.Min.Y) * (b.Max.Z - b.Min.Z);

    /// <summary>
    ///     Fewer outlines for the one reach query: two boxes merge when their union covers no more volume than the two
    ///     together. A merge only ever grows coverage, so nothing reach admitted is lost; the query's cost follows the
    ///     outline count (501 outlines over Chadds' host took 19.5 s). Neighbouring members' reach boxes overlap, so a
    ///     system collapses to a few boxes per straight stretch.
    ///     ponytail: O(n²) passes until stable; n is one system's members.
    /// </summary>
    internal static List<(XYZ Min, XYZ Max)> Merge(List<(XYZ Min, XYZ Max)> boxes) {
        for (var merged = true; merged;) {
            merged = false;
            for (var i = 0; i < boxes.Count; i++)
            for (var j = boxes.Count - 1; j > i; j--) {
                var union = Union(boxes[i], boxes[j]);
                if (Volume(union) > Volume(boxes[i]) + Volume(boxes[j])) continue;
                boxes[i] = union; boxes.RemoveAt(j); merged = true;
            }
        }
        return boxes;
    }

    private static BoundingBoxIntersectsFilter Intersecting((XYZ Min, XYZ Max) box) {
        using var outline = new Outline(box.Min, box.Max);
        // One float ulp covers ingest rounding at the boundary; it only broadens the candidate gate.
        var magnitude = new[] { box.Min.X, box.Min.Y, box.Min.Z, box.Max.X, box.Max.Y, box.Max.Z }.Max(Math.Abs);
        return new BoundingBoxIntersectsFilter(outline, Math.Max(1, magnitude) * Math.Pow(2, -23));
    }

    internal Aabb? SceneBounds(Element element) {
        try {
            using var bounds = element.get_BoundingBox(null);
            if (bounds is null) return null;
            using var transform = this.Transform.Multiply(bounds.Transform);
            var box = Aabb.Empty;
            foreach (var x in new[] { bounds.Min.X, bounds.Max.X })
            foreach (var y in new[] { bounds.Min.Y, bounds.Max.Y })
            foreach (var z in new[] { bounds.Min.Z, bounds.Max.Z }) {
                var point = transform.OfPoint(new XYZ(x, y, z));
                box = box.Include(new Vector3((float)point.X, (float)point.Y, (float)point.Z));
            }
            return new[] { box.MinX, box.MinY, box.MinZ, box.MaxX, box.MaxY, box.MaxZ }
                .Any(value => double.IsNaN(value) || double.IsInfinity(value))
                || box.MinX > box.MaxX || box.MinY > box.MaxY || box.MinZ > box.MaxZ ? null : box;
        } catch { return null; }
    }

    private bool InsideRegion(Element element, Aabb region) {
        try {
            using var bounds = element.get_BoundingBox(null);
            if (bounds is null) return false;
            var min = bounds.Min;
            var max = bounds.Max;
            if (min.X > max.X || min.Y > max.Y || min.Z > max.Z) return false;
            using var transform = this.Transform.Multiply(bounds.Transform);
            foreach (var x in new[] { min.X, max.X })
            foreach (var y in new[] { min.Y, max.Y })
            foreach (var z in new[] { min.Z, max.Z }) {
                var point = transform.OfPoint(new XYZ(x, y, z));
                if (!(point.X >= region.MinX && point.X <= region.MaxX
                    && point.Y >= region.MinY && point.Y <= region.MaxY
                    && point.Z >= region.MinZ && point.Z <= region.MaxZ)) return false;
            }
            return true;
        } catch { return false; }
    }

    /// <summary>Takes ownership of one triangle array and its rows, then derives the range map,
    /// the id index, and the tree. The only place any of the four is assigned.</summary>
    private void Adopt(Tri[] tris, PrimRow[] prims, bool buildIndex = true) {
        var start = new int[prims.Length + 1];
        for (var i = 0; i < prims.Length; i++) start[i + 1] = start[i] + prims[i].Triangles;

        this._tris = tris;
        this._prims = prims;
        this._start = start;
        this.Categories = prims.Select(p => p.Category).Distinct(StringComparer.OrdinalIgnoreCase)
            .OrderBy(c => c, StringComparer.OrdinalIgnoreCase).ToList();
        this.Bvh = Bvh.Build(buildIndex ? tris : []);
    }

    public Handle HandleFor(PrimRow row) => new(
        this.DocumentKey, row.ElementId, row.UniqueId, this.LinkInstanceId, row.Category, row.Kind,
        row.Layer, row.Extrusion, row.HeightRole);
}

/// <param name="Counted">Ids inside reach before any exclusion; counting loads nothing.</param>
/// <param name="Excluded">Ids inside reach per exclusion class; classes can overlap, so they need not sum.</param>
/// <param name="RejectedAfterLoad">Kept by every quick filter, then refused by <see cref="Ingest.Allowed" />: loaded for nothing.</param>
/// <param name="QueryMilliseconds">The one reach query; ExcludeMilliseconds the class queries; IterateMilliseconds the loads.</param>
internal sealed record SceneReach(int Counted, IReadOnlyList<Element> Kept, IReadOnlyDictionary<string, int> Excluded,
    int RejectedAfterLoad, double Milliseconds, double QueryMilliseconds, double ExcludeMilliseconds, double IterateMilliseconds);
