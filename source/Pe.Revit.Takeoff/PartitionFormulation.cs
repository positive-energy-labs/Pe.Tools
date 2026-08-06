namespace Pe.Revit.Takeoff;

// Phase-2 formulation (eval/rhvac/PHASE2-PARTITION.md): rooms are a PARTITION of the covered
// walkable domain, not independent blobs.
//
//   1. DOMAIN    = floor-present (+ ceiling/headroom when RequireCeiling) — the existence mask.
//   2. EVIDENCE  = continuous per-cell boundary cost: sealed obstruction ink is certainty (1.0);
//                  ceiling/floor height discontinuities contribute weighted, saturating ramps.
//   3. SEEDS     = one per candidate space (region cores or distance-transform plateaus).
//   4. WATERSHED = priority-flood assignment of every domain cell to a seed, cheapest evidence
//                  first — fronts meet mid-ink, so wall thickness splits at the centerline and
//                  adjacent rooms share boundaries by construction.
//   5. MERGE     = two spaces whose shared boundary is mostly unbacked by evidence are one space
//                  (open-plan) — merged explicitly and FLAGGED, never silently.
//   6. SLIVERS   = spaces under min area or min feature width dissolve into their dominant
//                  neighbor; wall bands and speckle fragments cease to exist as rooms.
//
// Holes inside the domain are impossible by construction: every domain cell ends up in an
// emitted room, a dropped border region (exterior leak, logged), or a dropped crumb component
// (logged). Boundary geometry is jagged raster — straightening is phase 3 (wall-line
// arrangement), deliberately NOT bundled here.
internal static class PartitionFormulation
{
    internal static TakeoffResult Run(
        Heightfield hf, bool[] obst, bool[] seedInk, string levelName, double lvlZ,
        TakeoffOptions opt, Action<string> log)
    {
        if (double.IsNaN(opt.MinRegionCompactness) || double.IsInfinity(opt.MinRegionCompactness)
            || opt.MinRegionCompactness < 0 || opt.MinRegionCompactness > 1)
            throw new ArgumentOutOfRangeException(nameof(opt.MinRegionCompactness));
        int W = hf.W, H = hf.H, n = W * H;
        double cellArea = opt.CellFt * opt.CellFt;

        // ---- 1. domain ----
        var domain = BuildDomain(hf, lvlZ, opt);
        int domainCells = domain.Count(d => d);

        // ---- 2. boundary evidence ----
        var evidence = BuildEvidence(hf, obst, opt);

        // ---- 3. seeds ----
        int nSeeds;
        var seed = opt.SeedSource switch {
            TakeoffSeedSource.DistanceMaxima => SeedsFromDistanceMaxima(evidence, domain, W, H, opt, out nSeeds),
            TakeoffSeedSource.Hybrid => SeedsHybrid(evidence, obst, domain, W, H, opt, out nSeeds),
            _ => SeedsFromCores(obst, domain, W, H, out nSeeds),
        };

        // ---- 4. watershed assignment ----
        var owner = Flood(seed, evidence, domain, W, H);

        // seedless domain components (fully obstructed pockets, or DT plateaus that never formed):
        // big ones become their own flagged space; crumbs are dropped with their area logged.
        var flags = new Dictionary<int, SortedSet<string>>();
        int nextId = nSeeds;
        double crumbSqft = 0;
        var comp = new List<int>();
        var bfs = new Queue<int>();
        for (int i = 0; i < n; i++)
        {
            if (!domain[i] || owner[i] != 0) continue;
            comp.Clear();
            owner[i] = -1; bfs.Enqueue(i);
            while (bfs.Count > 0)
            {
                int c = bfs.Dequeue(); comp.Add(c);
                int cx = c % W, cy = c / W;
                if (cx > 0 && domain[c - 1] && owner[c - 1] == 0) { owner[c - 1] = -1; bfs.Enqueue(c - 1); }
                if (cx < W - 1 && domain[c + 1] && owner[c + 1] == 0) { owner[c + 1] = -1; bfs.Enqueue(c + 1); }
                if (cy > 0 && domain[c - W] && owner[c - W] == 0) { owner[c - W] = -1; bfs.Enqueue(c - W); }
                if (cy < H - 1 && domain[c + W] && owner[c + W] == 0) { owner[c + W] = -1; bfs.Enqueue(c + W); }
            }
            if (comp.Count * cellArea >= opt.MinSqft)
            {
                nextId++;
                foreach (int c in comp) owner[c] = nextId;
                Flag(flags, nextId, "seedless");
            }
            else
            {
                foreach (int c in comp) owner[c] = 0;
                crumbSqft += comp.Count * cellArea;
            }
        }

        // ---- 5. explicit merges: unsupported shared boundaries are one open-plan space ----
        var uf = new UnionFind(nextId + 1);
        var pairs = BoundaryPairs(owner, evidence, domain, W, H, opt.BoundaryEvidenceMin);
        int nMerges = 0;
        foreach (var ((a, b), (edges, backed)) in pairs)
        {
            if ((double)backed / edges >= opt.MinBoundarySupport) continue;
            int ra = uf.Find(a), rb = uf.Find(b);
            if (ra == rb) continue;
            int root = uf.Union(ra, rb);
            Flag(flags, root, "open-plan-merge");
            MergeFlags(flags, uf, ra, rb, root);
            nMerges++;
        }
        Relabel(owner, uf);

        // ---- 6. sliver dissolution: delete the sliver, re-flood its cells under the SAME
        // evidence-priority assignment rule. A thin wall-band sliver therefore splits between its
        // real neighbors at the centerline instead of inflating one dominant neighbor (measured:
        // dominant-neighbor dumping cost Guest Office 0.93 -> 0.67 IoU). Cells no live region can
        // reach are crumbs — logged, never silent.
        int dissolved = 0, droppedIsolated = 0;
        for (int iter = 0; iter < 32; iter++)
        {
            var area = new Dictionary<int, int>();
            for (int i = 0; i < n; i++)
                if (owner[i] > 0) area[owner[i]] = area.GetValueOrDefault(owner[i]) + 1;
            var widthFt = RegionWidthsFt(owner, W, H, opt.CellFt);
            var slivers = area.Keys
                .Where(id => area[id] * cellArea < opt.MinSqft || widthFt[id] < opt.MinFeatureWidthFt)
                .ToHashSet();
            if (slivers.Count == 0) break;

            for (int i = 0; i < n; i++) if (owner[i] > 0 && slivers.Contains(owner[i])) owner[i] = 0;
            foreach (int id in slivers) flags.Remove(id);
            dissolved += slivers.Count;

            var heap = new MinHeap(1024);
            for (int i = 0; i < n; i++)
            {
                if (owner[i] <= 0) continue;
                int x = i % W, y = i / W;
                bool frontier = x > 0 && domain[i - 1] && owner[i - 1] == 0
                                || x < W - 1 && domain[i + 1] && owner[i + 1] == 0
                                || y > 0 && domain[i - W] && owner[i - W] == 0
                                || y < H - 1 && domain[i + W] && owner[i + W] == 0;
                if (frontier) heap.Push(evidence[i], i);
            }
            while (heap.Count > 0)
            {
                int c = heap.Pop();
                int cx = c % W, cy = c / W;
                int me = owner[c];
                if (cx > 0 && domain[c - 1] && owner[c - 1] == 0) { owner[c - 1] = me; heap.Push(evidence[c - 1], c - 1); }
                if (cx < W - 1 && domain[c + 1] && owner[c + 1] == 0) { owner[c + 1] = me; heap.Push(evidence[c + 1], c + 1); }
                if (cy > 0 && domain[c - W] && owner[c - W] == 0) { owner[c - W] = me; heap.Push(evidence[c - W], c - W); }
                if (cy < H - 1 && domain[c + W] && owner[c + W] == 0) { owner[c + W] = me; heap.Push(evidence[c + W], c + W); }
            }
            int orphans = 0;
            for (int i = 0; i < n; i++)
                if (domain[i] && owner[i] == 0) orphans++;
            if (orphans > 0) droppedIsolated++;
            crumbSqft = 0;
            for (int i = 0; i < n; i++) if (domain[i] && owner[i] == 0) crumbSqft += cellArea;
        }

        // ---- low-evidence-boundary flags on the final labeling ----
        foreach (var ((a, b), (edges, backed)) in BoundaryPairs(owner, evidence, domain, W, H, opt.BoundaryEvidenceMin))
        {
            if ((double)backed / edges >= opt.LowBoundarySupportFlag) continue;
            Flag(flags, a, "low-evidence-boundary");
            Flag(flags, b, "low-evidence-boundary");
        }

        // ---- emit: drop border-touching spaces (exterior leaks), order by area desc ----
        var cellsById = new Dictionary<int, List<int>>();
        var touchesBorder = new HashSet<int>();
        for (int i = 0; i < n; i++)
        {
            int id = owner[i];
            if (id <= 0) continue;
            if (!cellsById.TryGetValue(id, out var lst)) cellsById[id] = lst = new List<int>();
            lst.Add(i);
            int x = i % W, y = i / W;
            if (x == 0 || y == 0 || x == W - 1 || y == H - 1) touchesBorder.Add(id);
        }
        double borderSqft = touchesBorder.Sum(id => cellsById[id].Count) * cellArea;
        var emitIds = cellsById.Keys
            .Where(id => !touchesBorder.Contains(id) && cellsById[id].Count * cellArea >= opt.MinSqft)
            .OrderByDescending(id => cellsById[id].Count).ThenBy(id => id)
            .ToList();
        var medianWidthFt = RegionMedianWidthsFt(owner, W, H, opt.CellFt);
        var perimeterCells = RegionPerimeterCells(owner, W, H);
        foreach (int id in emitIds)
        {
            if (medianWidthFt[id] < opt.MinFeatureWidthFt) Flag(flags, id, "suspect:narrow");
            double perimeter = perimeterCells[id] * opt.CellFt;
            double compactness = 4 * Math.PI * cellsById[id].Count * cellArea / (perimeter * perimeter);
            if (compactness < opt.MinRegionCompactness) Flag(flags, id, "suspect:compactness");
        }

        log($"[partition] domain={domainCells * cellArea:F0}sf seeds={nSeeds} merges={nMerges} " +
            $"dissolved={dissolved} isolatedDropped={droppedIsolated} crumbs={crumbSqft:F0}sf " +
            $"borderDropped={touchesBorder.Count} ({borderSqft:F0}sf) rooms={emitIds.Count}");

        var result = new TakeoffResult { LevelName = levelName, LevelElevation = lvlZ };
        int rank = 0;
        foreach (int id in emitIds)
        {
            var cells = cellsById[id];
            var loops = Detector.TraceLoops(cells, owner, id, W, H);
            var polys = loops
                .Select(lp => lp.Select(v => new[] { hf.MinX + v.x * opt.CellFt, hf.MinY + v.y * opt.CellFt }).ToList())
                .Select(Detector.CollapseCollinear)
                .Where(p => p.Count >= 3)
                .ToList();
            if (polys.Count == 0) continue;
            int outerIdx = 0; double best = 0;
            for (int i = 0; i < polys.Count; i++)
            { double ar = Math.Abs(Detector.Shoelace(polys[i])); if (ar > best) { best = ar; outerIdx = i; } }
            var outer = polys[outerIdx];
            if (Detector.Shoelace(outer) < 0) outer.Reverse();

            double ceilSum = 0; int ceilN = 0;
            foreach (int c in cells)
                if (!float.IsNaN(hf.CeilZ[c]) && !float.IsNaN(hf.FloorZ[c])) { ceilSum += hf.CeilZ[c] - hf.FloorZ[c]; ceilN++; }
            int lp2 = Detector.PoleOfInaccessibility(cells, owner, id, W, H);
            double perim = 0;
            for (int i = 0; i < outer.Count; i++)
            {
                var a2 = outer[i]; var b2 = outer[(i + 1) % outer.Count];
                perim += Math.Sqrt((a2[0] - b2[0]) * (a2[0] - b2[0]) + (a2[1] - b2[1]) * (a2[1] - b2[1]));
            }
            rank++;
            double sqft = cells.Count * cellArea;
            var room = new RoomResult {
                Id = "R" + rank.ToString("D2"),
                RawSqft = sqft,
                PerimeterFt = perim,
                LabelX = hf.MinX + (lp2 % W + 0.5) * opt.CellFt,
                LabelY = hf.MinY + (lp2 / W + 0.5) * opt.CellFt,
                MeanCeilingFt = ceilN > 0 ? ceilSum / ceilN : 0,
                Polygon = outer,
            };
            for (int i = 0; i < polys.Count; i++) if (i != outerIdx) room.Holes.Add(polys[i]);
            if (flags.TryGetValue(id, out var fl)) room.Flags.AddRange(fl);
            result.Rooms.Add(room);
        }
        SpaceBoundaryNetwork.Regularize(
            result.Rooms, opt.CellFt, opt.BoundarySimplifyFt,
            InkSupport.CreateOracle(W, H, hf.MinX, hf.MinY, opt.CellFt, seedInk, 3 * opt.CellFt), log);
        result.TotalSqft = result.Rooms.Sum(room => room.RawSqft);
        return result;
    }

