namespace Pe.Revit.Space;

/// <summary>One segment of a swept profile and what it found.</summary>
public sealed record SweepSegment(
    int Index,
    string Verdict,
    double MinGapFt,
    Handle? Nearest,
    double[]? ClosestPoint
);

public sealed record SweepAnswer(Stamp Stamp, Searched Searched, IReadOnlyList<SweepSegment> Segments, double Ms);

/// <summary>One census row. <see cref="Layer" /> is the DWG layer on a Curve2D bucket, null otherwise.</summary>
/// <summary>
///     One element's 2D footprint inside a slab: its Handle once, and its convex pieces, each a flat
///     <c>x0, y0, x1, y1, ...</c> ring of 3 to 5 points. One Handle per element rather than per piece,
///     because a knee band on project-a is 164 k pieces over 6.6 k elements.
/// </summary>
public sealed record SliceElement(Handle Handle, IReadOnlyList<double[]> Pieces);

public sealed record SliceAnswer(
    Stamp Stamp,
    Searched Searched,
    IReadOnlyList<SliceElement> Elements,
    int Pieces,
    double Ms
);

/// <summary>What a vertical probe met, and how far away it was.</summary>
public sealed record ProbeHit(Handle Handle, double DistanceFt, double Z);

/// <summary>
///     What is under and over one point. <see cref="Floor" /> and <see cref="Ceiling" /> are null when
///     nothing was hit inside the search distance, which is the honest answer for a point outside the
///     building rather than a fabricated elevation.
/// </summary>
public sealed record ProbeAnswer(
    Stamp Stamp,
    Searched Searched,
    ProbeHit? Floor,
    ProbeHit? Ceiling,
    double MaxDistanceFt,
    double Ms,
    ProbePurpose Purpose = ProbePurpose.Obstructions
);

public sealed record CensusBucket(
    SourceKind Source,
    string Category,
    PrimKind Kind,
    int Elements,
    int Triangles,
    string? Layer = null
);

public sealed record CensusTop(Handle Handle, int Triangles);

public sealed record CensusAnswer(
    Stamp Stamp,
    Searched Searched,
    IReadOnlyList<CensusBucket> Buckets,
    IReadOnlyList<CensusTop> Top,
    double Ms
);

/// <summary>
///     Original CAD curves whose existing ribbon band overlaps the requested slab. Completion means
///     the selected imports were visited; it does not mean physical openings were inventoried.
/// </summary>
public sealed record OriginalCurvesAnswer(
    Stamp Stamp,
    Searched Searched,
    IReadOnlyList<OriginalCurve> Curves,
    IReadOnlyList<CurveCaptureFailure> Failures,
    string Scope,
    double Ms
);

