namespace Pe.Revit.Takeoff;

internal sealed class PreparedTakeoffDetection
{
    private readonly Heightfield field;
    private readonly bool[] obstruction;
    private readonly bool[] footprint;
    private readonly float[] evidence;
    private readonly string levelName;
    private readonly double levelElevation;
    private readonly TakeoffOptions options;

    internal PreparedTakeoffDetection(
        Heightfield field, bool[] obstruction, bool[] footprint, float[] evidence,
        string levelName, double levelElevation, TakeoffOptions options)
    {
        this.field = field;
        this.obstruction = obstruction;
        this.footprint = footprint;
        this.evidence = evidence;
        this.levelName = levelName;
        this.levelElevation = levelElevation;
        this.options = options;
    }

    internal TakeoffResult Detect(bool[]? zoneMask, Action<string> log) =>
        PartitionFormulation.Run(
            this.field, this.obstruction, this.levelName, this.levelElevation, this.options,
            log, zoneMask, this.footprint, this.evidence);

    internal TakeoffResult Detect(ZoneScope zone, Action<string> log)
    {
        if (zone == null) throw new ArgumentNullException(nameof(zone));
        const int paddingCells = 2;
        var points = zone.Loops.SelectMany(loop => loop).ToList();
        int x0 = Math.Max(0, (int)Math.Floor(
            (points.Min(point => point[0]) - this.field.MinX) / this.field.CellFt) - paddingCells);
        int y0 = Math.Max(0, (int)Math.Floor(
            (points.Min(point => point[1]) - this.field.MinY) / this.field.CellFt) - paddingCells);
        int x1 = Math.Min(this.field.W, (int)Math.Ceiling(
            (points.Max(point => point[0]) - this.field.MinX) / this.field.CellFt) + paddingCells);
        int y1 = Math.Min(this.field.H, (int)Math.Ceiling(
            (points.Max(point => point[1]) - this.field.MinY) / this.field.CellFt) + paddingCells);
        if (x1 <= x0 || y1 <= y0)
            return new TakeoffResult {
                LevelName = this.levelName,
                LevelElevation = this.levelElevation,
            };

        int width = x1 - x0, height = y1 - y0;
        var croppedField = new Heightfield {
            W = width,
            H = height,
            MinX = this.field.MinX + x0 * this.field.CellFt,
            MinY = this.field.MinY + y0 * this.field.CellFt,
            CellFt = this.field.CellFt,
            FloorZ = Crop(this.field.FloorZ),
            CeilZ = Crop(this.field.CeilZ),
        };
        var croppedObstruction = Crop(this.obstruction);
        var croppedFootprint = Crop(this.footprint);
        var croppedEvidence = Crop(this.evidence);
        log($"[partition] zone crop {this.field.W}x{this.field.H} -> {width}x{height}");
        return PartitionFormulation.Run(
            croppedField, croppedObstruction, this.levelName, this.levelElevation, this.options,
            log, zone.CellMask(croppedField), croppedFootprint, croppedEvidence);

        T[] Crop<T>(T[] source)
        {
            var cropped = new T[width * height];
            for (int y = 0; y < height; y++)
                Array.Copy(source, (y0 + y) * this.field.W + x0,
                    cropped, y * width, width);
            return cropped;
        }
    }
}

// Detection core. INK DEFINES BOUNDARY EVIDENCE; PHYSICS DEFINES THE PARTITION DOMAIN.
// Everything here is pure computation over the heightfield + ink rasters. DetectSnapshot persists
// exactly these inputs so partition changes iterate offline against real captured state.
public static class Detector
{
    internal static PreparedTakeoffDetection Prepare(
        Heightfield hf, bool[] seedInk, string levelName, double levelElevation,
        TakeoffOptions opt, Action<string> log)
    {
        var obstruction = BuildObstruction(hf, seedInk, levelElevation, opt, log);
        var footprint = InkBoundedFloor(hf, obstruction, levelElevation, opt.FloorTolFt);
        var evidence = PartitionFormulation.BuildEvidence(hf, obstruction, opt);
        return new PreparedTakeoffDetection(
            hf, obstruction, footprint, evidence, levelName, levelElevation, opt);
    }

    public static TakeoffResult Detect(
        Heightfield hf, bool[] seedInk, string levelName, double levelElevation,
        TakeoffOptions opt, Action<string> log, bool[]? zoneMask = null)
    {
        var obst = BuildObstruction(hf, seedInk, levelElevation, opt, log);
        return PartitionFormulation.Run(hf, obst, levelName, levelElevation, opt, log, zoneMask);
    }

