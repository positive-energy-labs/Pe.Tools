using NetTopologySuite.Algorithm;
using NetTopologySuite.Geometries;
using Pe.Revit.Space;

namespace Pe.Revit.Partition;

/// <summary>
///     Framing rails, behind <see cref="Knobs.FramingRails" />. project-a's IFC encloses with Structural Framing
///     studs, not Walls (1,112 elements, 766 near the ML09 zone, footprints mostly 0.13 x 0.5 ft). A stud is a
///     framing piece whose footprint is short and thin; studs on one line at stud spacing are a wall whose axis runs
///     through the stud centres and whose thickness is the stud depth. Generic Models never count: they carry
///     project-a's duplicate wall bodies and Duryee's vanities and tubs, and a stud-shaped Generic Model is still one.
/// </summary>
public static partial class Rails {
    public const string Framing = "framing";

    private static readonly string[] FramingCategories = ["Structural Framing"];

    // FOOTGUN: a stud footprint is at most 2x8 deep (0.63 ft); longer framing is a header, post or beam. project-a's
    // near-zone studs: 0.05 to 0.13 wide, 0.2 to 0.5 deep; a vanity or cabinet box is feet long and fails this.
    private const double StudMaxFt = 0.7, StudMinFt = 0.02;

    // FOOTGUN: studs of one row share an axis within this and a direction within StudRad.
    private const double StudRowFt = 0.1, StudRad = 1.0 * Math.PI / 180;

    // FOOTGUN: stud spacing. 24 in on centre is 2.0 ft and lands either side of it in float; a wider gap is an
    // opening or missing studs, and the network reads it as an opening between two rails.
    private const double StudGapFt = 2.1;

    // FOOTGUN: a row is at least this many studs, at any length. The knee cuts project-a's stud walls into short runs
    // (219 rows on live, 36 over 3 ft); a 3 ft floor scored truth symdiff 0.93 and a 2.5 ft floor 0.69, against 0.57
    // here. Short runs include jamb packs, which end a rail at a door edge. framing-rails brief, 2026-09-25.
    private const int RowMinStuds = 3;

    // FOOTGUN: a framing row lies on a wall rail when parallel within this, its axis within half the thicker of the
    // two plus 0.1 ft, and at least half its length alongside. project-a draws most stud walls in A_WALL_* as well.
    private const double CoincideRad = 3.0 * Math.PI / 180, CoincideShare = 0.5;

    public sealed record Stud(double Theta, double X, double Y, double Depth, double Width, Handle Handle);

    /// <summary>Stud footprints of framing elements: the minimum rectangle of each element's knee pieces.</summary>
    public static List<Stud> Studs(PartitionInput input) {
        var studs = new List<Stud>();
        foreach (var e in input.Knee.Elements) {
            if (e.Handle.Kind == PrimKind.Curve2D || !FramingCategories.Contains(e.Handle.Category, StringComparer.OrdinalIgnoreCase)) continue;
            var pts = e.Pieces.SelectMany(p => Enumerable.Range(0, p.Length / 2).Select(k => new Coordinate(p[2 * k], p[(2 * k) + 1]))).ToArray();
            if (pts.Length < 3 || MinimumDiameter.GetMinimumRectangle(Gf.CreateMultiPointFromCoords(pts)) is not Polygon poly) continue;
            var c = poly.ExteriorRing.Coordinates;
            var (e0, e1) = (c[0].Distance(c[1]), c[1].Distance(c[2]));
            if (Math.Max(e0, e1) > StudMaxFt || Math.Min(e0, e1) < StudMinFt) continue;
            // The wall runs along the stud's narrow side.
            var (a, b) = e0 < e1 ? (c[0], c[1]) : (c[1], c[2]);
            var th = Math.Atan2(b.Y - a.Y, b.X - a.X);
            if (th < 0) th += Math.PI;
            if (th >= Math.PI - StudRad) th -= Math.PI;
            var ctr = poly.Centroid.Coordinate;
            studs.Add(new Stud(th, ctr.X, ctr.Y, Math.Max(e0, e1), Math.Min(e0, e1), e.Handle));
        }
        return studs;
    }

    /// <summary>Rows of studs as rails: chain by direction, then axis offset, then spacing along the axis.</summary>
    public static List<Rail> StudRows(IReadOnlyList<Stud> studs) {
        var rails = new List<Rail>();
        var byAngle = studs.OrderBy(s => s.Theta).ToList();
        for (int i = 0, j; i < byAngle.Count; i = j) {
            for (j = i + 1; j < byAngle.Count && byAngle[j].Theta - byAngle[j - 1].Theta <= StudRad; j++) { }
            var dir = byAngle.GetRange(i, j - i);
            var th = dir.Average(s => s.Theta);
            var (cs, sn) = (Math.Cos(th), Math.Sin(th));
            var placed = dir.Select(s => (Rho: (-s.X * sn) + (s.Y * cs), S: (s.X * cs) + (s.Y * sn), Stud: s)).OrderBy(s => s.Rho).ToList();
            for (int r = 0, q; r < placed.Count; r = q) {
                for (q = r + 1; q < placed.Count && placed[q].Rho - placed[q - 1].Rho <= StudRowFt; q++) { }
                var row = placed.GetRange(r, q - r).OrderBy(s => s.S).ToList();
                for (int k = 0, m; k < row.Count; k = m) {
                    for (m = k + 1; m < row.Count && row[m].S - row[m - 1].S <= StudGapFt; m++) { }
                    var run = row.GetRange(k, m - k);
                    var (s0, s1) = (run[0].S - (run[0].Stud.Width / 2), run[^1].S + (run[^1].Stud.Width / 2));
                    if (run.Count < RowMinStuds) continue;
                    var rho = run.Average(s => s.Rho);
                    rails.Add(new Rail([(s0 * cs) - (rho * sn), (s0 * sn) + (rho * cs)], [(s1 * cs) - (rho * sn), (s1 * sn) + (rho * cs)],
                        run.Select(s => s.Stud.Depth).OrderBy(d => d).ElementAt(run.Count / 2), Framing, run[0].Stud.Handle));
                }
            }
        }
        return rails;
    }

    /// <summary>Framing rows that do not lie on one of <paramref name="walls" />.</summary>
    public static IEnumerable<Rail> FramingRails(PartitionInput input, IReadOnlyList<Rail> walls) =>
        StudRows(Studs(input)).Where(f => !walls.Any(w => Coincide(f, w)));

    private static bool Coincide(Rail f, Rail w) {
        var (lf, lw) = (Len(f.A, f.B), Len(w.A, w.B));
        var (ux, uy) = ((w.B[0] - w.A[0]) / lw, (w.B[1] - w.A[1]) / lw);
        if (Math.Abs(((f.B[0] - f.A[0]) * uy) - ((f.B[1] - f.A[1]) * ux)) / lf > Math.Sin(CoincideRad)) return false;
        double T(double[] p) => ((p[0] - w.A[0]) * ux) + ((p[1] - w.A[1]) * uy);
        double C(double[] p) => (-(p[0] - w.A[0]) * uy) + ((p[1] - w.A[1]) * ux);
        if (Math.Abs((C(f.A) + C(f.B)) / 2) > (Math.Max(f.ThicknessFt, w.ThicknessFt) / 2) + 0.1) return false;
        var (t0, t1) = (Math.Min(T(f.A), T(f.B)), Math.Max(T(f.A), T(f.B)));
        return Math.Min(t1, lw) - Math.Max(t0, 0) >= CoincideShare * lf;
    }
}