/// <summary>
///     The two questions the soup answers this round. Neither builds anything: a verb applies the
///     queued tracker delta to the host partition and then reads. An unbuilt world answers empty
///     with a stamp that says so.
/// </summary>
public static class Verbs {
    /// <summary>
    ///     Rereads selected host or linked CAD imports. XY rejects curves outside the box; z0..z1
    ///     selects curves through the same per-curve storey-band assumption used by ribbons.
    /// </summary>
    public static OriginalCurvesAnswer OriginalCurves(
        Document document,
        double z0,
        double z1,
        Aabb xyClip,
        Filter filter
    ) {
        if (z1 < z0) (z0, z1) = (z1, z0);
        var sw = System.Diagnostics.Stopwatch.StartNew();
        var world = SpaceWorld.Resident(document);
        world.ApplyQueued();
        var touched = world.Partitions.Where(p => filter.Wants(p.Kind)).ToList();
        var result = new List<OriginalCurve>();
        var failures = new List<CurveCaptureFailure>();
        var categories = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        int candidates = 0, examined = 0, skipped = 0;

        foreach (var partition in touched) {
            var imports = partition.Prims.Where(r => r.Kind == PrimKind.Curve2D)
                .GroupBy(r => r.ElementId).OrderBy(g => g.Key);
            var levels = new FilteredElementCollector(partition.Doc).OfClass(typeof(Level)).Cast<Level>()
                .Select(l => (l.ProjectElevation, l.Name)).ToList();
            foreach (var rows in imports) {
                var eligible = rows.Where(filter.Wants).ToList();
                if (eligible.Count == 0 || !eligible.Any(r => OverlapsXy(r.Box, xyClip))) {
                    continue;
                }
                if (partition.Doc.GetElement(rows.Key.ToElementId()) is not ImportInstance import) {
                    failures.Add(new CurveCaptureFailure([], "traversal", $"import {rows.Key} was unavailable"));
                    continue;
                }

                var curves = new List<Ingest.CapturedCurve>();
                var importFailures = new List<CurveCaptureFailure>();
                Ingest.ReadCurves(import, curves, importFailures);
                var importHandle = partition.HandleFor(eligible[0]);
                failures.AddRange(importFailures.Select(f => f with { Handle = importHandle }));
                candidates += curves.Count;
                foreach (var curve in curves) {
                    var row = eligible.FirstOrDefault(r => string.Equals(r.Layer, curve.Layer, StringComparison.OrdinalIgnoreCase));
                    if (row is null || !CurveOverlaps(curve.Points, levels, partition.Transform, z0, z1, xyClip)) {
                        skipped++;
                        continue;
                    }
                    examined++;
                    _ = categories.Add(row.Category);
                    try {
                        result.Add(ToOriginal(partition.HandleFor(row), curve, partition.Transform));
                    } catch (Exception ex) {
                        failures.Add(new CurveCaptureFailure(curve.Path, "curve-pose", ex.Message,
                            partition.HandleFor(row)));
                    }
                }
            }
        }

        sw.Stop();
        return new OriginalCurvesAnswer(
            world.StampFor(touched, filter),
            new Searched(touched.Count, categories.Count, candidates, examined, skipped),
            result, failures,
            "selected-import-curves-by-ribbon-band; not-a-physical-opening-inventory",
            Math.Round(sw.Elapsed.TotalMilliseconds, 3));
    }

    private static bool CurveOverlaps(
        IList<XYZ> points,
        IReadOnlyList<(double Z, string Name)> levels,
        Transform transform,
        double z0,
        double z1,
        Aabb clip
    ) {
        var band = Ingest.Band(levels, points);
        double minX = double.MaxValue, minY = double.MaxValue, minZ = double.MaxValue;
        double maxX = double.MinValue, maxY = double.MinValue, maxZ = double.MinValue;
        foreach (var point in points) {
            Include(point);
            Include(new XYZ(point.X, point.Y, band.TopZ));
        }
        return minX <= clip.MaxX && maxX >= clip.MinX
            && minY <= clip.MaxY && maxY >= clip.MinY
            && minZ <= z1 && maxZ >= z0;

        void Include(XYZ point) {
            var host = transform.IsIdentity ? point : transform.OfPoint(point);
            minX = Math.Min(minX, host.X); maxX = Math.Max(maxX, host.X);
            minY = Math.Min(minY, host.Y); maxY = Math.Max(maxY, host.Y);
            minZ = Math.Min(minZ, host.Z); maxZ = Math.Max(maxZ, host.Z);
        }
    }

    private static OriginalCurve ToOriginal(Handle handle, Ingest.CapturedCurve curve, Transform transform) {
        double[] Point(XYZ p) {
            var q = transform.IsIdentity ? p : transform.OfPoint(p);
            return [q.X, q.Y, q.Z];
        }
        double[] Vector(XYZ p) {
            var q = transform.IsIdentity ? p : transform.OfVector(p);
            return [q.X, q.Y, q.Z];
        }
        OriginalArc? arc = null;
        if (curve.Native is Arc a) {
            var radiusVector = transform.IsIdentity ? a.XDirection * a.Radius : transform.OfVector(a.XDirection * a.Radius);
            arc = new OriginalArc(Point(a.Center), radiusVector.GetLength(), a.IsBound,
                a.IsBound ? Point(a.GetEndPoint(0)) : null,
                a.IsBound ? Point(a.GetEndPoint(1)) : null,
                Vector(a.XDirection), Vector(a.YDirection), Vector(a.Normal),
                a.IsBound ? a.GetEndParameter(0) : null,
                a.IsBound ? a.GetEndParameter(1) : null);
        }
        return new OriginalCurve(handle, curve.Path, curve.Layer, curve.Kind,
            curve.Points.Select(Point).ToList(), arc);
    }

