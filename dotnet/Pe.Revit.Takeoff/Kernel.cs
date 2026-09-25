namespace Pe.Revit.Takeoff;

// The pure geometry the surviving takeoff path still needs, lifted out of the raster before it was
// deleted (ADR 0011, partition-close round 3). These three were the only reason Detector.cs and
// Annotate.cs were load-bearing for ZoneMaterializer and TakeoffAtlas: sixteen files referenced
// Detector, and one of those references was a five-line shoelace.
//
// Nothing here reads a pixel. Keep it that way.
public static class Kernel
{
    // Signed area of a closed ring, model feet. Positive is CCW. Was Detector.Shoelace.
    public static double Shoelace(List<double[]> p)
    {
        double s = 0;
        int m = p.Count;
        for (int i = 0; i < m; i++)
        {
            var a = p[i];
            var b = p[(i + 1) % m];
            s += (a[0] * b[1]) - (b[0] * a[1]);
        }

        return s / 2;
    }

    // FOOTGUN: WeldFt keeps FilledRegion.Create from refusing a loop whose consecutive points are closer than
    // Revit's short-curve tolerance (1/256 ft). SpikeFt drops a vertex within that distance of the chord of its
    // neighbours: a collinear midpoint, or a spike that runs out and back along one line, which Revit reads as
    // self-intersection (Duryee L1's 719 sf room, 2026-09-25: a 0.19 ft retrace off by 1e-7 ft was refused R14).
    // Neither is a smoothing knob.
    public const double WeldFt = 0.01;
    public const double SpikeFt = 0.005;

    // The rings a FilledRegion is made from, cleaned; a hole that cleans to nothing is dropped, an outer throws.
    public static List<CurveLoop> ToLoops(List<double[]> outer, IEnumerable<List<double[]>> holes, double z = 0)
    {
        var loops = new List<CurveLoop> { ToLoop(CleanRing(outer), z) };
        loops.AddRange(holes.Select(CleanRing).Where(h => h.Count >= 3).Select(h => ToLoop(h, z)));
        return loops;
    }

    private static CurveLoop ToLoop(List<double[]> clean, double z)
    {
        if (clean.Count < 3) throw new InvalidOperationException("degenerate loop");
        var cl = new CurveLoop();
        for (int i = 0; i < clean.Count; i++)
            cl.Append(Line.CreateBound(new XYZ(clean[i][0], clean[i][1], z),
                new XYZ(clean[(i + 1) % clean.Count][0], clean[(i + 1) % clean.Count][1], z)));
        return cl;
    }

    // Pure: welds points within WeldFt (the closing point too) and drops vertices within SpikeFt of their
    // neighbours' chord, until nothing changes. Fewer than three points left is a degenerate ring.
    public static List<double[]> CleanRing(List<double[]> pts)
    {
        var ring = new List<double[]>();
        foreach (var p in pts)
            if (ring.Count == 0 || Dist(ring[^1], p) > WeldFt) ring.Add(p);
        for (bool changed = true; changed && ring.Count >= 3;)
        {
            changed = false;
            for (int i = 0; i < ring.Count && ring.Count >= 3; i++)
            {
                var a = ring[(i + ring.Count - 1) % ring.Count];
                var b = ring[i];
                var c = ring[(i + 1) % ring.Count];
                var chord = Dist(a, c);
                var off = chord <= WeldFt ? 0 : Math.Abs(((c[0] - a[0]) * (b[1] - a[1])) - ((c[1] - a[1]) * (b[0] - a[0]))) / chord;
                if (Dist(a, b) > WeldFt && off > SpikeFt) continue;
                ring.RemoveAt(i);
                changed = true;
                i--;
            }
        }
        return ring.Count >= 3 ? ring : [];
    }

    private static double Dist(double[] a, double[] b) => Math.Sqrt(((a[0] - b[0]) * (a[0] - b[0])) + ((a[1] - b[1]) * (a[1] - b[1])));
}
