namespace Pe.Revit.Takeoff;

// Detection core. THE LAW (a post-port regression made it explicit, user-caught 2026-07-06):
// INK DEFINES SHAPE; PHYSICS DEFINES EXISTENCE.
//
//   obstruction = physical-section seed ink, stud-gap-closed (GapSealFt ~1.5 ft)
//   candidate   = !obstruction & floor-present            <- boundary sources: ink + floor only
//   room        = component >= MinSqft AND ceiling-fraction >= MinCeilingFrac   <- physics GATES
//
// Room boundaries come from wall ink (straight walls -> straight contours) plus the floor edge
// (stair voids, double-height volumes — subfloor data is dense and reliable at any model stage).
// The CEILING must never shape a boundary: at framing stage it is patchy (joist gaps, tilted
// planes) and its noise eats wavy bites out of every room edge — that was the regression. It
// gates at region level instead: a region where too few cells have real headroom is open-to-sky
// (courtyard, terrace) and is dropped whole.
//
// Why this fixes the two round-2 flaws:
// - LACKING FILLS: corridor leak paths die at the floor edge (stairwell) or the region gate, so
//   corridors/halls close and fill instead of merging with "outside".
// - FUNKY CORNERS: exact cell-boundary loops are shared after wall-ink propagation, so adjacent
//   regions meet without independently simplified edges drifting apart.
public static class Detector
{
    public static TakeoffResult Detect(
        Heightfield hf, bool[] seedInk, Level level, TakeoffOptions opt, Action<string> log)
    {
        int W = hf.W, H = hf.H, n = W * H;
        double lvlZ = level.ProjectElevation;

        var obst = (bool[])seedInk.Clone();
        Close(obst, W, H, (float)(opt.GapSealFt / 2.0 / opt.CellFt));

        var open = new bool[n];
        for (int i = 0; i < n; i++)
            open[i] = !obst[i] && !float.IsNaN(hf.FloorZ[i]) && Math.Abs(hf.FloorZ[i] - lvlZ) <= opt.FloorTolFt;

        // label connected candidate regions (4-neighborhood); track border contact + ceiling stats
        var label = new int[n];
        var sizes = new List<int> { 0 };
        var ceilOkCounts = new List<int> { 0 };
        var touchesBorder = new List<bool> { false };
        var q = new Queue<int>();
        int nReg = 0;
        for (int i = 0; i < n; i++)
        {
            if (!open[i] || label[i] != 0) continue;
            nReg++; sizes.Add(0); ceilOkCounts.Add(0); touchesBorder.Add(false);
            label[i] = nReg; q.Enqueue(i);
            while (q.Count > 0)
            {
                int c = q.Dequeue(); sizes[nReg]++;
                if (!float.IsNaN(hf.CeilZ[c]) && hf.CeilZ[c] - hf.FloorZ[c] >= opt.MinHeadroomFt
                    && hf.CeilZ[c] < lvlZ + 14) ceilOkCounts[nReg]++;
                int cx = c % W, cy = c / W;
                if (cx == 0 || cy == 0 || cx == W - 1 || cy == H - 1) touchesBorder[nReg] = true;
                if (cx > 0 && open[c - 1] && label[c - 1] == 0) { label[c - 1] = nReg; q.Enqueue(c - 1); }
                if (cx < W - 1 && open[c + 1] && label[c + 1] == 0) { label[c + 1] = nReg; q.Enqueue(c + 1); }
                if (cy > 0 && open[c - W] && label[c - W] == 0) { label[c - W] = nReg; q.Enqueue(c - W); }
                if (cy < H - 1 && open[c + W] && label[c + W] == 0) { label[c + W] = nReg; q.Enqueue(c + W); }
            }
        }

        double cellArea = opt.CellFt * opt.CellFt;
        foreach (int id in Enumerable.Range(1, nReg).Where(id => sizes[id] * cellArea >= opt.MinSqft))
        {
            double ceilFrac = (double)ceilOkCounts[id] / sizes[id];
            if (!touchesBorder[id] && ceilFrac >= opt.MinCeilingFrac) continue;
            var cells = Enumerable.Range(0, n).Where(i => label[i] == id).ToList();
            double cx = cells.Average(i => hf.MinX + (i % W + 0.5) * opt.CellFt);
            double cy = cells.Average(i => hf.MinY + (i / W + 0.5) * opt.CellFt);
            log($"[detect] rejected region {id}: area={sizes[id] * cellArea:F0} centroid=({cx:F1},{cy:F1}) border={touchesBorder[id]} ceilFrac={ceilFrac:F2}");
        }
        var roomIds = Enumerable.Range(1, nReg)
            .Where(id => !touchesBorder[id]
                         && sizes[id] * cellArea >= opt.MinSqft
                         && (double)ceilOkCounts[id] / sizes[id] >= opt.MinCeilingFrac)
            .OrderByDescending(id => sizes[id])
            .ToList();
        log($"[detect] regions={nReg} candidates={roomIds.Count} (>= {opt.MinSqft} sf, ceilFrac >= {opt.MinCeilingFrac})");

        var acceptedIds = new List<int>();
        foreach (int id in roomIds)
        {
            double rasterPerimeter = RasterPerimeterCells(label, id, W, H) * opt.CellFt;
            double compactness = rasterPerimeter > 0
                ? 4 * Math.PI * sizes[id] * cellArea / (rasterPerimeter * rasterPerimeter)
                : 0;
            if (compactness < opt.MinCompactness)
                log($"[detect] rejected region {id}: compactness={compactness:F3} < {opt.MinCompactness:F3}");
            else
                acceptedIds.Add(id);
        }

        var partition = PartitionRegularizer.Propagate(
            label, acceptedIds.ToHashSet(), obst, W, H,
            (int)Math.Ceiling(opt.PartitionFillFt / opt.CellFt), out var partitionStats);
        log($"[partition] accepted={acceptedIds.Count} claimed={partitionStats.ClaimedCells * cellArea:F0}sf " +
            $"sharedEdges={partitionStats.SharedEdgeCells} unclaimedInk={partitionStats.UnclaimedInkCells}");

        var result = new TakeoffResult { LevelName = level.Name, LevelElevation = level.ProjectElevation };
        int rank = 0;
        foreach (int id in acceptedIds)
        {
            var coreCells = new List<int>();
            var cellsOf = new List<int>();
            for (int i = 0; i < n; i++)
            {
                if (label[i] == id) coreCells.Add(i);
                if (partition[i] == id) cellsOf.Add(i);
            }

            var loops = TraceLoops(cellsOf, partition, id, W, H);
            var polys = loops
                .Select(lp => lp.Select(v => new[] { hf.MinX + v.x * opt.CellFt, hf.MinY + v.y * opt.CellFt }).ToList())
                .Select(CollapseCollinear)
                .Where(p => p.Count >= 3)
                .ToList();
            if (polys.Count == 0) continue;
            int outerIdx = 0; double best = 0;
            for (int i = 0; i < polys.Count; i++) { double ar = Math.Abs(Shoelace(polys[i])); if (ar > best) { best = ar; outerIdx = i; } }
            var outer = polys[outerIdx];
            if (Shoelace(outer) < 0) outer.Reverse();

            double ceilSum = 0; int ceilN = 0;
            foreach (int c in coreCells)
                if (!float.IsNaN(hf.CeilZ[c]) && !float.IsNaN(hf.FloorZ[c])) { ceilSum += hf.CeilZ[c] - hf.FloorZ[c]; ceilN++; }

            var lp2 = PoleOfInaccessibility(coreCells, label, id, W, H);
            double perim = 0;
            for (int i = 0; i < outer.Count; i++)
            {
                var a2 = outer[i]; var b2 = outer[(i + 1) % outer.Count];
                perim += Math.Sqrt((a2[0] - b2[0]) * (a2[0] - b2[0]) + (a2[1] - b2[1]) * (a2[1] - b2[1]));
            }
            rank++;

            var room = new RoomResult {
                Id = "R" + rank.ToString("D2"),
                RawSqft = cellsOf.Count * cellArea,
                PerimeterFt = perim,
                LabelX = hf.MinX + (lp2 % W + 0.5) * opt.CellFt,
                LabelY = hf.MinY + (lp2 / W + 0.5) * opt.CellFt,
                MeanCeilingFt = ceilN > 0 ? ceilSum / ceilN : 0,
                Polygon = outer,
            };
            for (int i = 0; i < polys.Count; i++) if (i != outerIdx) room.Holes.Add(polys[i]);
            result.Rooms.Add(room);
            result.TotalSqft += room.RawSqft;
        }
        return result;
    }

