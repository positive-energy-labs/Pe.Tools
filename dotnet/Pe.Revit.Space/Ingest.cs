namespace Pe.Revit.Space;

/// <summary>
///     One geometry walk. Medium detail (Fine when Medium misses the body), references off, over one
///     document with one transform.
///     Transforms are applied here and nowhere else: everything downstream is host internal feet.
/// </summary>
internal static class Ingest {
    /// <summary>Managed symbol triangles for one read, keyed by native geometry identity, not family type.</summary>
    internal sealed class SymbolMeshes {
        internal readonly Dictionary<(Document, string, ViewDetailLevel), (Tri[] Triangles, bool Solid)> Entries = new();
    }
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

    private static readonly Options CoarseOpts = new() {
        DetailLevel = ViewDetailLevel.Coarse,
        ComputeReferences = false,
        IncludeNonVisibleObjects = false,
    };

    /// <summary>The retry for missing or incomplete bodies. Proven on Chadds 2026-09-26: all
    /// 4,707 pipe fittings, 72 plumbing fixtures and 50 conduit fittings have a Solid only at Fine.</summary>
    private static readonly Options FineOpts = new() {
        DetailLevel = ViewDetailLevel.Fine,
        ComputeReferences = false,
        IncludeNonVisibleObjects = false,
    };

    /// <summary>The category gate. Managed-side by design this round.
    /// ponytail: a collector-side ElementMulticategoryFilter would skip element expansion; the
    /// spike measured the managed skip at 2.2 s warm over 309 k elements, which the ingest can pay.</summary>
    public static bool Allowed(Element e) {
        var c = e.Category;
        return (!e.ViewSpecific || e is ImportInstance) && e is not SpatialElement
            && c is not null && c.CategoryType == CategoryType.Model && !Denied.Contains(c.Id.Value());
    }

    /// <summary>
    ///     Appends every row this element produces, tessellating straight into the partition's one
    ///     triangle store. A solid or mesh element produces one row, or none when it has no
    ///     geometry. A DWG import produces one row for its 3D content and one Curve2D ribbon row per
    ///     layer, so a filter can name a layer and a Handle can report one. Returns the row count.
    /// </summary>
    public static int Element(Element e, int source, int firstPrim, List<Tri> sink, Transform xf, List<PrimRow> rows,
        bool includeCurves = true, Aabb? region = null, SceneBudget? budget = null, bool coarse = false, SymbolMeshes? symbols = null) {
        var added = 0;
        var solid = Faces(e, source, firstPrim, sink, xf, region, budget, coarse, symbols);
        if (solid is not null) {
            rows.Add(solid);
            added++;
        }

        if (includeCurves && e is ImportInstance ii) added += Ribbons(ii, source, firstPrim + added, sink, xf, rows);
        return added;
    }

    /// <summary>The solid and mesh half: one row, or null when the element tessellates to nothing.</summary>
    private static PrimRow? Faces(Element e, int source, int prim, List<Tri> sink, Transform xf, Aabb? region, SceneBudget? budget, bool coarse, SymbolMeshes? symbols) {
        var start = sink.Count;
        var sawSolid = false;
        Read(e, coarse ? CoarseOpts : Opts, xf, prim, sink, ref sawSolid, region, budget, symbols);
        var box = TriangleBounds(sink, start);
        var body = sink.Count > start ? ElementBounds(e, xf) : null;
        // A cuff is a solid too. Retry when it spans less than half the body's longest axis;
        // a region-rejected solid still avoids the second walk. Keep Medium if Fine is worse or absent.
        if (!coarse && (sink.Count == start ? !sawSolid : body is { } b && b.CoverageBy(box) < 0.5)) {
            var fine = new List<Tri>();
            var fineSolid = false;
            Read(e, FineOpts, xf, prim, fine, ref fineSolid, region, budget, symbols);
            var fineBox = TriangleBounds(fine, 0);
            if (fine.Count > 0 && (sink.Count == start || body is { } full && full.CoverageBy(fineBox) > full.CoverageBy(box))) {
                sink.RemoveRange(start, sink.Count - start);
                sink.AddRange(fine);
                sawSolid = fineSolid;
                box = fineBox;
            }
        }
        var count = sink.Count - start;
        if (count == 0) return null;

        return new PrimRow(
            source,
            e.Id.Value(),
            e.UniqueId,
            e.Category?.Name ?? "<none>",
            sawSolid ? PrimKind.Solid : PrimKind.Mesh,
            box,
            count,
            HeightRole: HeightRoles.Of(e.Category?.Id.Value(), e is ImportInstance));
    }

    private static void Read(Element e, Options o, Transform xf, int prim, List<Tri> sink, ref bool sawSolid, Aabb? region, SceneBudget? budget, SymbolMeshes? symbols) {
        GeometryElement? ge;
        budget?.Geometry();
        try {
            ge = e.get_Geometry(o);
        } catch {
            return;
        }

        using (ge) {
            budget?.AfterNative();
            if (ge is not null) Walk(ge, xf, prim, sink, ref sawSolid, region, xf.HasReflection, budget, symbols, e.Document, o.DetailLevel);
        }
    }