    // Existence mask: floor within tolerance of the level plane, plus covered headroom when
    // RequireCeiling. Every domain cell must end up assigned (or logged as border/crumb drop).
    internal static bool[] BuildDomain(Heightfield hf, double lvlZ, TakeoffOptions opt)
    {
        int n = hf.W * hf.H;
        var domain = new bool[n];
        for (int i = 0; i < n; i++)
        {
            if (float.IsNaN(hf.FloorZ[i]) || Math.Abs(hf.FloorZ[i] - lvlZ) > opt.FloorTolFt) continue;
            if (opt.RequireCeiling
                && (float.IsNaN(hf.CeilZ[i]) || hf.CeilZ[i] - hf.FloorZ[i] < opt.MinHeadroomFt
                    || hf.CeilZ[i] >= lvlZ + opt.StoryCapFt)) continue;
            domain[i] = true;
        }
        return domain;
    }

    // Offline diagnosis/calibration dump (numpy-friendly, see eval/rhvac scripts): per-cell
    // domain + obstruction masks and RAW neighbor height steps in feet, so evidence thresholds
    // and weights can be studied against the ground-truth wall lines without re-dumping.
    internal static void DumpDiagnostics(string path, Heightfield hf, bool[] obst, double lvlZ, TakeoffOptions opt)
    {
        int W = hf.W, H = hf.H, n = W * H;
        var domain = BuildDomain(hf, lvlZ, opt);
        var ceilStep = new float[n];
        var floorStep = new float[n];
        for (int y = 0; y < H; y++)
            for (int x = 0; x < W; x++)
            {
                int i = y * W + x;
                foreach (int j in new[] { x < W - 1 ? i + 1 : -1, y < H - 1 ? i + W : -1 })
                {
                    if (j < 0) continue;
                    float ca = hf.CeilZ[i], cb = hf.CeilZ[j];
                    if (!float.IsNaN(ca) && !float.IsNaN(cb))
                    {
                        float s = Math.Abs(ca - cb);
                        if (s > ceilStep[i]) ceilStep[i] = s;
                        if (s > ceilStep[j]) ceilStep[j] = s;
                    }
                    float fa = hf.FloorZ[i], fb = hf.FloorZ[j];
                    if (!float.IsNaN(fa) && !float.IsNaN(fb))
                    {
                        float s = Math.Abs(fa - fb);
                        if (s > floorStep[i]) floorStep[i] = s;
                        if (s > floorStep[j]) floorStep[j] = s;
                    }
                }
            }
        using var w = new BinaryWriter(File.Create(path));
        w.Write(W); w.Write(H);
        w.Write(hf.MinX); w.Write(hf.MinY); w.Write(hf.CellFt);
        foreach (bool d in domain) w.Write((byte)(d ? 1 : 0));
        foreach (bool o in obst) w.Write((byte)(o ? 1 : 0));
        var bytes = new byte[n * 4];
        Buffer.BlockCopy(ceilStep, 0, bytes, 0, bytes.Length);
        w.Write(bytes);
        Buffer.BlockCopy(floorStep, 0, bytes, 0, bytes.Length);
        w.Write(bytes);
    }

