using Pe.Revit.Space;

namespace Pe.Revit.Partition;

/// <summary>
///     One straight run of wall: the centerline <see cref="A" /> to <see cref="B" /> (x, y host feet)
///     between two parallel faces <see cref="ThicknessFt" /> apart. <see cref="Source" /> is
///     <see cref="Rails.Wall" /> for a Walls element's own faces or <see cref="Rails.Dwg" /> for two
///     parallel lines on a DWG wall layer; <see cref="Handle" /> is the element, or the layer row
///     of the first face.
/// </summary>
public sealed record Rail(double[] A, double[] B, double ThicknessFt, string Source, Handle Handle);

/// <summary>
///     Rails from the knee slab, pure. A rail is two parallel face lines, so a wall's own geometry
///     decides axis and thickness, a door opening in a wall leaves a gap between two rails, and a
///     bent wall yields one rail per leg. Only enclosure evidence is read: the Walls category and
///     DWG layers <c>A_WALL*</c> and <c>A_GLAZ*</c>. Generic Models, Structural Framing, Columns
///     and door or stair layers never become rails, whatever their shape.
/// </summary>
public static class Rails {
    public const string Wall = "wall";
    public const string Dwg = "dwg";

    // FOOTGUN: face spacing band. Duryee Level 1 walls measure 0.04 to 0.94 ft between faces
    // (.artifacts/runs/rails/w1/REPORT.md, per-element minimum rectangles); 0.03 keeps the
    // half-inch glazing walls and drops float-coincident duplicates, 1.25 admits a thick
    // exterior wall and refuses a room-scale pair.
    private const double MinThicknessFt = 0.03;
    private const double MaxThicknessFt = 1.25;

    // FOOTGUN: faces are parallel within this. IFC pieces are float-quantized near 300 ft from the
    // origin (Tri ponytail), which bends a 0.1 ft sliver by well under a tenth of a degree.
    private const double ParallelRad = 0.5 * Math.PI / 180;

    // FOOTGUN: two face lines are one line within this offset, and join across this gap. A
    // triangulated face repeats its edges with float noise; a DWG line is drawn in pieces.
    private const double CollinearFt = 0.01;
    private const double JoinFt = 0.05;

    // FOOTGUN: a face line shorter than this is not a wall face. project-a A_WALL_7 is 7,864
    // pieces with a 0.09 ft median, the batt-insulation zigzag between the wall lines.
    private const double MinLineFt = 0.5;

    // FOOTGUN: pairing samples each face at this pitch; a rail end lands within half of it.
    private const double StationFt = 0.1;

    // FOOTGUN: side-by-side spans merge when they overlap along at least this share of the shorter.
    // Duryee Level 1 exterior walls drew two and three parallel centerlines per element before the
    // merge (duryee-level1-rails.png, first run); a half share keeps a wall that only abuts at a
    // corner as its own rail.
    private const double SharedLengthMin = 0.5;

    private static readonly string[] WallLayers = ["A_WALL", "A_GLAZ"];

    public static IReadOnlyList<Rail> From(PartitionInput input) {
        var rails = new List<Rail>();
        var dwg = new List<(Seg Seg, Handle Handle)>();
        foreach (var e in input.Knee.Elements) {
            var faces = e.Pieces.SelectMany(Segments).Select(s => (s, e.Handle)).ToList();
            if (e.Handle.Kind == PrimKind.Curve2D) {
                if (e.Handle.Layer is { } layer && WallLayers.Any(p => layer.StartsWith(p, StringComparison.OrdinalIgnoreCase)))
                    dwg.AddRange(faces);
            } else if (string.Equals(e.Handle.Category, "Walls", StringComparison.OrdinalIgnoreCase)) {
                rails.AddRange(Pair(faces, Wall));
            }
        }
        rails.AddRange(Pair(dwg, Dwg));
        return rails;
    }

    private readonly record struct Seg(double X0, double Y0, double X1, double Y1);