    private static int RasterPerimeterCells(int[] labels, int id, int width, int height)
    {
        int edges = 0;
        for (int cell = 0; cell < labels.Length; cell++)
        {
            if (labels[cell] != id) continue;
            int x = cell % width, y = cell / width;
            if (x == 0 || labels[cell - 1] != id) edges++;
            if (x == width - 1 || labels[cell + 1] != id) edges++;
            if (y == 0 || labels[cell - width] != id) edges++;
            if (y == height - 1 || labels[cell + width] != id) edges++;
        }
        return edges;
    }

    // Diagnostic that found the 8-ft door heads: BFS from a point through non-obstruction cells;
    // if it reaches the grid border the space leaks, and the returned path shows exactly where.
    // Render it red over the grid and the failing opening is a one-glance diagnosis.
    public static List<(int x, int y)>? TraceLeak(bool[] obstruction, int W, int H, int startX, int startY)
    {
        if (startX < 0 || startY < 0 || startX >= W || startY >= H || obstruction[startY * W + startX]) return null;
        var prev = new int[W * H];
        for (int i = 0; i < prev.Length; i++) prev[i] = -1;
        var q = new Queue<int>();
        int s = startY * W + startX;
        prev[s] = s; q.Enqueue(s);
        int hit = -1;
        while (q.Count > 0 && hit < 0)
        {
            int c = q.Dequeue();
            int cx = c % W, cy = c / W;
            if (cx == 0 || cy == 0 || cx == W - 1 || cy == H - 1) { hit = c; break; }
            foreach (var d in new[] { -1, 1, -W, W })
            {
                int nb = c + d;
                if (nb < 0 || nb >= W * H || prev[nb] != -1 || obstruction[nb]) continue;
                prev[nb] = c; q.Enqueue(nb);
            }
        }
        if (hit < 0) return null; // enclosed
        var path = new List<(int, int)>();
        for (int c = hit; c != s; c = prev[c]) path.Add((c % W, c / W));
        path.Reverse();
        return path;
    }