    // Continuous boundary-evidence field: obstruction ink is certainty; ceiling and floor height
    // discontinuities contribute weighted saturating ramps (soffits, plate lines, sunken rooms).
    private static float[] BuildEvidence(Heightfield hf, bool[] obst, TakeoffOptions opt)
    {
        int W = hf.W, H = hf.H, n = W * H;
        var e = new float[n];
        for (int i = 0; i < n; i++) if (obst[i]) e[i] = 1f;

        static double Ramp(double v, double t0, double t1) =>
            v <= t0 ? 0 : v >= t1 ? 1 : (v - t0) / (t1 - t0);

        void Pair(int a, int b)
        {
            double s = 0;
            float ca = hf.CeilZ[a], cb = hf.CeilZ[b];
            if (!float.IsNaN(ca) && !float.IsNaN(cb))
                s = opt.CeilStepWeight * Ramp(Math.Abs(ca - cb), opt.CeilStepEvidenceFt, opt.CeilStepSaturationFt);
            float fa = hf.FloorZ[a], fb = hf.FloorZ[b];
            if (!float.IsNaN(fa) && !float.IsNaN(fb))
                s = Math.Max(s, opt.FloorStepWeight * Ramp(Math.Abs(fa - fb), opt.FloorStepEvidenceFt, opt.FloorStepSaturationFt));
            if (s <= 0) return;
            var f = (float)s;
            if (f > e[a]) e[a] = f;
            if (f > e[b]) e[b] = f;
        }
        for (int y = 0; y < H; y++)
            for (int x = 0; x < W; x++)
            {
                int i = y * W + x;
                if (x < W - 1) Pair(i, i + 1);
                if (y < H - 1) Pair(i, i + W);
            }
        return e;
    }