    /// <summary>What is in this box, by source, category, and kind, plus the ten fattest elements.</summary>
    public static CensusAnswer Census(Document document, Aabb box, Filter? filter = null) {
        filter ??= Filter.Default;
        var sw = System.Diagnostics.Stopwatch.StartNew();
        var world = SpaceWorld.Resident(document);
        world.ApplyQueued();

        var touched = world.Partitions.Where(p => filter.Wants(p.Kind)).ToList();
        var buckets = new Dictionary<(SourceKind, string, PrimKind, string?), (int Elements, int Triangles)>();
        var top = new List<CensusTop>();
        var cats = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        int candidates = 0, examined = 0, skipped = 0;

        foreach (var p in touched) {
            foreach (var row in p.Prims) {
                candidates++;
                if (!filter.Wants(row)) {
                    skipped++;
                    continue;
                }

                if (!row.Box.Overlaps(box)) {
                    skipped++;
                    continue;
                }

                examined++;
                _ = cats.Add(row.Category);
                var key = (p.Kind, row.Category, row.Kind, row.Layer);
                var cur = buckets.TryGetValue(key, out var v) ? v : (0, 0);
                buckets[key] = (cur.Item1 + 1, cur.Item2 + row.Triangles);
                top.Add(new CensusTop(p.HandleFor(row), row.Triangles));
            }
        }

        sw.Stop();
        return new CensusAnswer(
            world.StampFor(touched, filter),
            new Searched(touched.Count, cats.Count, candidates, examined, skipped),
            buckets.Select(kv => new CensusBucket(kv.Key.Item1, kv.Key.Item2, kv.Key.Item3, kv.Value.Elements,
                    kv.Value.Triangles, kv.Key.Item4))
                .OrderByDescending(b => b.Triangles).ToList(),
            top.OrderByDescending(t => t.Triangles).Take(10).ToList(),
            Math.Round(sw.Elapsed.TotalMilliseconds, 3));
    }

    /// <summary>
    ///     Does this rectangular profile fit along this polyline? Each segment is the real thing: an
    ///     oriented box of the segment's length, the profile's width across and height up, and the
    ///     gap is the exact signed distance from a triangle to that box. Negative is an overlap.
    ///     <para>
    ///         This replaced a capsule of radius half the profile diagonal, which inflated a flat
    ///         soffit clearance by the profile's corner reach — 0.27 ft on a 1.0 by 0.667 ft duct.
    ///         The capsule could never produce a false CLEAR and neither can this; the box is simply
    ///         no longer wrong about how much room is left.
    ///     </para>
    /// </summary>
    public static SweepAnswer Sweep(
        Document document,
        IReadOnlyList<XYZ> polyline,
        double widthFt,
        double heightFt,
        double clearanceFt,
        Filter? filter = null
    ) {
        filter ??= Filter.Default;
        var sw = System.Diagnostics.Stopwatch.StartNew();
        var world = SpaceWorld.Resident(document);
        world.ApplyQueued();

        var touched = world.Partitions.Where(p => filter.Wants(p.Kind)).ToList();
        var cats = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        var segments = new List<SweepSegment>();
        int candidates = 0, examined = 0, skipped = 0;

        for (var i = 0; i + 1 < polyline.Count; i++) {
            // The box is the unpadded profile. Clearance is the cap on the search and the NEAR
            // threshold, not padding on the solid: a gap is always measured to the profile itself.
            var box = Obb.FromSegment(polyline[i], polyline[i + 1], widthFt, heightFt);
            var bestGap = double.MaxValue;
            Handle? bestHandle = null;
            XYZ? bestAt = null;

            foreach (var p in touched) {
                candidates += p.Prims.Length;
                var prims = p.Prims;
                var hit = p.Bvh.ClosestToBox(
                    box, clearanceFt, pi => filter.Wants(prims[pi]), out var gap, out var at, out var ex);
                examined += ex;
                if (hit < 0) continue;

                var row = prims[p.Bvh.Triangle(hit).Prim];
                if (gap >= bestGap) continue;
                bestGap = gap;
                bestHandle = p.HandleFor(row);
                bestAt = at;
                _ = cats.Add(row.Category);
            }

            var verdict = bestHandle is null ? "CLEAR"
                : bestGap < 0 ? "HIT"
                : bestGap < clearanceFt ? "NEAR"
                : "CLEAR";
            segments.Add(new SweepSegment(
                i,
                verdict,
                bestHandle is null ? double.PositiveInfinity : Math.Round(bestGap, 6),
                bestHandle,
                bestAt is null ? null : [bestAt.X, bestAt.Y, bestAt.Z]));
        }

        sw.Stop();
        return new SweepAnswer(
            world.StampFor(touched, filter),
            new Searched(touched.Count, cats.Count, candidates, examined, skipped),
            segments,
            Math.Round(sw.Elapsed.TotalMilliseconds, 3));
    }