    // ---- morphology: two-pass chamfer close (dilate r then erode r) ----
    private static void Close(bool[] mask, int W, int H, float rCells)
    {
        var d1 = Chamfer(mask, W, H, false);
        var dil = new bool[W * H];
        for (int i = 0; i < W * H; i++) dil[i] = d1[i] <= rCells + 1e-4f;
        var d2 = Chamfer(dil, W, H, true);
        for (int i = 0; i < W * H; i++) mask[i] = d2[i] > rCells - 1e-4f;
    }

    private static float[] Chamfer(bool[] mask, int W, int H, bool invert)
    {
        const float INF = 1e9f, DIAG = 1.4142f;
        var d = new float[W * H];
        for (int i = 0; i < W * H; i++) d[i] = mask[i] != invert ? 0f : INF;
        for (int y = 0; y < H; y++)
            for (int x = 0; x < W; x++)
            {
                int i = y * W + x; float v = d[i];
                if (x > 0) v = Math.Min(v, d[i - 1] + 1);
                if (y > 0) v = Math.Min(v, d[i - W] + 1);
                if (x > 0 && y > 0) v = Math.Min(v, d[i - W - 1] + DIAG);
                if (x < W - 1 && y > 0) v = Math.Min(v, d[i - W + 1] + DIAG);
                d[i] = v;
            }
        for (int y = H - 1; y >= 0; y--)
            for (int x = W - 1; x >= 0; x--)
            {
                int i = y * W + x; float v = d[i];
                if (x < W - 1) v = Math.Min(v, d[i + 1] + 1);
                if (y < H - 1) v = Math.Min(v, d[i + W] + 1);
                if (x < W - 1 && y < H - 1) v = Math.Min(v, d[i + W + 1] + DIAG);
                if (x > 0 && y < H - 1) v = Math.Min(v, d[i + W - 1] + DIAG);
                d[i] = v;
            }
        return d;
    }