    private sealed record Line(double C, double T0, double T1, Handle Handle);

    /// <summary>A collinear piece is one segment, its two farthest points; any other piece is its edges.</summary>
    private static IEnumerable<Seg> Segments(double[] xy) {
        var n = xy.Length / 2;
        var (a, b, far) = (0, 0, -1.0);
        for (var i = 0; i < n; i++)
            for (var j = i + 1; j < n; j++) {
                var d = Math.Pow(xy[2 * i] - xy[2 * j], 2) + Math.Pow(xy[(2 * i) + 1] - xy[(2 * j) + 1], 2);
                if (d > far) (a, b, far) = (i, j, d);
            }
        if (far < 1e-8) yield break;
        var len = Math.Sqrt(far);
        var flat = true;
        for (var k = 0; k < n && flat; k++) {
            var cross = ((xy[2 * b] - xy[2 * a]) * (xy[(2 * k) + 1] - xy[(2 * a) + 1]))
                - ((xy[(2 * b) + 1] - xy[(2 * a) + 1]) * (xy[2 * k] - xy[2 * a]));
            flat = Math.Abs(cross) / len < CollinearFt;
        }
        if (flat) {
            yield return new Seg(xy[2 * a], xy[(2 * a) + 1], xy[2 * b], xy[(2 * b) + 1]);
            yield break;
        }
        for (var i = 0; i < n; i++) {
            var j = (i + 1) % n;
            yield return new Seg(xy[2 * i], xy[(2 * i) + 1], xy[2 * j], xy[(2 * j) + 1]);
        }
    }

    /// <summary>Group by direction, merge collinear pieces into lines, then pair each line with its nearest parallel neighbor.</summary>
    private static IEnumerable<Rail> Pair(List<(Seg Seg, Handle Handle)> segs, string source) {
        double Angle(Seg s) {
            var t = Math.Atan2(s.Y1 - s.Y0, s.X1 - s.X0);
            if (t < 0) t += Math.PI;
            return t >= Math.PI - ParallelRad ? t - Math.PI : t;
        }
        var sorted = segs.Where(s => Math.Abs(s.Seg.X1 - s.Seg.X0) + Math.Abs(s.Seg.Y1 - s.Seg.Y0) > 1e-6)
            .Select(s => (s.Seg, s.Handle, Angle: Angle(s.Seg))).OrderBy(s => s.Angle).ToList();
        var start = 0;
        for (var i = 1; i <= sorted.Count; i++) {
            if (i < sorted.Count && sorted[i].Angle - sorted[i - 1].Angle <= ParallelRad) continue;
            var group = sorted.GetRange(start, i - start);
            start = i;
            var lengths = group.Select(g => Math.Sqrt(Math.Pow(g.Seg.X1 - g.Seg.X0, 2) + Math.Pow(g.Seg.Y1 - g.Seg.Y0, 2))).ToList();
            var theta = group.Select((g, k) => g.Angle * lengths[k]).Sum() / lengths.Sum();
            var (dx, dy) = (Math.Cos(theta), Math.Sin(theta));
            foreach (var rail in PairParallel(group.Select(g => (g.Seg, g.Handle)).ToList(), dx, dy, source))
                yield return rail;
        }
    }