    /// <summary>
    ///     Every triangle overlapping the horizontal slab z0..z1, clipped to it and flattened: the
    ///     exact 2D footprint of the model at that height, per element. Sutherland-Hodgman against
    ///     the two planes, then z is dropped. A piece is convex and has 3 to 5 points because it is
    ///     one triangle cut by two parallel planes.
    ///     <para>
    ///         <paramref name="xyClip" /> rejects, it does not cut: an element whose bounds miss the
    ///         rectangle is skipped, but a surviving piece is still the whole triangle clipping and
    ///         may reach outside. Cutting in xy would emit pieces that are no longer triangle
    ///         clippings, and every consumer of this shape assumes they are.
    ///     </para>
    /// </summary>
    public static SliceAnswer Slice(
        Document document,
        double z0,
        double z1,
        Filter? filter = null,
        Aabb? xyClip = null
    ) {
        filter ??= Filter.Default;
        if (z1 < z0) (z0, z1) = (z1, z0);
        var sw = System.Diagnostics.Stopwatch.StartNew();
        var world = SpaceWorld.Resident(document);
        world.ApplyQueued();

        var touched = world.Partitions.Where(p => filter.Wants(p.Kind)).ToList();
        var cats = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        var elements = new List<SliceElement>();
        int candidates = 0, examined = 0, skipped = 0, pieces = 0;

        foreach (var p in touched) {
            var prims = p.Prims;
            var tris = p.Tris;
            var starts = p.Starts;
            for (var i = 0; i < prims.Length; i++) {
                candidates++;
                var row = prims[i];
                if (!filter.Wants(row) || row.Box.MaxZ < z0 || row.Box.MinZ > z1
                    || (xyClip is { } clip && !OverlapsXy(row.Box, clip))) {
                    skipped++;
                    continue;
                }

                List<double[]>? mine = null;
                for (var k = starts[i]; k < starts[i + 1]; k++) {
                    var t = tris[k];
                    var lo = MathF.Min(t.A.Z, MathF.Min(t.B.Z, t.C.Z));
                    var hi = MathF.Max(t.A.Z, MathF.Max(t.B.Z, t.C.Z));
                    if (hi < z0 || lo > z1) continue;
                    var ring = ClipToSlab(t, z0, z1);
                    if (ring is null) continue;
                    (mine ??= []).Add(ring);
                }

                if (mine is null) {
                    skipped++;
                    continue;
                }

                examined++;
                pieces += mine.Count;
                _ = cats.Add(row.Category);
                elements.Add(new SliceElement(p.HandleFor(row), mine));
            }
        }

        sw.Stop();
        return new SliceAnswer(
            world.StampFor(touched, filter),
            new Searched(touched.Count, cats.Count, candidates, examined, skipped),
            elements,
            pieces,
            Math.Round(sw.Elapsed.TotalMilliseconds, 3));
    }

    private static bool OverlapsXy(Aabb box, Aabb clip) =>
        box.MinX <= clip.MaxX && box.MaxX >= clip.MinX && box.MinY <= clip.MaxY && box.MaxY >= clip.MinY;

    /// <summary>Clips one triangle to z0..z1 and drops z. Null when nothing survives or the piece has
    /// no area, which is the same 2e-8 gate the slice export used.</summary>
    private static double[]? ClipToSlab(Tri t, double z0, double z1) {
        Span<Vector3> buf = stackalloc Vector3[8];
        buf[0] = t.A;
        buf[1] = t.B;
        buf[2] = t.C;
        var n = ClipPlane(buf, 3, (float)z0, true);
        if (n < 3) return null;
        n = ClipPlane(buf, n, (float)z1, false);
        if (n < 3) return null;

        var first = buf[0];
        var hasLength = false;
        for (var i = 1; i < n; i++)
            if (buf[i].X != first.X || buf[i].Y != first.Y) { hasLength = true; break; }
        if (!hasLength) return null;

        var ring = new double[n * 2];
        for (var i = 0; i < n; i++) {
            ring[i * 2] = buf[i].X;
            ring[(i * 2) + 1] = buf[i].Y;
        }

        return ring;
    }