    // ---- exact cell-boundary loop tracing (region on the left: outer CCW, holes CW) ----
    private static List<List<(int x, int y)>> TraceLoops(List<int> cells, int[] label, int id, int W, int H)
    {
        var edges = new Dictionary<long, List<long>>();
        void Add(int ax, int ay, int bx, int by)
        {
            long k = (long)ax << 24 | (uint)ay, e = (long)bx << 24 | (uint)by;
            if (!edges.TryGetValue(k, out var lst)) { lst = new List<long>(); edges[k] = lst; }
            lst.Add(e);
        }
        foreach (int c in cells)
        {
            int x = c % W, y = c / W;
            if (y == 0 || label[c - W] != id) Add(x, y, x + 1, y);
            if (x == W - 1 || label[c + 1] != id) Add(x + 1, y, x + 1, y + 1);
            if (y == H - 1 || label[c + W] != id) Add(x + 1, y + 1, x, y + 1);
            if (x == 0 || label[c - 1] != id) Add(x, y + 1, x, y);
        }
        var loops = new List<List<(int, int)>>();
        while (edges.Count > 0)
        {
            long start = edges.Keys.First(), cur = start;
            var loop = new List<(int, int)>();
            int pdx = 0, pdy = 0;
            while (true)
            {
                if (!edges.TryGetValue(cur, out var outs) || outs.Count == 0) break;
                long next = outs[0];
                if (outs.Count > 1)
                {
                    int bestScore = -9;
                    foreach (var cand in outs)
                    {
                        int cx = (int)(cand >> 24), cy = (int)(cand & 0xFFFFFF);
                        int sx = (int)(cur >> 24), sy = (int)(cur & 0xFFFFFF);
                        int dx = Math.Sign(cx - sx), dy = Math.Sign(cy - sy);
                        int cross = pdx * dy - pdy * dx, dot = pdx * dx + pdy * dy;
                        int score = cross > 0 ? 3 : cross == 0 && dot > 0 ? 2 : cross < 0 ? 1 : 0;
                        if (score > bestScore) { bestScore = score; next = cand; }
                    }
                }
                outs.Remove(next);
                if (outs.Count == 0) edges.Remove(cur);
                int nx = (int)(next >> 24), ny = (int)(next & 0xFFFFFF);
                int px = (int)(cur >> 24), py = (int)(cur & 0xFFFFFF);
                pdx = Math.Sign(nx - px); pdy = Math.Sign(ny - py);
                loop.Add((nx, ny));
                cur = next;
                if (cur == start) break;
            }
            if (loop.Count >= 4) loops.Add(loop);
        }
        return loops;
    }