    private static IEnumerable<Rail> PairParallel(List<(Seg Seg, Handle Handle)> group, double dx, double dy, string source) {
        var projected = group.Select(g => {
            double T(double x, double y) => (x * dx) + (y * dy);
            double C(double x, double y) => (-x * dy) + (y * dx);
            var (t0, t1) = (T(g.Seg.X0, g.Seg.Y0), T(g.Seg.X1, g.Seg.Y1));
            return new Line((C(g.Seg.X0, g.Seg.Y0) + C(g.Seg.X1, g.Seg.Y1)) / 2, Math.Min(t0, t1), Math.Max(t0, t1), g.Handle);
        }).OrderBy(l => l.C).ToList();

        // Collinear merge: offset runs within CollinearFt, then interval union within JoinFt.
        var lines = new List<Line>();
        var from = 0;
        for (var i = 1; i <= projected.Count; i++) {
            if (i < projected.Count && projected[i].C - projected[i - 1].C <= CollinearFt) continue;
            var run = projected.GetRange(from, i - from).OrderBy(l => l.T0).ToList();
            from = i;
            var c = run.Average(l => l.C);
            var current = run[0] with { C = c };
            foreach (var l in run.Skip(1)) {
                if (l.T0 <= current.T1 + JoinFt) {
                    current = current with { T1 = Math.Max(current.T1, l.T1) };
                    continue;
                }
                lines.Add(current);
                current = l with { C = c };
            }
            lines.Add(current);
        }
        lines = lines.Where(l => l.T1 - l.T0 >= MinLineFt).OrderBy(l => l.C).ToList();

        // Each station on a line pairs with the nearest line on its + side that also spans it, so a
        // pairing is mutual by construction; runs of one partner become one span.
        var spans = new List<Span>();
        for (var i = 0; i < lines.Count; i++) {
            var a = lines[i];
            var n = Math.Max(1, (int)Math.Ceiling((a.T1 - a.T0) / StationFt));
            var step = (a.T1 - a.T0) / n;
            var (partner, runStart) = (-1, 0);
            for (var k = 0; k <= n; k++) {
                var found = -1;
                if (k < n) {
                    var t = a.T0 + ((k + 0.5) * step);
                    for (var j = i + 1; j < lines.Count && lines[j].C - a.C <= MaxThicknessFt; j++)
                        if (lines[j].C - a.C >= MinThicknessFt && lines[j].T0 <= t && t <= lines[j].T1) { found = j; break; }
                }
                if (found == partner) continue;
                if (partner >= 0) {
                    var b = lines[partner];
                    var t0 = Math.Max(runStart == 0 ? a.T0 : a.T0 + (runStart * step), b.T0);
                    var t1 = Math.Min(k == n ? a.T1 : a.T0 + (k * step), b.T1);
                    if (t1 - t0 >= Math.Max(MinLineFt, b.C - a.C)) spans.Add(new Span(a.C, b.C, t0, t1, a.Handle));
                }
                (partner, runStart) = (found, k);
            }
        }

        // A layered wall draws a face per layer, so its layers pair into side-by-side spans. Spans
        // that touch across a face and share most of their length are one wall.
        for (var merged = true; merged;) {
            merged = false;
            for (var i = 0; i < spans.Count && !merged; i++)
                for (var j = i + 1; j < spans.Count && !merged; j++) {
                    var (p, q) = (spans[i], spans[j]);
                    if (p.C0 > q.C1 + CollinearFt || q.C0 > p.C1 + CollinearFt) continue;
                    var overlap = Math.Min(p.T1, q.T1) - Math.Max(p.T0, q.T0);
                    if (overlap < SharedLengthMin * Math.Min(p.T1 - p.T0, q.T1 - q.T0)) continue;
                    if (Math.Max(p.C1, q.C1) - Math.Min(p.C0, q.C0) > MaxThicknessFt) continue;
                    spans[i] = new Span(Math.Min(p.C0, q.C0), Math.Max(p.C1, q.C1), Math.Min(p.T0, q.T0), Math.Max(p.T1, q.T1),
                        p.C0 <= q.C0 ? p.Handle : q.Handle);
                    spans.RemoveAt(j);
                    merged = true;
                }
        }

        foreach (var s in spans) {
            var c = (s.C0 + s.C1) / 2;
            yield return new Rail([(s.T0 * dx) - (c * dy), (s.T0 * dy) + (c * dx)], [(s.T1 * dx) - (c * dy), (s.T1 * dy) + (c * dx)],
                s.C1 - s.C0, source, s.Handle);
        }
    }

    private sealed record Span(double C0, double C1, double T0, double T1, Handle Handle);
}