    // Seed source A: connected components of unobstructed domain, of any size (slivers dissolve
    // later, not here).
    private static int[] SeedsFromCores(bool[] obst, bool[] domain, int W, int H, out int nSeeds)
    {
        int n = W * H;
        var seed = new int[n];
        var q = new Queue<int>();
        nSeeds = 0;
        for (int i = 0; i < n; i++)
        {
            if (!domain[i] || obst[i] || seed[i] != 0) continue;
            nSeeds++;
            seed[i] = nSeeds; q.Enqueue(i);
            while (q.Count > 0)
            {
                int c = q.Dequeue();
                int cx = c % W, cy = c / W;
                if (cx > 0 && domain[c - 1] && !obst[c - 1] && seed[c - 1] == 0) { seed[c - 1] = nSeeds; q.Enqueue(c - 1); }
                if (cx < W - 1 && domain[c + 1] && !obst[c + 1] && seed[c + 1] == 0) { seed[c + 1] = nSeeds; q.Enqueue(c + 1); }
                if (cy > 0 && domain[c - W] && !obst[c - W] && seed[c - W] == 0) { seed[c - W] = nSeeds; q.Enqueue(c - W); }
                if (cy < H - 1 && domain[c + W] && !obst[c + W] && seed[c + W] == 0) { seed[c + W] = nSeeds; q.Enqueue(c + W); }
            }
        }
        return seed;
    }