    // Borrow symbol geometry and apply its instance transform once, without a native deep copy.
    // Joined instance-specific bodies arrive as direct Solids and keep the same path.
    // ponytail: loose curves outside a DWG import, and points, are still dropped. Only an
    // ImportInstance raises its curves into ribbons, because only there does a layer name exist.
    private static void Walk(GeometryElement ge, Transform xf, int prim, List<Tri> outp, ref bool sawSolid, Aabb? region, bool reverseWinding, SceneBudget? budget,
        SymbolMeshes? symbols, Document document, ViewDetailLevel detail) {
        // Native symbol hierarchies are acyclic; unlike copied geometry, nested symbols are not flattened.
        foreach (var go in ge) {
            using (go) switch (go) {
                case Solid s:
                    budget?.Native();
                    using (var faces = s.Faces) {
                    budget?.AfterNative();
                    if (faces.Size == 0) break;
                    sawSolid = true;
                    if (region is { } bounds && !Overlaps(s, xf, bounds)) break;
                    foreach (Face f in faces) {
                        using (f) {
                        Mesh? m;
                        budget?.Native();
                        try {
                            m = f.Triangulate();
                        } catch {
                            continue;
                        }

                        using (m) {
                            budget?.AfterNative();
                            if (m is not null) Emit(m, xf, prim, outp, reverseWinding, budget);
                        }
                        }
                    }
                    }
                    break;
                case Mesh mm:
                    Emit(mm, xf, prim, outp, reverseWinding, budget);
                    break;
                case GeometryInstance gi: {
                    using var local = gi.Transform;
                    using var toHost = xf.Multiply(local);
                    using var id = gi.GetSymbolGeometryId();
                    var key = (document, id.AsUniqueIdentifier(), detail);
                    if (symbols is not null && symbols.Entries.TryGetValue(key, out var cached)) {
                        Place(cached.Triangles, toHost, prim, outp, reverseWinding ^ local.HasReflection);
                        sawSolid |= cached.Solid;
                        break;
                    }
                    GeometryElement? inner;
                    budget?.Native();
                    try {
                        inner = gi.GetSymbolGeometry();
                    } catch {
                        continue;
                    }

                    using (inner) {
                    budget?.AfterNative();
                    if (inner is not null) {
                        if (symbols is null)
                            Walk(inner, toHost, prim, outp, ref sawSolid, region, reverseWinding ^ local.HasReflection, budget, null, document, detail);
                        else {
                            var triangles = new List<Tri>();
                            var solid = false;
                            Walk(inner, Transform.Identity, 0, triangles, ref solid, null, false, budget, symbols, document, detail);
                            var value = triangles.ToArray();
                            symbols.Entries.Add(key, (value, solid));
                            Place(value, toHost, prim, outp, reverseWinding ^ local.HasReflection);
                            sawSolid |= solid;
                        }
                    }
                    }
                    break;
                }
            }
        }
    }

    private static void Place(Tri[] triangles, Transform transform, int prim, List<Tri> sink, bool reverse) {
        Vector3 Point(Vector3 p) => P(transform, new XYZ(p.X, p.Y, p.Z));
        foreach (var t in triangles) sink.Add(new Tri {
            A = Point(t.A), B = Point(reverse ? t.C : t.B), C = Point(reverse ? t.B : t.C), Prim = prim
        });
    }

    private static Aabb? ElementBounds(Element element, Transform xf) {
        try { return element.get_BoundingBox(null) is { } bounds ? Bounds(bounds, xf) : null; }
        catch { return null; }
    }

    private static Aabb TriangleBounds(List<Tri> triangles, int start) {
        var box = Aabb.Empty;
        for (var i = start; i < triangles.Count; i++)
            box = box.Include(triangles[i].A).Include(triangles[i].B).Include(triangles[i].C);
        return box;
    }

    private static Aabb Bounds(BoundingBoxXYZ bounds, Transform transform) {
        var toHost = transform.Multiply(bounds.Transform);
        var box = Aabb.Empty;
        foreach (var x in new[] { bounds.Min.X, bounds.Max.X })
        foreach (var y in new[] { bounds.Min.Y, bounds.Max.Y })
        foreach (var z in new[] { bounds.Min.Z, bounds.Max.Z })
            box = box.Include(P(toHost, new XYZ(x, y, z)));
        return box;
    }

    private static bool Overlaps(Solid solid, Transform transform, Aabb region) {
        try {
            return Bounds(solid.GetBoundingBox(), transform).Overlaps(region);
        } catch {
            // Missing native bounds must retain the geometry, never erase context.
            return true;
        }
    }

