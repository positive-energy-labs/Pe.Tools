namespace HistoricalF970;

// Detector from f970088. Compatibility edits are limited to replacing Autodesk Revit Level with
// replay-carried name/elevation and returning the closed obstruction raster for /runs evidence.
internal static class Detector
{
    internal static Detection Detect(
        Heightfield hf, bool[] seedInk, string levelName, double levelElevation,
        TakeoffOptions opt, Action<string> log)
    {
        int W = hf.W, H = hf.H, n = W * H;
        double lvlZ = levelElevation;

        var obst = (bool[])seedInk.Clone();
        Close(obst, W, H, (float)(opt.GapSealFt / 2.0 / opt.CellFt));

        var open = new bool[n];
        for (int i = 0; i < n; i++)
            open[i] = !obst[i] && !float.IsNaN(hf.FloorZ[i]) && Math.Abs(hf.FloorZ[i] - lvlZ) <= opt.FloorTolFt;

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

        var partition = Pe.Revit.Takeoff.PartitionRegularizer.Propagate(
            label, acceptedIds.ToHashSet(), obst, W, H,
            (int)Math.Ceiling(opt.PartitionFillFt / opt.CellFt),
            (int)Math.Floor(opt.MaxEnclosedResidualSqft / cellArea), out var partitionStats);
        log($"[partition] accepted={acceptedIds.Count} claimed={partitionStats.ClaimedCells * cellArea:F0}sf " +
            $"resolvedEnclosed={partitionStats.ResolvedEnclosedCells * cellArea:F0}sf " +
            $"sharedEdges={partitionStats.SharedEdgeCells} unclaimedInk={partitionStats.UnclaimedInkCells}");

        var result = new TakeoffResult { LevelName = levelName, LevelElevation = levelElevation };
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
        return new Detection(result, obst);
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

    private static List<double[]> CollapseCollinear(List<double[]> pts)
    {
        var output = new List<double[]>();
        int count = pts.Count;
        for (int i = 0; i < count; i++)
        {
            var a = pts[(i + count - 1) % count]; var b = pts[i]; var c = pts[(i + 1) % count];
            double cross = (b[0] - a[0]) * (c[1] - b[1]) - (b[1] - a[1]) * (c[0] - b[0]);
            if (Math.Abs(cross) > 1e-9) output.Add(b);
        }
        return output;
    }

    private static double Shoelace(List<double[]> polygon)
    {
        double sum = 0; int count = polygon.Count;
        for (int i = 0; i < count; i++)
        {
            var a = polygon[i]; var b = polygon[(i + 1) % count];
            sum += a[0] * b[1] - b[0] * a[1];
        }
        return sum / 2;
    }

    private static int PoleOfInaccessibility(List<int> cells, int[] label, int id, int W, int H)
    {
        int bx0 = W, by0 = H, bx1 = 0, by1 = 0;
        foreach (int c in cells)
        {
            int cx = c % W, cy = c / W;
            if (cx < bx0) bx0 = cx; if (cx > bx1) bx1 = cx;
            if (cy < by0) by0 = cy; if (cy > by1) by1 = cy;
        }
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
        int bestIndex = cells[0]; float bestValue = -1;
        for (int y = lh - 1; y >= 0; y--)
            for (int x = lw - 1; x >= 0; x--)
            {
                int i = y * lw + x; float v = d[i];
                if (v == 0) continue;
                v = Math.Min(v, x < lw - 1 ? d[i + 1] + 1 : 0.5f);
                v = Math.Min(v, y < lh - 1 ? d[i + lw] + 1 : 0.5f);
                if (x < lw - 1 && y < lh - 1) v = Math.Min(v, d[i + lw + 1] + 1.4142f);
                d[i] = v;
                if (v > bestValue) { bestValue = v; bestIndex = (y + by0) * W + (x + bx0); }
            }
        return bestIndex;
    }
}
