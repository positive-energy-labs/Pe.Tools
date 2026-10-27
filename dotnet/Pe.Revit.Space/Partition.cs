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
    internal int SceneCandidates { get; private set; }

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

    internal IEnumerable<Element> SceneElements(Aabb? region) {
        using var collector = new FilteredElementCollector(this.Doc);
        collector.WhereElementIsNotElementType();
        if (region is { } bounds) {
            using var inverse = this.Transform.Inverse;
            var box = Aabb.Empty;
            foreach (var x in new[] { bounds.MinX, bounds.MaxX })
            foreach (var y in new[] { bounds.MinY, bounds.MaxY })
            foreach (var z in new[] { bounds.MinZ, bounds.MaxZ }) {
                var point = inverse.OfPoint(new XYZ(x, y, z));
                box = box.Include(new Vector3((float)point.X, (float)point.Y, (float)point.Z));
            }
            using var outline = new Outline(new XYZ(box.MinX, box.MinY, box.MinZ), new XYZ(box.MaxX, box.MaxY, box.MaxZ));
            var magnitude = new[] { box.MinX, box.MinY, box.MinZ, box.MaxX, box.MaxY, box.MaxZ }.Max(Math.Abs);
            using var filter = new BoundingBoxIntersectsFilter(outline, Math.Max(1, magnitude) * Math.Pow(2, -23));
            collector.WherePasses(filter);
            foreach (var element in collector) yield return element;
        } else foreach (var element in collector) yield return element;
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

    internal void BuildRegion(Aabb hostBounds, long epoch, IReadOnlyList<Aabb>? local = null) {
        var inverse = this.Transform.Inverse;
        var min = new XYZ(double.MaxValue, double.MaxValue, double.MaxValue);
        var max = new XYZ(double.MinValue, double.MinValue, double.MinValue);
        foreach (var x in new[] { hostBounds.MinX, hostBounds.MaxX })
        foreach (var y in new[] { hostBounds.MinY, hostBounds.MaxY })
        foreach (var z in new[] { hostBounds.MinZ, hostBounds.MaxZ }) {
            var point = inverse.OfPoint(new XYZ(x, y, z));
            min = new XYZ(Math.Min(min.X, point.X), Math.Min(min.Y, point.Y), Math.Min(min.Z, point.Z));
            max = new XYZ(Math.Max(max.X, point.X), Math.Max(max.Y, point.Y), Math.Max(max.Z, point.Z));
        }
        // The transformed enclosure is conservative for rotated links. Exact clipping stays in Scene.
        using var outline = new Outline(min, max);
        // One float ulp covers ingest rounding at the crop boundary; it only broadens the candidate gate.
        var magnitude = new[] { min.X, min.Y, min.Z, max.X, max.Y, max.Z }.Max(Math.Abs);
        using var filter = new BoundingBoxIntersectsFilter(outline, Math.Max(1, magnitude) * Math.Pow(2, -23));
        using var collector = new FilteredElementCollector(this.Doc);
        var candidates = collector.WhereElementIsNotElementType().WherePasses(filter).ToElements();
        this.SceneCandidates = candidates.Count;
        var elements = candidates.AsEnumerable();
        if (local is not null) elements = elements.Where(e => {
            try {
                if (e.get_BoundingBox(null) is not { } b) return true;
                var transform = this.Transform.Multiply(b.Transform);
                var box = Aabb.Empty;
                foreach (var x in new[] { b.Min.X, b.Max.X })
                foreach (var y in new[] { b.Min.Y, b.Max.Y })
                foreach (var z in new[] { b.Min.Z, b.Max.Z }) {
                    var p = transform.OfPoint(new XYZ(x, y, z));
                    box = box.Include(new Vector3((float)p.X, (float)p.Y, (float)p.Z));
                }
                return local.Any(scope => scope.Overlaps(box));
            } catch { return true; }
        });
        this.BuildElements(elements, epoch, hostBounds);
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
