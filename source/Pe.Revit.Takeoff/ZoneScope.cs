namespace Pe.Revit.Takeoff;

// A designer-declared partition domain: the closed loops of one Zoning Region, model feet.
// Scope law: the detector never claims geometry outside this mask — roofs, other levels, site,
// and linked-model noise are excluded by declaration, not inference.
public sealed class ZoneScope
{
    public string Name = "";
    public List<List<double[]>> Loops = new();   // outer + holes, even-odd, model ft

    // Per-cell mask on a snapshot grid: even-odd containment of each cell center.
    public bool[] CellMask(Heightfield hf)
    {
        if (this.Loops.Count == 0 || this.Loops.Any(l => l.Count < 3))
            throw new InvalidOperationException($"zone '{this.Name}' has no usable loops");
        double minX = double.MaxValue, minY = double.MaxValue, maxX = double.MinValue, maxY = double.MinValue;
        foreach (var loop in this.Loops)
        foreach (var p in loop)
        {
            if (p[0] < minX) minX = p[0];
            if (p[0] > maxX) maxX = p[0];
            if (p[1] < minY) minY = p[1];
            if (p[1] > maxY) maxY = p[1];
        }
        int W = hf.W, H = hf.H;
        var mask = new bool[W * H];
        int x0 = Math.Max(0, (int)Math.Floor((minX - hf.MinX) / hf.CellFt));
        int x1 = Math.Min(W - 1, (int)Math.Ceiling((maxX - hf.MinX) / hf.CellFt));
        int y0 = Math.Max(0, (int)Math.Floor((minY - hf.MinY) / hf.CellFt));
        int y1 = Math.Min(H - 1, (int)Math.Ceiling((maxY - hf.MinY) / hf.CellFt));
        for (int y = y0; y <= y1; y++)
        {
            double cy = hf.MinY + (y + 0.5) * hf.CellFt;
            for (int x = x0; x <= x1; x++)
            {
                double cx = hf.MinX + (x + 0.5) * hf.CellFt;
                if (ContainsEvenOdd(this.Loops, cx, cy)) mask[y * W + x] = true;
            }
        }
        return mask;
    }

    // Even-odd over ALL loops together: holes flip parity without needing orientation metadata.
    public static bool ContainsEvenOdd(List<List<double[]>> loops, double x, double y)
    {
        bool inside = false;
        foreach (var loop in loops)
        {
            int m = loop.Count;
            for (int i = 0, j = m - 1; i < m; j = i++)
            {
                double xi = loop[i][0], yi = loop[i][1], xj = loop[j][0], yj = loop[j][1];
                if (yi > y != yj > y && x < (xj - xi) * (y - yi) / (yj - yi) + xi)
                    inside = !inside;
            }
        }
        return inside;
    }
}