    // Seed source B: plateaus of the chamfer distance transform to {strong evidence or non-domain}
    // that clear SeedClearFt — one seed per fat open area, blind to speckle noise.
    private static int[] SeedsFromDistanceMaxima(float[] evidence, bool[] domain, int W, int H, TakeoffOptions opt, out int nSeeds)
    {
        int n = W * H;
        var src = new bool[n];
        for (int i = 0; i < n; i++) src[i] = !domain[i] || evidence[i] >= (float)opt.BoundaryEvidenceMin;
        var d = Detector.Chamfer(src, W, H, false);
        float clear = (float)(opt.SeedClearFt / opt.CellFt);
        var plateau = new bool[n];
        for (int i = 0; i < n; i++) plateau[i] = domain[i] && d[i] >= clear;

        var seed = new int[n];
        var q = new Queue<int>();
        nSeeds = 0;
        for (int i = 0; i < n; i++)
        {
            if (!plateau[i] || seed[i] != 0) continue;
            nSeeds++;
            seed[i] = nSeeds; q.Enqueue(i);
            while (q.Count > 0)
            {
                int c = q.Dequeue();
                int cx = c % W, cy = c / W;
                if (cx > 0 && plateau[c - 1] && seed[c - 1] == 0) { seed[c - 1] = nSeeds; q.Enqueue(c - 1); }
                if (cx < W - 1 && plateau[c + 1] && seed[c + 1] == 0) { seed[c + 1] = nSeeds; q.Enqueue(c + 1); }
                if (cy > 0 && plateau[c - W] && seed[c - W] == 0) { seed[c - W] = nSeeds; q.Enqueue(c - W); }
                if (cy < H - 1 && plateau[c + W] && seed[c + W] == 0) { seed[c + W] = nSeeds; q.Enqueue(c + W); }
            }
        }
        return seed;
    }

