namespace Pe.Revit.Space;

/// <summary>
///     One source's triangles, tags, and tree. The host partition patches per element from the
///     tracker delta; a link partition never does, because a link document is not modifiable and no
///     per-element event can ever fire for its content. A link goes dirty whole and is rebuilt only
///     by an explicit Build.
///     <para>
///         There is one triangle store. Row i owns <c>_tris[_start[i] .. _start[i + 1])</c>, so a
///         patch splices ranges instead of keeping a second per-element copy of every triangle.
///     </para>
/// </summary>
internal sealed class Partition {
    private Tri[] _tris = [];
    private PrimRow[] _prims = [];
    private int[] _start = [0];

    public Partition(int source, Document doc, SourceKind kind, long? linkInstanceId, Transform transform) {
        this.Source = source;
        this.Doc = doc;
        this.Kind = kind;
        this.LinkInstanceId = linkInstanceId;
        this.Transform = transform;
        this.DocumentKey = doc.GetDocumentKey();
        this.Bvh = Bvh.Build([]);
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
        this.BuiltAtEpoch, this.Dirty, this._prims.Length, this._tris.Length, this.Skipped);

    /// <summary>The one full ingest. Never called from a verb.</summary>
    public void Build(long epoch) {
        var sink = new List<Tri>();
        var rows = new List<PrimRow>();
        this.Skipped = Ingest.Document(this.Doc, this.Source, this.Transform, sink, rows);
        // ponytail: List doubling means the sink peaks near 1.5x the final array before ToArray
        // trims it. That is transient garbage, not resident. A chunked writer would remove it.
        this.Adopt(sink.ToArray(), rows.ToArray());
        this.BuiltAtEpoch = epoch;
        this.Dirty = false;
    }

    internal void BuildElements(IEnumerable<Element> elements, long epoch, Aabb? region = null) {
        var sink = new List<Tri>();
        var rows = new List<PrimRow>();
        this.Skipped = 0;
        foreach (var element in elements) {
            if (!Ingest.Allowed(element)) continue;
            if (Ingest.Element(element, this.Source, rows.Count, sink, this.Transform, rows, includeCurves: false, region: region) == 0) this.Skipped++;
        }
        // Scene capture only clips and writes triangles; it never traverses a triangle BVH.
        this.Adopt(sink.ToArray(), rows.ToArray(), false);
        this.BuiltAtEpoch = epoch;
        this.Dirty = false;
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

    /// <summary>
    ///     Host-only incremental refresh. Deleted ids drop, added and modified ids retessellate, and
    ///     the next flat array is built by copying the untouched ranges and appending the new ones.
    ///     ponytail: the whole tree is rebuilt after every patch, and the splice holds two triangle
    ///     arrays for the length of one copy. Refit the touched nodes when that ratio starts to hurt.
    /// </summary>
    public void Patch(IEnumerable<long> added, IEnumerable<long> modified, IEnumerable<long> deleted, long epoch) {
        var touched = added.Concat(modified).Distinct().ToList();
        // One element can own several rows — a DWG import owns one per layer — so the drop set is a
        // scan by id rather than an index lookup. Patch already walks every row to splice, so this
        // costs nothing and removes the map that could only ever hold one row per element.
        var gone = new HashSet<long>(deleted.Concat(touched));
        var drop = new HashSet<int>();
        for (var i = 0; i < this._prims.Length; i++)
            if (gone.Contains(this._prims[i].ElementId)) _ = drop.Add(i);

        var keptCount = this._prims.Length - drop.Count;
        var addTris = new List<Tri>();
        var addRows = new List<PrimRow>();
        foreach (var id in touched) {
            Element? e;
            try {
                e = this.Doc.GetElement(id.ToElementId());
            } catch {
                e = null;
            }

            // A vanished or filtered-out id can only mean "no triangles here any more".
            if (e is null || !Ingest.Allowed(e) || !HasBox(e)) continue;
            _ = Ingest.Element(e, this.Source, keptCount + addRows.Count, addTris, this.Transform, addRows);
        }

        var kept = 0;
        for (var i = 0; i < this._prims.Length; i++)
            if (!drop.Contains(i)) kept += this._start[i + 1] - this._start[i];

        var nextTris = new Tri[kept + addTris.Count];
        var nextPrims = new PrimRow[keptCount + addRows.Count];
        int ti = 0, pi = 0;
        for (var i = 0; i < this._prims.Length; i++) {
            if (drop.Contains(i)) continue;
            var from = this._start[i];
            var count = this._start[i + 1] - from;
            Array.Copy(this._tris, from, nextTris, ti, count);
            // Compaction renumbers the surviving rows, so their triangles must be retagged.
            for (var k = ti; k < ti + count; k++) nextTris[k].Prim = pi;
            nextPrims[pi] = this._prims[i];
            ti += count;
            pi++;
        }

        addTris.CopyTo(nextTris, ti);
        addRows.CopyTo(nextPrims, pi);
        this.Adopt(nextTris, nextPrims);
        this.BuiltAtEpoch = epoch;
    }

    private static bool HasBox(Element e) {
        try {
            return e.get_BoundingBox(null) is not null;
        } catch {
            return false;
        }
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
