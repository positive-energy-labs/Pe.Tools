namespace Pe.Revit.Space;

/// <summary>
///     One geometry walk. Medium detail, references off, over one document with one transform.
///     Transforms are applied here and nowhere else: everything downstream is host internal feet.
/// </summary>
internal static class Ingest {
    /// <summary>Model categories that carry no obstacle geometry but poison the world AABB.
    /// Proven on projectA: four 3D view crop boxes stretch host X across 13,860 ft.</summary>
    private static readonly HashSet<long> Denied = [
        (long)BuiltInCategory.OST_DuctSystem,
        (long)BuiltInCategory.OST_PipingSystem,
        (long)BuiltInCategory.OST_ElectricalCircuit,
        (long)BuiltInCategory.OST_SwitchSystem,
        (long)BuiltInCategory.OST_Cameras,
        (long)BuiltInCategory.OST_Schedules,
        (long)BuiltInCategory.OST_Sheets,
    ];

    private static readonly Options Opts = new() {
        DetailLevel = ViewDetailLevel.Medium,
        ComputeReferences = false,
        IncludeNonVisibleObjects = false,
    };

    /// <summary>The category gate. Managed-side by design this round.
    /// ponytail: a collector-side ElementMulticategoryFilter would skip element expansion; the
    /// spike measured the managed skip at 2.2 s warm over 309 k elements, which the ingest can pay.</summary>
    public static bool Allowed(Element e) {
        var c = e.Category;
        return !e.ViewSpecific && e is not SpatialElement
            && c is not null && c.CategoryType == CategoryType.Model && !Denied.Contains(c.Id.Value());
    }

    /// <summary>
    ///     Appends every row this element produces, tessellating straight into the partition's one
    ///     triangle store. A solid or mesh element produces one row, or none when it has no
    ///     geometry. A DWG import produces one row for its 3D content and one Curve2D ribbon row per
    ///     layer, so a filter can name a layer and a Handle can report one. Returns the row count.
    /// </summary>
    public static int Element(Element e, int source, int firstPrim, List<Tri> sink, Transform xf, List<PrimRow> rows) {
        var added = 0;
        var solid = Faces(e, source, firstPrim, sink, xf);
        if (solid is not null) {
            rows.Add(solid);
            added++;
        }

        if (e is ImportInstance ii) added += Ribbons(ii, source, firstPrim + added, sink, xf, rows);
        return added;
    }

    /// <summary>The solid and mesh half: one row, or null when the element tessellates to nothing.</summary>
    private static PrimRow? Faces(Element e, int source, int prim, List<Tri> sink, Transform xf) {
        GeometryElement? ge;
        try {
            ge = e.get_Geometry(Opts);
        } catch {
            return null;
        }

        if (ge is null) return null;

        var start = sink.Count;
        var sawSolid = false;
        Walk(ge, xf, prim, sink, ref sawSolid, 0);
        var count = sink.Count - start;
        if (count == 0) return null;

        var box = Aabb.Empty;
        for (var i = start; i < sink.Count; i++) {
            var t = sink[i];
            box = box.Include(t.A).Include(t.B).Include(t.C);
        }

        return new PrimRow(
            source,
            e.Id.Value(),
            e.UniqueId,
            e.Category?.Name ?? "<none>",
            sawSolid ? PrimKind.Solid : PrimKind.Mesh,
            box,
            count,
            HeightRole: e.Category?.ToBuiltInCategory() switch {
                BuiltInCategory.OST_Floors => HeightRole.Floor | HeightRole.Overhead,
                BuiltInCategory.OST_Ceilings or BuiltInCategory.OST_Roofs => HeightRole.Overhead,
                _ => HeightRole.None
            });
    }

    /// <summary>
    ///     Walks a whole document into one triangle sink and one row list, in step. Row i owns the
    ///     triangles appended while it was being read, which is what makes the range map possible.
    ///     Returns the count of elements that produced nothing.
    /// </summary>
    public static int Document(Document doc, int source, Transform xf, List<Tri> sink, List<PrimRow> rows) {
        var skipped = 0;
        foreach (var e in new FilteredElementCollector(doc).WhereElementIsNotElementType()) {
            if (!Allowed(e)) {
                skipped++;
                continue;
            }

            if (Element(e, source, rows.Count, sink, xf, rows) == 0) skipped++;
        }

        return skipped;
    }

