namespace Pe.Revit.Takeoff;

/// <summary>
/// One 8-connected component of in-zone ink, plus the fact that decides whether it is structure or
/// clutter: does it weld to the zone's boundary ink ring, or does it float free inside the zone?
/// Stairs, fixtures, roof framing and site linework arrive as floating blobs; walls do not.
/// </summary>
internal sealed record InkCluster(IReadOnlyList<int> Cells, bool TouchesZoneBoundary);

/// <summary>Outcome of a raster hygiene pass: the cleaned mask and how much it cost.</summary>
public sealed record InkHygieneResult(bool[] Ink, int RemovedCells);

/// <summary>
/// Pre-solve raster hygiene: pure <c>bool[] -> bool[]</c> transforms over one zone's ink, run
/// before the partition sees it. Nothing here reads Revit or geometry — it is grid arithmetic, so
/// every rule is unit-testable against a hand-drawn synthetic raster.
/// </summary>
public static class InkHygiene
{
    /// <summary>
    /// Drops 8-connected ink clusters that float free inside the zone (never touching the zone
    /// boundary or the grid edge) and are smaller than <paramref name="minClusterCells"/>.
    /// Boundary-welded ink — the wall network — is never touched, whatever its size.
    /// </summary>
    public static InkHygieneResult RemoveFloatingClusters(
        bool[] ink,
        bool[] zoneMask,
        int w,
        int h,
        int minClusterCells)
    {
        if (minClusterCells <= 0)
            return new InkHygieneResult((bool[])ink.Clone(), 0);
        var clusters = Clusters(ink, zoneMask, w, h);
        var cleaned = (bool[])ink.Clone();
        int removed = 0;
        foreach (var cluster in clusters)
        {
            if (cluster.TouchesZoneBoundary) continue;
            if (cluster.Cells.Count >= minClusterCells) continue;
            foreach (int cell in cluster.Cells)
            {
                cleaned[cell] = false;
                removed++;
            }
        }
        return new InkHygieneResult(cleaned, removed);
    }

    /// <summary>
    /// 8-connected components of <c>ink AND zoneMask</c>. A component is marked as touching the
    /// zone boundary when any of its cells neighbours a cell outside the mask or off the grid —
    /// the same "welded to the ring" test the census and the whiteout both argue from.
    /// </summary>
    internal static List<InkCluster> Clusters(bool[] ink, bool[] zoneMask, int w, int h)
    {
        int n = w * h;
        if (ink.Length != n) throw new ArgumentException($"ink disagrees with {w}x{h}", nameof(ink));
        if (zoneMask.Length != n)
            throw new ArgumentException($"zoneMask disagrees with {w}x{h}", nameof(zoneMask));
        var seen = new bool[n];
        var clusters = new List<InkCluster>();
        var stack = new Stack<int>();
        for (int start = 0; start < n; start++)
        {
            if (seen[start] || !ink[start] || !zoneMask[start]) continue;
            seen[start] = true;
            stack.Push(start);
            var cells = new List<int>();
            bool touches = false;
            while (stack.Count > 0)
            {
                int cell = stack.Pop();
                cells.Add(cell);
                int x = cell % w, y = cell / w;
                for (int dy = -1; dy <= 1; dy++)
                for (int dx = -1; dx <= 1; dx++)
                {
                    if (dx == 0 && dy == 0) continue;
                    int nx = x + dx, ny = y + dy;
                    if (nx < 0 || nx >= w || ny < 0 || ny >= h) { touches = true; continue; }
                    int neighbor = ny * w + nx;
                    if (!zoneMask[neighbor]) { touches = true; continue; }
                    if (seen[neighbor] || !ink[neighbor]) continue;
                    seen[neighbor] = true;
                    stack.Push(neighbor);
                }
            }
            cells.Sort();
            clusters.Add(new InkCluster(cells, touches));
        }
        return clusters;
    }
}