    private static void Emit(Mesh m, Transform xf, int prim, List<Tri> outp, bool reverseWinding, SceneBudget? budget) {
        // Revit vertices are shared by triangles. Cross the native XYZ boundary once per vertex.
        budget?.Mesh(m.NumTriangles, outp.Count);
        budget?.Native();
        var vertices = m.Vertices.Select(vertex => P(xf, vertex)).ToArray();
        budget?.AfterNative();
        for (var i = 0; i < m.NumTriangles; i++) {
            var t = m.get_Triangle(i);
            var tri = new Tri {
                A = vertices[t.get_Index(0)],
                B = vertices[t.get_Index(reverseWinding ? 2 : 1)],
                C = vertices[t.get_Index(reverseWinding ? 1 : 2)],
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

        // Collected in the owning document's frame: GetInstanceGeometry already applies the import's
        // own transform, and the link transform is applied once on emit. Multiplying here is the
        // double-transform bug probe 1 hit.
        var captured = new List<CapturedCurve>();
        var failures = new List<CurveCaptureFailure>();
        var doc = ii.Document;
        ReadCurves(ii, captured, failures);
        var byLayer = captured.GroupBy(c => c.Layer, StringComparer.OrdinalIgnoreCase)
            .ToDictionary(g => g.Key, g => g.Select(c => c.Points).ToList(), StringComparer.OrdinalIgnoreCase);
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

            rows.Add(new PrimRow(
                source, ii.Id.Value(), ii.UniqueId, ii.Category?.Name ?? "<none>",
                PrimKind.Curve2D, TriangleBounds(sink, start), count, pair.Key, new Extrusion(tallest, reasons)));
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
    internal sealed record CapturedCurve(
        IReadOnlyList<int> Path,
        string Layer,
        string Kind,
        Curve? Native,
        IList<XYZ> Points
    );

    internal static void ReadCurves(
        ImportInstance import,
        List<CapturedCurve> curves,
        List<CurveCaptureFailure> failures
    ) {
        GeometryElement? geometry;
        try {
            geometry = import.get_Geometry(Opts);
        } catch (Exception ex) {
            failures.Add(new CurveCaptureFailure([], "traversal", ex.Message));
            return;
        }
        if (geometry is null) {
            failures.Add(new CurveCaptureFailure([], "traversal", "import geometry was null"));
            return;
        }
        Curves(import.Document, geometry, curves, failures, [], 0);
    }

    internal static void Curves(
        Document doc,
        GeometryElement ge,
        List<CapturedCurve> curves,
        List<CurveCaptureFailure> failures,
        IReadOnlyList<int> path,
        int depth
    ) {
        if (depth > 4) {
            failures.Add(new CurveCaptureFailure(path, "traversal", "maximum geometry depth exceeded"));
            return;
        }
        var ordinal = 0;
        foreach (var go in ge) {
            var here = path.Append(ordinal++).ToArray();
            switch (go) {
                case GeometryInstance gi: {
                    GeometryElement? inner;
                    try {
                        inner = gi.GetInstanceGeometry();
                    } catch (Exception ex) {
                        failures.Add(new CurveCaptureFailure(here, "traversal", ex.Message));
                        continue;
                    }

                    if (inner is null) failures.Add(new CurveCaptureFailure(here, "traversal", "instance geometry was null"));
                    else Curves(doc, inner, curves, failures, here, depth + 1);
                    break;
                }
                case Curve c: {
                    IList<XYZ> pts;
                    try {
                        pts = c.Tessellate();
                    } catch (Exception ex) {
                        failures.Add(new CurveCaptureFailure(here, "tessellation", ex.Message));
                        continue;
                    }

                    Add(go, c.GetType().Name, c, pts, here);
                    break;
                }
                case PolyLine pl:
                    try {
                        Add(go, nameof(PolyLine), null, pl.GetCoordinates(), here);
                    } catch (Exception ex) {
                        failures.Add(new CurveCaptureFailure(here, "tessellation", ex.Message));
                    }
                    break;
            }
        }

        void Add(GeometryObject go, string kind, Curve? native, IList<XYZ> pts, IReadOnlyList<int> at) {
            if (pts.Count < 2) {
                failures.Add(new CurveCaptureFailure(at, "tessellation", "fewer than two points"));
                return;
            }
            var layer = Layer(doc, go, out var layerFailure);
            if (layerFailure is not null) failures.Add(new CurveCaptureFailure(at, "layer", layerFailure));
            curves.Add(new CapturedCurve(at, layer, kind, native, pts));
        }
    }

    private static string Layer(Document doc, GeometryObject go, out string? failure) {
        try {
            var layer = (doc.GetElement(go.GraphicsStyleId) as GraphicsStyle)?.GraphicsStyleCategory?.Name;
            failure = layer is null ? $"graphics style {go.GraphicsStyleId} resolved no layer" : null;
            return layer ?? "<none>";
        } catch (Exception ex) {
            failure = ex.Message;
            return "<none>";
        }
    }
}