    // Solid faces triangulate to Solid; loose Mesh objects stay Mesh. GetInstanceGeometry already
    // composes the instance transform onto the geometry, so the link transform passes down unchanged
    // — multiplying again is the double-transform bug probe 1 hit.
    // ponytail: loose curves outside a DWG import, and points, are still dropped. Only an
    // ImportInstance raises its curves into ribbons, because only there does a layer name exist.
    private static void Walk(GeometryElement ge, Transform xf, int prim, List<Tri> outp, ref bool sawSolid, int depth) {
        if (depth > 4) return;
        foreach (var go in ge) {
            switch (go) {
                case Solid s when s.Faces.Size > 0:
                    sawSolid = true;
                    foreach (Face f in s.Faces) {
                        Mesh? m;
                        try {
                            m = f.Triangulate();
                        } catch {
                            continue;
                        }

                        if (m is not null) Emit(m, xf, prim, outp);
                    }

                    break;
                case Mesh mm:
                    Emit(mm, xf, prim, outp);
                    break;
                case GeometryInstance gi: {
                    GeometryElement? inner;
                    try {
                        inner = gi.GetInstanceGeometry();
                    } catch {
                        continue;
                    }

                    if (inner is not null) Walk(inner, xf, prim, outp, ref sawSolid, depth + 1);
                    break;
                }
            }
        }
    }

    private static void Emit(Mesh m, Transform xf, int prim, List<Tri> outp) {
        for (var i = 0; i < m.NumTriangles; i++) {
            var t = m.get_Triangle(i);
            var tri = new Tri {
                A = P(xf, t.get_Vertex(0)),
                B = P(xf, t.get_Vertex(1)),
                C = P(xf, t.get_Vertex(2)),
                Prim = prim,
            };
            if (!tri.IsDegenerate) outp.Add(tri);
        }
    }

    private static Vector3 P(Transform xf, XYZ v) {
        var p = xf.IsIdentity ? v : xf.OfPoint(v);
        return new Vector3((float)p.X, (float)p.Y, (float)p.Z);
    }

    /// <summary>
    ///     Raises a DWG import's 2D curves into vertical ribbons, one row per layer. Each curve is
    ///     tessellated to a polyline and every edge becomes a quad from the curve up to the storey
    ///     top, which is two triangles. The height is an assumption and travels with the row.
    ///     <para>
    ///         View-specific imports are skipped outright: those are the boneyard drafting sheets,
    ///         which sit in a view's own coordinate space and mean nothing in the model.
    ///     </para>
    /// </summary>
    private static int Ribbons(
        ImportInstance ii,
        int source,
        int firstPrim,
        List<Tri> sink,
        Transform xf,
        List<PrimRow> rows
    ) {
        if (ii.ViewSpecific) return 0;

        GeometryElement? ge;
        try {
            ge = ii.get_Geometry(Opts);
        } catch {
            return 0;
        }

        if (ge is null) return 0;

        // Collected in the owning document's frame: GetInstanceGeometry already applies the import's
        // own transform, and the link transform is applied once on emit. Multiplying here is the
        // double-transform bug probe 1 hit.
        var byLayer = new Dictionary<string, List<IList<XYZ>>>(StringComparer.OrdinalIgnoreCase);
        var doc = ii.Document;
        Curves(doc, ge, byLayer, 0);
        if (byLayer.Count == 0) return 0;

        var levels = new FilteredElementCollector(doc).OfClass(typeof(Level)).Cast<Level>()
            .Select(l => (l.ProjectElevation, l.Name)).ToList();
        var added = 0;
        foreach (var pair in byLayer.OrderBy(kv => kv.Key, StringComparer.OrdinalIgnoreCase)) {
            var prim = firstPrim + added;
            var start = sink.Count;
            var reasons = new List<string>();
            var tallest = 0.0;
            void Note(string r) { if (!reasons.Contains(r)) reasons.Add(r); }

            foreach (var poly in pair.Value) {
                var band = Band(levels, poly);
                Note(band.Reason);
                if (band.Span > 1.0) Note($"non-flat polyline, z span {band.Span:F2} ft");
                if (band.Height > tallest) tallest = band.Height;
                for (var i = 0; i + 1 < poly.Count; i++) {
                    var a = poly[i];
                    var b = poly[i + 1];
                    if (Math.Abs(a.X - b.X) < 1e-7 && Math.Abs(a.Y - b.Y) < 1e-7) continue;
                    var pa = P(xf, a);
                    var pb = P(xf, b);
                    var qa = P(xf, new XYZ(a.X, a.Y, band.TopZ));
                    var qb = P(xf, new XYZ(b.X, b.Y, band.TopZ));
                    var t1 = new Tri { A = pa, B = pb, C = qb, Prim = prim };
                    var t2 = new Tri { A = pa, B = qb, C = qa, Prim = prim };
                    if (!t1.IsDegenerate) sink.Add(t1);
                    if (!t2.IsDegenerate) sink.Add(t2);
                }
            }

            var count = sink.Count - start;
            if (count == 0) continue;

            var box = Aabb.Empty;
            for (var i = start; i < sink.Count; i++) {
                var t = sink[i];
                box = box.Include(t.A).Include(t.B).Include(t.C);
            }

            rows.Add(new PrimRow(
                source, ii.Id.Value(), ii.UniqueId, ii.Category?.Name ?? "<none>",
                PrimKind.Curve2D, box, count, pair.Key, new Extrusion(tallest, reasons)));
            added++;
        }

        return added;
    }

