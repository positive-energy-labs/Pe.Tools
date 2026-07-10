namespace Pe.Revit.Placement;

// Coarse-lattice A* router (ported from mep-solve): 4-neighbor XY at fixed elevation, bend penalty,
// soft clearance cost. Vertical moves are handled explicitly by the solver (risers), not the lattice.
internal sealed class RouteResult
{
    public bool Ok;
    public string Fail = "";
    public List<double[]> Waypoints = new List<double[]>(); // XY corners incl. exact start, exact/snapped goal
    public double SnapErrFt;
    public int Bends;
    public double LengthFt;
}

internal static class Router
{
    // Grid anchored at (ox,oy); cell centers = ox + i*cell. Start/goal snapped to nearest center;
    // cells within carve zones must be pre-cleared by the caller (occupancy value 0).
    // forceDir 0..3 (+x,-x,+y,-y) forces the first move (branch takeoffs leave the trunk perpendicular).
    public static RouteResult Route(double ox, double oy, int nx, int ny, double cell, byte[,] occ,
        double sx, double sy, double gx, double gy, double bendPenalty, int maxBends, int forceDir)
    {
        var r = new RouteResult();
        int si = (int)Math.Round((sx - ox) / cell), sj = (int)Math.Round((sy - oy) / cell);
        int gi = (int)Math.Round((gx - ox) / cell), gj = (int)Math.Round((gy - oy) / cell);
        if (si < 0 || si >= nx || sj < 0 || sj >= ny) { r.Fail = $"start ({sx:F1},{sy:F1}) outside solve region"; return r; }
        if (gi < 0 || gi >= nx || gj < 0 || gj >= ny) { r.Fail = $"goal ({gx:F1},{gy:F1}) outside solve region"; return r; }
        if (si == gi && sj == gj) { r.Fail = "start and goal are the same lattice cell"; return r; }
        if (occ[si, sj] == 2) { r.Fail = $"start ({sx:F1},{sy:F1}) sits inside an obstacle (padded)"; return r; }
        if (occ[gi, gj] == 2) { r.Fail = $"goal ({gx:F1},{gy:F1}) sits inside an obstacle (padded)"; return r; }

        int[] di = { 1, -1, 0, 0 }, dj = { 0, 0, 1, -1 };
        var open = new SortedDictionary<double, Queue<(int i, int j, int d)>>();
        void Enqueue((int i, int j, int d) state, double priority)
        {
            if (!open.TryGetValue(priority, out var bucket))
                open[priority] = bucket = new Queue<(int, int, int)>();
            bucket.Enqueue(state);
        }
        bool TryDequeue(out (int i, int j, int d) state, out double priority)
        {
            if (open.Count == 0) { state = default; priority = default; return false; }
            var first = open.First();
            priority = first.Key;
            state = first.Value.Dequeue();
            if (first.Value.Count == 0) open.Remove(first.Key);
            return true;
        }
        var gScore = new Dictionary<(int, int, int), double>();
        var parent = new Dictionary<(int, int, int), (int, int, int)>();
        double H(int i, int j) => (Math.Abs(gi - i) + Math.Abs(gj - j)) * cell;

        var start = (si, sj, 4);
        gScore[start] = 0;
        if (forceDir >= 0 && forceDir < 4)
        {
            int fi = si + di[forceDir], fj = sj + dj[forceDir];
            if (fi < 0 || fi >= nx || fj < 0 || fj >= ny || occ[fi, fj] == 2)
            { r.Fail = $"forced first move ({"+x,-x,+y,-y".Split(',')[forceDir]}) from ({sx:F1},{sy:F1}) is blocked"; return r; }
            var fs = (fi, fj, forceDir);
            gScore[fs] = cell;
            parent[fs] = start;
            Enqueue(fs, cell + H(fi, fj));
        }
        else
            Enqueue(start, H(si, sj));
        (int, int, int) goalState = default; bool found = false;
        int expansions = 0;

        while (TryDequeue(out var cur, out var pri))
        {
            var (ci, cj, cd) = cur;
            if (++expansions > 500000) { r.Fail = "search budget exceeded (500k expansions) — shrink region or coarsen gridFt"; return r; }
            double cg = gScore[cur];
            if (pri - H(ci, cj) > cg + 1e-9) continue; // stale
            if (ci == gi && cj == gj) { goalState = cur; found = true; break; }
            for (int k = 0; k < 4; k++)
            {
                if (cd < 4 && ((cd ^ 1) == k)) continue; // no immediate reversal (0<->1, 2<->3)
                int ni = ci + di[k], nj = cj + dj[k];
                if (ni < 0 || ni >= nx || nj < 0 || nj >= ny) continue;
                if (occ[ni, nj] == 2) continue;
                double step = cell
                    + (occ[ni, nj] == 1 ? cell * 3 : 0)
                    + (cd < 4 && cd != k ? bendPenalty : 0);
                var ns = (ni, nj, k);
                double ng = cg + step;
                if (gScore.TryGetValue(ns, out var old) && old <= ng + 1e-9) continue;
                gScore[ns] = ng;
                parent[ns] = cur;
                Enqueue(ns, ng + H(ni, nj));
            }
        }
        if (!found)
        {
            r.Fail = "no path on lattice";
            return r;
        }

        // reconstruct cell chain
        var cells = new List<(int i, int j)>();
        var s = goalState;
        while (true)
        {
            cells.Add((s.Item1, s.Item2));
            if (!parent.TryGetValue(s, out var p)) break;
            s = p;
        }
        cells.Reverse();

        // compress to corners
        var corners = new List<double[]> { new[] { ox + cells[0].i * cell, oy + cells[0].j * cell } };
        for (int k = 1; k < cells.Count - 1; k++)
        {
            var a = cells[k - 1]; var b = cells[k]; var c = cells[k + 1];
            if ((b.i - a.i != c.i - b.i) || (b.j - a.j != c.j - b.j))
                corners.Add(new[] { ox + b.i * cell, oy + b.j * cell });
        }
        corners.Add(new[] { ox + cells[^1].i * cell, oy + cells[^1].j * cell });

        // exact start (start cell center should already equal it when the grid is anchored on it)
        corners[0] = new[] { sx, sy };

        // goal-side nudge: shift the final straight run onto the exact goal when the
        // perpendicular offset is under half a cell (keeps stubs axis-clean).
        double offX = gx - corners[^1][0], offY = gy - corners[^1][1];
        r.SnapErrFt = Math.Sqrt(offX * offX + offY * offY);
        if (corners.Count >= 3)
        {
            var a2 = corners[^2]; var b2 = corners[^1];
            bool runAlongX = Math.Abs(b2[1] - a2[1]) < 1e-6;
            if (runAlongX && Math.Abs(offY) <= cell / 2 + 1e-6)
            { a2[1] = gy; b2[1] = gy; b2[0] = gx; r.SnapErrFt = 0; }
            else if (!runAlongX && Math.Abs(offX) <= cell / 2 + 1e-6)
            { a2[0] = gx; b2[0] = gx; b2[1] = gy; r.SnapErrFt = 0; }
            else corners.Add(new[] { gx, gy }); // rare: distinct final jog
        }
        else
        {
            corners[^1] = new[] { gx, gy }; // single run: accept slight skew, keep start exact
            r.SnapErrFt = 0;
        }

        // drop degenerate corners
        var wp = new List<double[]>();
        foreach (var c in corners)
            if (wp.Count == 0 || Math.Abs(c[0] - wp[^1][0]) > 1e-4 || Math.Abs(c[1] - wp[^1][1]) > 1e-4)
                wp.Add(c);
        // merge colinear
        for (int k = wp.Count - 2; k >= 1; k--)
        {
            double ux = wp[k][0] - wp[k - 1][0], uy = wp[k][1] - wp[k - 1][1];
            double vx = wp[k + 1][0] - wp[k][0], vy = wp[k + 1][1] - wp[k][1];
            if (Math.Abs(ux * vy - uy * vx) < 1e-6 && ux * vx + uy * vy > 0) wp.RemoveAt(k);
        }

        r.Waypoints = wp;
        r.Bends = CountBends(wp);
        for (int k = 1; k < wp.Count; k++)
            r.LengthFt += Math.Sqrt(Math.Pow(wp[k][0] - wp[k - 1][0], 2) + Math.Pow(wp[k][1] - wp[k - 1][1], 2));
        if (r.Bends > maxBends) { r.Fail = $"path needs {r.Bends} bends > maxBends {maxBends} — raise maxBends or relax constraints"; return r; }
        r.Ok = true;
        return r;
    }

    public static int CountBends(List<double[]> wp)
    {
        int bends = 0;
        for (int k = 1; k < wp.Count - 1; k++)
        {
            double ux = wp[k][0] - wp[k - 1][0], uy = wp[k][1] - wp[k - 1][1];
            double vx = wp[k + 1][0] - wp[k][0], vy = wp[k + 1][1] - wp[k][1];
            double lu = Math.Sqrt(ux * ux + uy * uy), lv = Math.Sqrt(vx * vx + vy * vy);
            if (lu < 1e-9 || lv < 1e-9) continue;
            if (Math.Abs(ux / lu * vy / lv - uy / lu * vx / lv) > 0.2) bends++;
        }
        return bends;
    }
}
