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

    // A model-coordinate ring as a Revit CurveLoop at one elevation. Was Annotate.ToLoop.
    // FOOTGUN: the 0.01 ft weld below is what keeps FilledRegion.Create from refusing a loop whose
    // consecutive points are closer than Revit's own tolerance. It is not a smoothing knob.
    public static CurveLoop ToLoop(List<double[]> pts, double z = 0)
    {
        var clean = CleanPoints(pts, z);
        if (clean.Count < 3) throw new InvalidOperationException("degenerate loop");
        var cl = new CurveLoop();
        for (int i = 0; i < clean.Count; i++)
            cl.Append(Line.CreateBound(clean[i], clean[(i + 1) % clean.Count]));
        return cl;
    }

    // Welds points closer than 0.01 ft and drops a repeated closing point. Was Annotate.CleanPoints.
    public static List<XYZ> CleanPoints(List<double[]> pts, double z)
    {
        var clean = new List<XYZ>();
        foreach (var p in pts)
        {
            var xyz = new XYZ(p[0], p[1], z);
            if (clean.Count == 0 || clean[^1].DistanceTo(xyz) > 0.01) clean.Add(xyz);
        }

        if (clean.Count > 1 && clean[0].DistanceTo(clean[^1]) <= 0.01) clean.RemoveAt(clean.Count - 1);
        // Overlays can retrace a line within floating-point noise; Revit treats that as self-intersection.
        for (int i = 0; clean.Count > 3 && i < clean.Count; i++)
        {
            var a = clean[(i + clean.Count - 1) % clean.Count];
            var b = clean[i];
            var c = clean[(i + 1) % clean.Count];
            var chord = c - a;
            if (chord.GetLength() <= 1e-9 || chord.CrossProduct(b - a).GetLength() / chord.GetLength() > 1e-9) continue;
            clean.RemoveAt(i);
            i = -1;
        }
        return clean;
    }
}