    // Seed source C: cores, except a core spanning >= 2 evidence-clear plateaus is seeded by the
    // plateaus instead — the watershed can then split an open-plan core along interior evidence
    // ridges (which the merge criterion re-merges + flags if the ridge turns out unbacked).
    private static int[] SeedsHybrid(float[] evidence, bool[] obst, bool[] domain, int W, int H, TakeoffOptions opt, out int nSeeds)
    {
        int n = W * H;
        var core = SeedsFromCores(obst, domain, W, H, out int nCores);
        var plateau = SeedsFromDistanceMaxima(evidence, domain, W, H, opt, out int nPlateaus);

        // distinct plateaus per core
        var plateausOfCore = new HashSet<int>[nCores + 1];
        for (int i = 0; i < n; i++)
            if (core[i] > 0 && plateau[i] > 0)
                (plateausOfCore[core[i]] ??= new HashSet<int>()).Add(plateau[i]);

        var seed = new int[n];
        var plateauId = new Dictionary<int, int>(); // plateau id -> final seed id
        nSeeds = 0;
        var coreId = new int[nCores + 1];
        for (int c = 1; c <= nCores; c++)
            if (plateausOfCore[c] == null || plateausOfCore[c].Count < 2) coreId[c] = ++nSeeds;
        for (int i = 0; i < n; i++)
        {
            int c = core[i];
            if (c == 0) continue;
            if (coreId[c] > 0) { seed[i] = coreId[c]; continue; }
            int p = plateau[i];
            if (p == 0) continue; // non-plateau cell of a split core: assigned by the flood
            if (!plateauId.TryGetValue(p, out int id)) plateauId[p] = id = ++nSeeds;
            seed[i] = id;
        }
        return seed;
    }

    // Meyer-style priority flood: pop the cheapest frontier cell, claim unowned domain neighbors.
    // Cheap (low-evidence) space floods first from all seeds simultaneously, so opposing fronts
    // meet mid-ink — wall thickness splits at the centerline. Fully deterministic: the heap orders
    // by (evidence, push sequence) and pushes happen in fixed neighbor order.
    private static int[] Flood(int[] seed, float[] evidence, bool[] domain, int W, int H)
    {
        int n = W * H;
        var owner = new int[n];
        var heap = new MinHeap(n);
        for (int i = 0; i < n; i++)
            if (seed[i] > 0) { owner[i] = seed[i]; heap.Push(evidence[i], i); }
        while (heap.Count > 0)
        {
            int c = heap.Pop();
            int cx = c % W, cy = c / W;
            int me = owner[c];
            if (cx > 0 && domain[c - 1] && owner[c - 1] == 0) { owner[c - 1] = me; heap.Push(evidence[c - 1], c - 1); }
            if (cx < W - 1 && domain[c + 1] && owner[c + 1] == 0) { owner[c + 1] = me; heap.Push(evidence[c + 1], c + 1); }
            if (cy > 0 && domain[c - W] && owner[c - W] == 0) { owner[c - W] = me; heap.Push(evidence[c - W], c - W); }
            if (cy < H - 1 && domain[c + W] && owner[c + W] == 0) { owner[c + W] = me; heap.Push(evidence[c + W], c + W); }
        }
        return owner;
    }