    // Shared by detection, level-profile inference, and diagnostics: composed seed ink -> sealed
    // obstruction mask (stud-gap close + geometric door sealers).
    internal static bool[] BuildObstruction(
        Heightfield hf, bool[] seedInk, double lvlZ, TakeoffOptions opt, Action<string> log)
    {
        int W = hf.W, H = hf.H, n = W * H;
        var obst = (bool[])seedInk.Clone();
        Close(obst, W, H, (float)(opt.GapSealFt / 2.0 / opt.CellFt));

        if (opt.SealDoorHeads)
        {
            // Lintel cells: low covered headroom with a markedly taller covered cell nearby. The
            // "nearby" dilation covers the doorway strip depth (wall thickness) at CellFt scale.
            var tallCore = new bool[n];
            for (int i = 0; i < n; i++)
                tallCore[i] = !float.IsNaN(hf.FloorZ[i]) && !float.IsNaN(hf.CeilZ[i])
                              && hf.CeilZ[i] - hf.FloorZ[i] > opt.DoorHeadMaxFt + opt.DoorHeadContrastFt;
            var dist = Chamfer(tallCore, W, H, false);
            var tall = new bool[n];
            for (int i = 0; i < n; i++) tall[i] = dist[i] <= 3f + 1e-4f;
            int sealed_ = 0;
            for (int i = 0; i < n; i++)
            {
                if (obst[i] || !tall[i]) continue;
                if (float.IsNaN(hf.FloorZ[i]) || float.IsNaN(hf.CeilZ[i])) continue;
                double head = hf.CeilZ[i] - hf.FloorZ[i];
                if (head >= opt.MinHeadroomFt && head <= opt.DoorHeadMaxFt) { obst[i] = true; sealed_++; }
            }
            log($"[detect] door-head seal: {sealed_ * opt.CellFt * opt.CellFt:F0} sf of lintel cells became obstruction");
        }

        if (opt.SealWallRunGaps)
        {
            // Headerless doorways (framing models): a gap counts as a door only when it is a short
            // colinear break between two solid ink runs. Scanning H, V and both diagonals covers
            // rotated wings; diagonal walls >= 2 cells thick stay contiguous along 45-degree lines.
            int maxGap = (int)Math.Round(opt.DoorGapMaxFt / opt.CellFt);
            int minRun = (int)Math.Round(opt.DoorJambMinFt / opt.CellFt);
            var filled = new bool[n];
            void Scan(int sx, int sy, int dx, int dy)
            {
                int x = sx, y = sy;
                var line = new List<int>();
                while (x >= 0 && x < W && y >= 0 && y < H) { line.Add(y * W + x); x += dx; y += dy; }
                int i0 = 0;
                var segs = new List<(bool Ink, int Start, int Len)>();
                while (i0 < line.Count)
                {
                    bool ink = obst[line[i0]];
                    int j = i0;
                    while (j < line.Count && obst[line[j]] == ink) j++;
                    segs.Add((ink, i0, j - i0));
                    i0 = j;
                }
                for (int s = 1; s + 1 < segs.Count; s++)
                {
                    var (ink, start, len) = segs[s];
                    if (ink || len > maxGap) continue;
                    if (segs[s - 1].Len >= minRun && segs[s + 1].Len >= minRun)
                        for (int k = start; k < start + len; k++) filled[line[k]] = true;
                }
            }
            for (int y = 0; y < H; y++) Scan(0, y, 1, 0);
            for (int x = 0; x < W; x++) Scan(x, 0, 0, 1);
            for (int x = 0; x < W; x++) Scan(x, 0, 1, 1);
            for (int y = 1; y < H; y++) Scan(0, y, 1, 1);
            for (int x = 0; x < W; x++) Scan(x, 0, -1, 1);
            for (int y = 1; y < H; y++) Scan(W - 1, y, -1, 1);
            int nFilled = 0;
            for (int i = 0; i < n; i++) if (filled[i] && !obst[i]) { obst[i] = true; nFilled++; }
            log($"[detect] wall-run gap seal: {nFilled * opt.CellFt * opt.CellFt:F0} sf of doorway gaps became obstruction");
        }
        return obst;
    }

    // The plan-sealed, same-level floor footprint. Flooding from the raster boundary identifies
    // everything architecturally outside; floor surfaces cannot establish existence by themselves.
    internal static bool[] InkBoundedFloor(
        Heightfield hf, bool[] obstruction, double levelElevation, double floorTolFt)
    {
        int W = hf.W, H = hf.H, n = W * H;
        if (obstruction.Length != n)
            throw new ArgumentException($"obstruction disagrees with {W}x{H}");
        var outside = new bool[n];
        var queue = new Queue<int>();
        void Add(int i)
        {
            if (obstruction[i] || outside[i]) return;
            outside[i] = true;
            queue.Enqueue(i);
        }
        for (int x = 0; x < W; x++) { Add(x); Add((H - 1) * W + x); }
        for (int y = 1; y + 1 < H; y++) { Add(y * W); Add(y * W + W - 1); }
        while (queue.Count > 0)
        {
            int i = queue.Dequeue(), x = i % W, y = i / W;
            if (x > 0) Add(i - 1);
            if (x + 1 < W) Add(i + 1);
            if (y > 0) Add(i - W);
            if (y + 1 < H) Add(i + W);
        }

        var footprint = new bool[n];
        for (int i = 0; i < n; i++)
            footprint[i] = !outside[i] && !float.IsNaN(hf.FloorZ[i])
                           && Math.Abs(hf.FloorZ[i] - levelElevation) <= floorTolFt;
        return footprint;
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

    internal static float[] Chamfer(bool[] mask, int W, int H, bool invert)
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
    internal static List<List<(int x, int y)>> TraceLoops(List<int> cells, int[] label, int id, int W, int H)
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

    internal static List<double[]> CollapseCollinear(List<double[]> pts)
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

    internal static double Shoelace(List<double[]> p)
    {
        double s = 0; int m = p.Count;
        for (int i = 0; i < m; i++) { var a = p[i]; var b = p[(i + 1) % m]; s += a[0] * b[1] - b[0] * a[1]; }
        return s / 2;
    }

    // chamfer distance-transform argmax inside the region = pole of inaccessibility; guaranteed
    // interior even for L-shaped rooms (a centroid is not).
    internal static int PoleOfInaccessibility(List<int> cells, int[] label, int id, int W, int H)
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
