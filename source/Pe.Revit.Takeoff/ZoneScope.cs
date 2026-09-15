using NetTopologySuite.Geometries;



namespace Pe.Revit.Takeoff;

// A designer-declared partition domain: the closed loops of one Zoning Region, model feet.
// Scope law: nothing outside this loop can be claimed. The per-cell raster mask (CellMask) went with
// the heightfield in ADR 0011; the partition clips faces to the loop exactly instead.
public sealed class ZoneScope
{


    public string Name = "";
    public List<List<double[]>> Loops = new();   // outer + holes, even-odd, model ft


    internal Geometry ExactGeometry()
    {
        this.Validate();
        return Pe.Revit.Partition.Solve.GeometryOf(this.Loops.Select(loop => loop.SelectMany(point => point.Take(2)).ToArray()).ToArray());
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

    private void Validate()
    {
        if (this.Loops.Count == 0 || this.Loops.Any(loop => loop.Count < 3)
            || this.Loops.SelectMany(loop => loop).Any(point => point.Length < 2
                || double.IsNaN(point[0]) || double.IsInfinity(point[0])
                || double.IsNaN(point[1]) || double.IsInfinity(point[1])))
            throw new InvalidOperationException($"zone '{this.Name}' has no usable loops");
    }
}