    // Shared-boundary stats per adjacent pair: total edge count + how many edges are backed by
    // evidence (either side >= backedMin). Returned sorted for deterministic iteration.
    private static List<KeyValuePair<(int a, int b), (int edges, int backed)>> BoundaryPairs(
        int[] owner, float[] evidence, bool[] domain, int W, int H, double backedMin)
    {
        var stats = new Dictionary<(int, int), (int, int)>();
        var min = (float)backedMin;
        void Edge(int c, int d)
        {
            int a = owner[c], b = owner[d];
            if (a <= 0 || b <= 0 || a == b) return;
            var key = a < b ? (a, b) : (b, a);
            var (edges, backed) = stats.GetValueOrDefault(key);
            stats[key] = (edges + 1, backed + (evidence[c] >= min || evidence[d] >= min ? 1 : 0));
        }
        int n = W * H;
        for (int i = 0; i < n; i++)
        {
            if (!domain[i]) continue;
            int x = i % W, y = i / W;
            if (x < W - 1 && domain[i + 1]) Edge(i, i + 1);
            if (y < H - 1 && domain[i + W]) Edge(i, i + W);
        }
        return stats.OrderBy(kv => kv.Key.Item1).ThenBy(kv => kv.Key.Item2)
            .Select(kv => new KeyValuePair<(int, int), (int, int)>(kv.Key, kv.Value)).ToList();
    }

    // Max feature width per region: global chamfer to region-boundary cells (a cell's nearest
    // boundary cell is always on its own region's boundary), maxed per region.
    private static Dictionary<int, double> RegionWidthsFt(int[] owner, int W, int H, double cellFt)
    {
        var d = RegionDepths(owner, W, H);
        var widths = new Dictionary<int, double>();
        for (int i = 0; i < owner.Length; i++)
        {
            if (owner[i] <= 0) continue;
            double w = (2 * d[i] + 1) * cellFt;
            if (!widths.TryGetValue(owner[i], out double cur) || w > cur) widths[owner[i]] = w;
        }
        return widths;
    }

    private static Dictionary<int, double> RegionMedianWidthsFt(int[] owner, int W, int H, double cellFt)
    {
        var d = RegionDepths(owner, W, H);
        var depths = owner.Select((id, cell) => (id, depth: d[cell])).Where(item => item.id > 0)
            .GroupBy(item => item.id).ToDictionary(group => group.Key,
                group => group.Select(item => item.depth).OrderBy(value => value).ToList());
        return depths.ToDictionary(pair => pair.Key,
            pair => (4 * pair.Value[pair.Value.Count / 2] + 2) * cellFt);
    }

    private static float[] RegionDepths(int[] owner, int W, int H)
    {
        var boundary = new bool[owner.Length];
        for (int i = 0; i < owner.Length; i++)
        {
            if (owner[i] <= 0) continue;
            int x = i % W, y = i / W;
            boundary[i] = x == 0 || y == 0 || x == W - 1 || y == H - 1
                          || owner[i - 1] != owner[i] || owner[i + 1] != owner[i]
                          || owner[i - W] != owner[i] || owner[i + W] != owner[i];
        }
        return Detector.Chamfer(boundary, W, H, false);
    }

