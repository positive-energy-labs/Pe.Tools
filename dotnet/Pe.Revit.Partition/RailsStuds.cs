using NetTopologySuite.Geometries;
using NetTopologySuite.Algorithm;
using Pe.Revit.Space;

namespace Pe.Revit.Partition;

/// <summary>
///     STAND-IN by W2 for W1's seam: project-a's knee has no Walls category; its IFC enclosure is
///     Structural Framing studs (1,112 elements, pieces 0.05 to 0.33 ft). A row of studs on one line
///     at stud spacing is a wall: its axis runs through the stud centres and its thickness is the stud depth.
/// </summary>
public static partial class Rails {
    // FOOTGUN: a stud's knee footprint is at most 2x8 deep; bigger framing is a post or beam, not a stud.
    private const double StudMaxFt = 0.7;

    // FOOTGUN: studs chain across this gap. 24 in on centre is 2.0 ft; a 3 ft doorway breaks the row.
    private const double StudGapFt = 2.1;

    // FOOTGUN: studs of one row sit on one line within this, and a rail needs this many studs.
    private const double StudRowFt = 0.1;
    private const int StudMin = 3;

    public static IReadOnlyList<Rail> Studs(PartitionInput input) {
        var studs = new List<(double Th, double Rho, double S, double Depth, double Half, Handle H)>();
        foreach (var e in input.Knee.Elements.Where(e => e.Handle.Kind != PrimKind.Curve2D && e.Handle.Category == "Structural Framing")) {
            var pts = e.Pieces.SelectMany(p => Enumerable.Range(0, p.Length / 2).Select(k => new Coordinate(p[2 * k], p[(2 * k) + 1]))).ToArray();
            if (pts.Length < 3) continue;
            var rect = MinimumDiameter.GetMinimumRectangle(Gf.CreateMultiPointFromCoords(pts));
            if (rect is not Polygon poly) continue;
            var c = poly.ExteriorRing.Coordinates;
            var (e0, e1) = (c[0].Distance(c[1]), c[1].Distance(c[2]));
            if (Math.Max(e0, e1) > StudMaxFt || Math.Min(e0, e1) < 0.02) continue;
            // The wall runs along the stud's narrow side.
            var (a, b) = e0 < e1 ? (c[0], c[1]) : (c[1], c[2]);
            var th = Math.Atan2(b.Y - a.Y, b.X - a.X);
            if (th < 0) th += Math.PI;
            if (th >= Math.PI - 0.01) th -= Math.PI;
            var ctr = poly.Centroid.Coordinate;
            var (cs, sn) = (Math.Cos(th), Math.Sin(th));
            studs.Add((th, (-ctr.X * sn) + (ctr.Y * cs), (ctr.X * cs) + (ctr.Y * sn), Math.Max(e0, e1), Math.Min(e0, e1) / 2, e.Handle));
        }

        var rails = new List<Rail>();
        foreach (var dir in studs.GroupBy(s => (int)Math.Round(s.Th * 180 / Math.PI) % 180)) {
            var th = dir.Average(s => s.Th);
            var (cs, sn) = (Math.Cos(th), Math.Sin(th));
            var byRho = dir.OrderBy(s => s.Rho).ToList();
            for (int i = 0, j; i < byRho.Count; i = j) {
                for (j = i + 1; j < byRho.Count && byRho[j].Rho - byRho[j - 1].Rho <= StudRowFt; j++) { }
                var row = byRho.GetRange(i, j - i).OrderBy(s => s.S).ToList();
                for (int k = 0, m; k < row.Count; k = m) {
                    for (m = k + 1; m < row.Count && row[m].S - row[m - 1].S <= StudGapFt; m++) { }
                    if (m - k < StudMin) continue;
                    var run = row.GetRange(k, m - k);
                    var rho = run.Average(s => s.Rho);
                    var (s0, s1) = (run[0].S - run[0].Half, run[^1].S + run[^1].Half);
                    rails.Add(new Rail([(s0 * cs) - (rho * sn), (s0 * sn) + (rho * cs)], [(s1 * cs) - (rho * sn), (s1 * sn) + (rho * cs)],
                        run.Select(s => s.Depth).OrderBy(d => d).ElementAt(run.Count / 2), "studs", run[0].H));
                }
            }
        }
        return rails;
    }
}