    /// <summary>
    ///     The storey band one polyline sits in: its own lowest point up to the first level strictly
    ///     above, or ten feet when it is above the top one. Per polyline, not per import: a site plan
    ///     holds contours at a hundred elevations and one base z for all of them ribbons most from
    ///     the wrong floor. Takes elevations, not Levels, so the arithmetic checks without a document.
    /// </summary>
    public static (double TopZ, double Height, double Span, string Reason) Band(
        IReadOnlyList<(double Z, string Name)> levels, IList<XYZ> poly) {
        const double Tol = 0.01;
        double lo = double.MaxValue, hi = double.MinValue;
        foreach (var p in poly) {
            lo = Math.Min(lo, p.Z);
            hi = Math.Max(hi, p.Z);
        }

        // A polyline sits on its level, so a level at the plane is "below" and must not be the top.
        (double Z, string Name)? below = null, above = null;
        foreach (var l in levels) {
            if (l.Z <= lo + Tol) {
                if (below is null || l.Z > below.Value.Z) below = l;
            } else if (above is null || l.Z < above.Value.Z) {
                above = l;
            }
        }

        var span = hi - lo;
        if (above is null || above.Value.Z - lo < 0.1)
            return (lo + 10.0, 10.0, span, "no level above; 10 ft assumed");
        return (above.Value.Z, above.Value.Z - lo, span,
            $"storey band assumed: {below?.Name ?? "DWG plane"} to {above.Value.Name}");
    }

    /// <summary>
    ///     Every Line, Arc, PolyLine, Ellipse and NurbSpline under the import, tessellated and
    ///     grouped by the GraphicsStyle category name, which is the DWG layer.
    ///     ponytail: a closed polyline is taken exactly as Revit hands it over. No closing edge is
    ///     synthesised, so a shape Revit does not close stays open and its ribbon has a seam.
    /// </summary>
    private static void Curves(
        Document doc,
        GeometryElement ge,
        Dictionary<string, List<IList<XYZ>>> byLayer,
        int depth
    ) {
        if (depth > 4) return;
        foreach (var go in ge) {
            switch (go) {
                case GeometryInstance gi: {
                    GeometryElement? inner;
                    try {
                        inner = gi.GetInstanceGeometry();
                    } catch {
                        continue;
                    }

                    if (inner is not null) Curves(doc, inner, byLayer, depth + 1);
                    break;
                }
                case Curve c: {
                    IList<XYZ> pts;
                    try {
                        pts = c.Tessellate();
                    } catch {
                        continue;
                    }

                    Add(Layer(doc, go), pts);
                    break;
                }
                case PolyLine pl:
                    Add(Layer(doc, go), pl.GetCoordinates());
                    break;
            }
        }

        void Add(string layer, IList<XYZ> pts) {
            if (pts.Count < 2) return;
            if (!byLayer.TryGetValue(layer, out var list)) byLayer[layer] = list = [];
            list.Add(pts);
        }
    }

    private static string Layer(Document doc, GeometryObject go) {
        try {
            return (doc.GetElement(go.GraphicsStyleId) as GraphicsStyle)?.GraphicsStyleCategory?.Name
                ?? "<none>";
        } catch {
            return "<none>";
        }
    }
}