    private static Dictionary<int, int> RegionPerimeterCells(int[] owner, int W, int H)
    {
        var perimeters = new Dictionary<int, int>();
        for (int cell = 0; cell < owner.Length; cell++)
        {
            int id = owner[cell];
            if (id <= 0) continue;
            int x = cell % W, y = cell / W;
            int edges = 0;
            if (x == 0 || owner[cell - 1] != id) edges++;
            if (x == W - 1 || owner[cell + 1] != id) edges++;
            if (y == 0 || owner[cell - W] != id) edges++;
            if (y == H - 1 || owner[cell + W] != id) edges++;
            perimeters[id] = perimeters.GetValueOrDefault(id) + edges;
        }
        return perimeters;
    }

    private static void Relabel(int[] owner, UnionFind uf)
    {
        for (int i = 0; i < owner.Length; i++)
            if (owner[i] > 0) owner[i] = uf.Find(owner[i]);
    }

    private static void Flag(Dictionary<int, SortedSet<string>> flags, int id, string flag)
    {
        if (!flags.TryGetValue(id, out var set)) flags[id] = set = new SortedSet<string>(StringComparer.Ordinal);
        set.Add(flag);
    }

    private static void MergeFlags(Dictionary<int, SortedSet<string>> flags, UnionFind uf, int a, int b, int root)
    {
        foreach (int side in new[] { a, b })
        {
            if (side == root || !flags.TryGetValue(side, out var set)) continue;
            foreach (string f in set) Flag(flags, root, f);
            flags.Remove(side);
        }
    }

    private sealed class UnionFind
    {
        private readonly int[] _parent;
        public UnionFind(int size) { this._parent = Enumerable.Range(0, size).ToArray(); }
        public int Find(int x)
        {
            while (this._parent[x] != x) { this._parent[x] = this._parent[this._parent[x]]; x = this._parent[x]; }
            return x;
        }
        // smaller root id wins — deterministic and stable across merge orders
        public int Union(int a, int b)
        {
            a = this.Find(a); b = this.Find(b);
            if (a == b) return a;
            if (b < a) (a, b) = (b, a);
            this._parent[b] = a;
            return a;
        }
    }

    private sealed class MinHeap
    {
        private float[] _priority;
        private int[] _seq;
        private int[] _cell;
        private int _count, _pushes;
        public MinHeap(int capacity) { this._priority = new float[capacity]; this._seq = new int[capacity]; this._cell = new int[capacity]; }
        public int Count => this._count;

        public void Push(float priority, int cell)
        {
            if (this._count == this._priority.Length)
            {
                Array.Resize(ref this._priority, this._count * 2);
                Array.Resize(ref this._seq, this._count * 2);
                Array.Resize(ref this._cell, this._count * 2);
            }
            int i = this._count++;
            this._priority[i] = priority; this._seq[i] = this._pushes++; this._cell[i] = cell;
            while (i > 0)
            {
                int p = (i - 1) / 2;
                if (!this.Less(i, p)) break;
                this.Swap(i, p); i = p;
            }
        }

        public int Pop()
        {
            int cell = this._cell[0];
            this._count--;
            if (this._count > 0)
            {
                this._priority[0] = this._priority[this._count];
                this._seq[0] = this._seq[this._count];
                this._cell[0] = this._cell[this._count];
                int i = 0;
                while (true)
                {
                    int l = 2 * i + 1, r = l + 1, s = i;
                    if (l < this._count && this.Less(l, s)) s = l;
                    if (r < this._count && this.Less(r, s)) s = r;
                    if (s == i) break;
                    this.Swap(i, s); i = s;
                }
            }
            return cell;
        }

        private bool Less(int i, int j) =>
            this._priority[i] < this._priority[j]
            || this._priority[i] == this._priority[j] && this._seq[i] < this._seq[j];

        private void Swap(int i, int j)
        {
            (this._priority[i], this._priority[j]) = (this._priority[j], this._priority[i]);
            (this._seq[i], this._seq[j]) = (this._seq[j], this._seq[i]);
            (this._cell[i], this._cell[j]) = (this._cell[j], this._cell[i]);
        }
    }
}