    // ---- corner regularization ----
    // 1) collapse collinear runs; 2) find the dominant wall axis (length-weighted edge-angle
    // histogram, mod 90 deg); 3) snap near-axis edges to exact axis directions; 4) rebuild the
    // polygon by intersecting consecutive edge lines (crisp miters). Non-axis edges (true
    // diagonal walls, curved-wall tessellation) pass through untouched.
    private static List<double[]> Rectilinearize(List<double[]> pts, double cellFt)
    {
        pts = DouglasPeuckerClosed(pts, cellFt * 1.5);
        int m = pts.Count;
        if (m < 4) return pts;

        // dominant axis theta in [0, 90)
        double sx = 0, sy = 0;
        for (int i = 0; i < m; i++)
        {
            var a = pts[i]; var b = pts[(i + 1) % m];
            double dx = b[0] - a[0], dy = b[1] - a[1];
            double len = Math.Sqrt(dx * dx + dy * dy);
            if (len < 1e-9) continue;
            double ang = Math.Atan2(dy, dx) * 4; // fold mod 90deg via angle-doubling twice
            sx += len * Math.Cos(ang); sy += len * Math.Sin(ang);
        }
        double theta = Math.Atan2(sy, sx) / 4;

        // per-edge: snap direction to nearest of theta + k*90deg when within tolerance
        const double snapTolDeg = 12.0;
        var dirs = new (double dx, double dy, bool snapped)[m];
        for (int i = 0; i < m; i++)
        {
            var a = pts[i]; var b = pts[(i + 1) % m];
            double dx = b[0] - a[0], dy = b[1] - a[1];
            double len = Math.Sqrt(dx * dx + dy * dy);
            if (len < 1e-9) { dirs[i] = (1, 0, false); continue; }
            double ang = Math.Atan2(dy, dx);
            double rel = (ang - theta) / (Math.PI / 2);
            double k = Math.Round(rel);
            double devDeg = Math.Abs(rel - k) * 90;
            if (devDeg <= snapTolDeg)
            {
                double snapAng = theta + k * Math.PI / 2;
                dirs[i] = (Math.Cos(snapAng), Math.Sin(snapAng), true);
            }
            else dirs[i] = (dx / len, dy / len, false);
        }

        // merge consecutive same-direction edges, keep midpoints as line anchors
        var lines = new List<(double px, double py, double dx, double dy)>();
        int start = 0;
        while (start < m && SameDir(dirs[start], dirs[(start + m - 1) % m])) start++;
        if (start == m) start = 0;
        int idx2 = start, guard = 0;
        do
        {
            int j = idx2;
            double wx = 0, wy = 0, wl = 0;
            while (true)
            {
                var a = pts[j]; var b = pts[(j + 1) % m];
                double len = Math.Sqrt((b[0] - a[0]) * (b[0] - a[0]) + (b[1] - a[1]) * (b[1] - a[1]));
                wx += (a[0] + b[0]) / 2 * len; wy += (a[1] + b[1]) / 2 * len; wl += len;
                int nj = (j + 1) % m;
                if (nj == start || !SameDir(dirs[nj], dirs[j])) { j = nj; break; }
                j = nj;
            }
            if (wl > 1e-9) lines.Add((wx / wl, wy / wl, dirs[idx2].dx, dirs[idx2].dy));
            idx2 = j;
        } while (idx2 != start && ++guard < m + 2);

        if (lines.Count < 3) return pts;

        // intersect consecutive lines -> crisp corners; parallel neighbors get a midpoint stitch
        var outPts = new List<double[]>(lines.Count);
        for (int i = 0; i < lines.Count; i++)
        {
            var l1 = lines[i]; var l2 = lines[(i + 1) % lines.Count];
            double det = l1.dx * l2.dy - l1.dy * l2.dx;
            if (Math.Abs(det) < 1e-6)
            {
                outPts.Add(new[] { (l1.px + l2.px) / 2, (l1.py + l2.py) / 2 });
                continue;
            }
            double t = ((l2.px - l1.px) * l2.dy - (l2.py - l1.py) * l2.dx) / det;
            outPts.Add(new[] { l1.px + t * l1.dx, l1.py + t * l1.dy });
        }
        // spike guard: a miter flying far past both anchors means a degenerate tiny edge — drop it
        var cleaned = new List<double[]>();
        foreach (var p in outPts)
            if (cleaned.Count == 0 || Dist(cleaned[^1], p) > 0.05) cleaned.Add(p);
        if (cleaned.Count > 2 && Dist(cleaned[0], cleaned[^1]) <= 0.05) cleaned.RemoveAt(cleaned.Count - 1);
        return cleaned.Count >= 3 ? cleaned : pts;

        static bool SameDir((double dx, double dy, bool snapped) a, (double dx, double dy, bool snapped) b) =>
            Math.Abs(a.dx * b.dy - a.dy * b.dx) < 1e-6 && a.dx * b.dx + a.dy * b.dy > 0;
    }

    private static List<double[]> CollapseCollinear(List<double[]> pts)
    {
        var o = new List<double[]>();
        int m = pts.Count;
        for (int i = 0; i < m; i++)
        {
            var a = pts[(i + m - 1) % m]; var b = pts[i]; var c = pts[(i + 1) % m];
            double cross = (b[0] - a[0]) * (c[1] - b[1]) - (b[1] - a[1]) * (c[0] - b[0]);
            if (Math.Abs(cross) > 1e-9) o.Add(b);
        }
        return o;
    }