    /// <summary>Sutherland-Hodgman against one horizontal plane, in place. Returns the new count;
    /// a triangle cut by two planes never exceeds five points, and the buffer holds eight.</summary>
    private static int ClipPlane(Span<Vector3> poly, int count, float z, bool keepAbove) {
        Span<Vector3> outp = stackalloc Vector3[8];
        var n = 0;
        for (var i = 0; i < count; i++) {
            var cur = poly[i];
            var prev = poly[(i + count - 1) % count];
            var cIn = keepAbove ? cur.Z >= z : cur.Z <= z;
            var pIn = keepAbove ? prev.Z >= z : prev.Z <= z;
            if (cIn) {
                if (!pIn) outp[n++] = Lerp(prev, cur, z);
                outp[n++] = cur;
            } else if (pIn) {
                outp[n++] = Lerp(prev, cur, z);
            }
        }

        for (var i = 0; i < n; i++) poly[i] = outp[i];
        return n;
    }

    private static Vector3 Lerp(Vector3 a, Vector3 b, float z) {
        var t = (z - a.Z) / (b.Z - a.Z);
        return new Vector3(a.X + ((b.X - a.X) * t), a.Y + ((b.Y - a.Y) * t), z);
    }

    /// <summary>
    ///     Straight down and straight up from one point: the first thing under it and the first thing
    ///     over it. This is what a headroom gate reads — floor to ceiling at a spot — and it answers
    ///     null rather than guessing when the ray leaves the model without hitting anything.
    /// </summary>
    public static ProbeAnswer Probe(
        Document document,
        XYZ at,
        Filter? filter = null,
        double maxDistanceFt = 200.0,
        ProbePurpose purpose = ProbePurpose.Obstructions
    ) {
        filter ??= Filter.Default;
        var sw = System.Diagnostics.Stopwatch.StartNew();
        var world = SpaceWorld.Resident(document);
        world.ApplyQueued();

        var touched = world.Partitions.Where(p => filter.Wants(p.Kind)).ToList();
        var cats = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        var candidates = 0;
        ProbeHit? down = null, up = null;

        foreach (var p in touched) {
            candidates += p.Prims.Length;
            var prims = p.Prims;
            bool Wants(int pi) => filter.Wants(prims[pi]);

            bool Floor(int pi) => Wants(pi) && (purpose == ProbePurpose.Obstructions
                || (prims[pi].HeightRole & HeightRole.Floor) != 0);
            bool Overhead(int pi) => Wants(pi) && (purpose == ProbePurpose.Obstructions
                || (prims[pi].HeightRole & HeightRole.Overhead) != 0);

            if (p.Bvh.FirstHitAlongRay(at, new XYZ(0, 0, -1), maxDistanceFt, Floor, out var dd, out var ti)
                && (down is null || dd < down.DistanceFt)) {
                var row = prims[p.Bvh.Triangle(ti).Prim];
                down = new ProbeHit(p.HandleFor(row), Math.Round(dd, 6), Math.Round(at.Z - dd, 6));
                _ = cats.Add(row.Category);
            }

            if (p.Bvh.FirstHitAlongRay(at, new XYZ(0, 0, 1), maxDistanceFt, Overhead, out var du, out var ui)
                && (up is null || du < up.DistanceFt)) {
                var row = prims[p.Bvh.Triangle(ui).Prim];
                up = new ProbeHit(p.HandleFor(row), Math.Round(du, 6), Math.Round(at.Z + du, 6));
                _ = cats.Add(row.Category);
            }
        }

        sw.Stop();
        // Examined counts the two answers, not the traversal: a ray reports what it found, and the
        // tree visit count is not carried out of Bvh for this verb.
        return new ProbeAnswer(
            world.StampFor(touched, filter),
            new Searched(touched.Count, cats.Count, candidates, (down is null ? 0 : 1) + (up is null ? 0 : 1), 0),
            down,
            up,
            maxDistanceFt,
            Math.Round(sw.Elapsed.TotalMilliseconds, 3), purpose);
    }
}