    private static List<double[]> DouglasPeuckerClosed(List<double[]> pts, double eps)
    {
        int m = pts.Count;
        if (m < 5) return pts;
        int i1 = 0; double bd = -1;
        for (int i = 1; i < m; i++) { double dd = Dist(pts[0], pts[i]); if (dd > bd) { bd = dd; i1 = i; } }
        var half1 = pts.GetRange(0, i1 + 1);
        var half2 = pts.GetRange(i1, m - i1); half2.Add(pts[0]);
        var r1 = Dp(half1, eps); var r2 = Dp(half2, eps);
        var o = new List<double[]>(r1); o.RemoveAt(o.Count - 1); o.AddRange(r2); o.RemoveAt(o.Count - 1);
        return o;
    }

    private static List<double[]> Dp(List<double[]> pts, double eps)
    {
        if (pts.Count < 3) return new List<double[]>(pts);
        int idx = -1; double dmax = 0;
        var a = pts[0]; var b = pts[^1];
        for (int i = 1; i < pts.Count - 1; i++)
        {
            double d = PerpDist(pts[i], a, b);
            if (d > dmax) { dmax = d; idx = i; }
        }
        if (dmax <= eps) return new List<double[]> { a, b };
        var l = Dp(pts.GetRange(0, idx + 1), eps);
        var r = Dp(pts.GetRange(idx, pts.Count - idx), eps);
        var o = new List<double[]>(l); o.RemoveAt(o.Count - 1); o.AddRange(r);
        return o;
    }

    private static double PerpDist(double[] p, double[] a, double[] b)
    {
        double dx = b[0] - a[0], dy = b[1] - a[1];
        double len = Math.Sqrt(dx * dx + dy * dy);
        if (len < 1e-12) return Dist(p, a);
        return Math.Abs((p[0] - a[0]) * dy - (p[1] - a[1]) * dx) / len;
    }

    private static double Dist(double[] a, double[] b)
    {
        double dx = a[0] - b[0], dy = a[1] - b[1];
        return Math.Sqrt(dx * dx + dy * dy);
    }

    private static double Shoelace(List<double[]> p)
    {
        double s = 0; int m = p.Count;
        for (int i = 0; i < m; i++) { var a = p[i]; var b = p[(i + 1) % m]; s += a[0] * b[1] - b[0] * a[1]; }
        return s / 2;
    }

    // chamfer distance-transform argmax inside the region = pole of inaccessibility; guaranteed
    // interior even for L-shaped rooms (a centroid is not).
    private static int PoleOfInaccessibility(List<int> cells, int[] label, int id, int W, int H)
    {
        int bx0 = W, by0 = H, bx1 = 0, by1 = 0;
        foreach (int c in cells) { int cx = c % W, cy = c / W; if (cx < bx0) bx0 = cx; if (cx > bx1) bx1 = cx; if (cy < by0) by0 = cy; if (cy > by1) by1 = cy; }
        int lw = bx1 - bx0 + 1, lh = by1 - by0 + 1;
        const float INF = 1e9f;
        var d = new float[lw * lh];
        for (int y = 0; y < lh; y++)
            for (int x = 0; x < lw; x++)
                d[y * lw + x] = label[(y + by0) * W + (x + bx0)] == id ? INF : 0f;
        for (int y = 0; y < lh; y++)
            for (int x = 0; x < lw; x++)
            {
                int i = y * lw + x; float v = d[i];
                if (v == 0) continue;
                v = Math.Min(v, x > 0 ? d[i - 1] + 1 : 0.5f);
                v = Math.Min(v, y > 0 ? d[i - lw] + 1 : 0.5f);
                if (x > 0 && y > 0) v = Math.Min(v, d[i - lw - 1] + 1.4142f);
                d[i] = v;
            }
        int bi = cells[0]; float bv = -1;
        for (int y = lh - 1; y >= 0; y--)
            for (int x = lw - 1; x >= 0; x--)
            {
                int i = y * lw + x; float v = d[i];
                if (v == 0) continue;
                v = Math.Min(v, x < lw - 1 ? d[i + 1] + 1 : 0.5f);
                v = Math.Min(v, y < lh - 1 ? d[i + lw] + 1 : 0.5f);
                if (x < lw - 1 && y < lh - 1) v = Math.Min(v, d[i + lw + 1] + 1.4142f);
                d[i] = v;
                if (v > bv) { bv = v; bi = (y + by0) * W + (x + bx0); }
            }
        return bi;
    }
}
