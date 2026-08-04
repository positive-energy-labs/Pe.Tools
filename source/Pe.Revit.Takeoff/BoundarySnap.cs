namespace Pe.Revit.Takeoff;

// Phase-3 (eval/rhvac/REFINEMENT.md): WALL-LINE ARRANGEMENT SNAPPING for the Partition
// formulation. The watershed places boundaries correctly but emits jagged raster fronts; this
// stage detects the dominant wall directions per level FROM EVIDENCE (orientation histogram of
// evidence-backed boundary windows — never hardcoded), builds a line arrangement from colinear
// runs, and snaps partition boundaries onto it:
//
//   - a boundary run that tracks a detected wall line becomes exactly that line (colinear runs
//     across the level share ONE line — straight edges by construction);
//   - fronts that met mid-ink land on the ink centerline as a straight segment (the constrained
//     least-squares fit through the watershed front IS the centerline estimate);
//   - boundaries with no evidence support stay as-is: jaggedness where no wall exists is
//     INFORMATION for the ambiguity/editability lane, not noise to be smoothed away.
//
// Structural guarantees, by construction:
//   - TOTALITY: snapping operates on the shared-boundary CHAIN network (unit edges between cell
//     corners, chained between junction nodes). Each chain is snapped once; both bordering rooms
//     substitute the same geometry, so the partition stays gap/overlap-free.
//   - AREA IS EXPORTED TRUTH: per-room area drift vs the raster partition is bounded by
//     max(0.5 sqft, 1%); a room that would exceed it (or self-intersect) reverts its chains to
//     raw geometry, iterating to a fixed point whose final fallback is the pre-snap raster.
//   - DETERMINISM: fixed scan orders, sorted iteration, no randomness.
internal static class BoundarySnap
{
    private const double MaxAreaDriftSqft = 0.5;   // per-room drift bound: max(0.5 sqft, 1%) —
    private const double MaxAreaDriftFrac = 0.01;  // the polygon-simplification campaign bar
    private const double MinCornerAngleDeg = 20;   // below this, consecutive lines joggle instead of intersecting
    private const int Bins = 180;                  // 1-degree orientation bins, mod 180

    private sealed class Run
    {
        public int Start, End;    // inclusive edge-index range within the chain (full snap)
        public int StartCons, EndCons; // range EXCLUDING terminal absorption (conservative level)
        public int FitStart, FitEnd;   // range the line was fitted over (cluster-dev rechecks)
        public int Dir = -1;      // dominant-direction index; -1 = raw (unsnapped)
        public double Offset;     // fitted line: p . n(dir) == Offset
        public double Support;    // arc length backing this line's colinear cluster
    }

    private sealed class Chain
    {
        public List<int> Nodes = new();   // corner node ids; open: junction..junction, closed: first==last
        public List<int> Edges = new();
        public int A, B;                  // bordering mapped labels (0 = not an emitted room)
        public bool Closed;
        public double[] X = null!, Y = null!;   // node coords, model feet
        public int[] Dir = null!;               // per-edge direction assignment
        public List<Run> Runs = new();
        public List<double[]> Snapped = new();  // rebuilt polyline (open: J0..Jq; closed: cyclic, no dup end)
        public int Level;                       // staged fallback: 0 full snap, 1 conservative
                                                // (no terminal extension), 2 raw
        public bool IsRaw;                      // this iteration produced raw geometry only
    }

    // Effective run list at a fallback level. Level 1 undoes terminal absorption: the line run
    // shrinks back to its conservative range and the absorbed stubs re-appear as raw runs.
    private static List<Run> EffectiveRuns(Chain ch, int level)
    {
        if (level == 0) return ch.Runs;
        var runs = new List<Run>();
        foreach (var r in ch.Runs)
        {
            if (r.Dir < 0 || r.StartCons == r.Start && r.EndCons == r.End) { runs.Add(r); continue; }
            if (r.StartCons > r.Start)
                runs.Add(new Run { Start = r.Start, End = r.StartCons - 1 });
            runs.Add(new Run {
                Start = r.StartCons, End = r.EndCons, Dir = r.Dir,
                Offset = r.Offset, Support = r.Support,
            });
            if (r.EndCons < r.End)
                runs.Add(new Run { Start = r.EndCons + 1, End = r.End });
        }
        return runs;
    }

    internal static Dictionary<int, List<List<double[]>>> Compute(
        int[] mapped, Dictionary<int, List<int>> cellsById, List<int> emitIds, float[] evidence,
        int W, int H, double minX, double minY, double cellFt, TakeoffOptions opt, Action<string> log)
    {
        int nodeW = W + 1;
        int LabelAt(int x, int y) => x < 0 || y < 0 || x >= W || y >= H ? 0 : mapped[y * W + x];
        float EvAt(int x, int y) => x < 0 || y < 0 || x >= W || y >= H ? 0f : evidence[y * W + x];

        // ---- unit-edge network over cell corners ----
        var eN1 = new List<int>(); var eN2 = new List<int>();
        var eA = new List<int>(); var eB = new List<int>(); var eBacked = new List<bool>();
        var adj = new Dictionary<int, List<int>>();
        void AddEdge(int n1, int n2, int a, int b, float ev)
        {
            if (a == b || a <= 0 && b <= 0) return;
            int id = eN1.Count;
            eN1.Add(n1); eN2.Add(n2); eA.Add(a); eB.Add(b);
            eBacked.Add(ev >= (float)opt.BoundaryEvidenceMin);
            if (!adj.TryGetValue(n1, out var l1)) adj[n1] = l1 = new List<int>();
            l1.Add(id);
            if (!adj.TryGetValue(n2, out var l2)) adj[n2] = l2 = new List<int>();
            l2.Add(id);
        }
        for (int y = 0; y <= H; y++)
            for (int x = 0; x < W; x++)   // horizontal edge (x,y)-(x+1,y): cells (x,y-1) | (x,y)
                AddEdge(y * nodeW + x, y * nodeW + x + 1, LabelAt(x, y - 1), LabelAt(x, y),
                    Math.Max(EvAt(x, y - 1), EvAt(x, y)));
        for (int x = 0; x <= W; x++)
            for (int y = 0; y < H; y++)   // vertical edge (x,y)-(x,y+1): cells (x-1,y) | (x,y)
                AddEdge(y * nodeW + x, (y + 1) * nodeW + x, LabelAt(x - 1, y), LabelAt(x, y),
                    Math.Max(EvAt(x - 1, y), EvAt(x, y)));
        int nEdges = eN1.Count;

        // ---- chains between junction nodes ----
        bool Junction(int node) => adj[node].Count != 2;
        int Other(int e, int node) => eN1[e] == node ? eN2[e] : eN1[e];
        var edgeChain = new int[nEdges];
        Array.Fill(edgeChain, -1);
        var chains = new List<Chain>();
        void Walk(int startNode, int firstEdge)
        {
            var ch = new Chain { A = eA[firstEdge], B = eB[firstEdge] };
            int chainId = chains.Count;
            ch.Nodes.Add(startNode);
            int cur = startNode, e = firstEdge;
            while (true)
            {
                edgeChain[e] = chainId;
                ch.Edges.Add(e);
                cur = Other(e, cur);
                ch.Nodes.Add(cur);
                if (cur == startNode) { ch.Closed = true; break; }
                if (Junction(cur)) break;
                var le = adj[cur];
                e = le[0] == e ? le[1] : le[0];
                if (edgeChain[e] >= 0) break;
            }
            chains.Add(ch);
        }
        foreach (int node in adj.Keys.OrderBy(k => k))
        {
            if (!Junction(node)) continue;
            foreach (int e in adj[node])
                if (edgeChain[e] < 0) Walk(node, e);
        }
        for (int e = 0; e < nEdges; e++)
            if (edgeChain[e] < 0) Walk(eN1[e], e);   // remaining pure loops (islands)

        foreach (var ch in chains)
        {
            int np = ch.Nodes.Count;
            ch.X = new double[np]; ch.Y = new double[np];
            for (int i = 0; i < np; i++)
            {
                ch.X[i] = minX + ch.Nodes[i] % nodeW * cellFt;
                ch.Y[i] = minY + ch.Nodes[i] / nodeW * cellFt;
            }
        }

        // ---- per-edge window orientation + evidence backing -> direction histogram ----
        int halfE = Math.Max(1, (int)Math.Round(opt.SnapWindowFt / 2 / cellFt));
        var wRaw = new double[Bins];
        var aRaw = new double[Bins];   // weight-scaled sum of ACTUAL angles per bin (see peak refine)
        var chAngle = new double[chains.Count][];
        var chBackedFrac = new double[chains.Count][];
        for (int ci = 0; ci < chains.Count; ci++)
        {
            var ch = chains[ci];
            int m = ch.Edges.Count;
            var ang = chAngle[ci] = new double[m];
            var bf = chBackedFrac[ci] = new double[m];
            int he = ch.Closed ? Math.Min(halfE, (m - 1) / 2) : halfE;
            for (int k = 0; k < m; k++)
            {
                // EVEN edge count (2*he): an odd window makes a 45-degree staircase read as a
                // bimodal atan(n/(n+1)) pair instead of one 45-degree peak (measured on the
                // synthetic estate: 38.5/51.5 twin peaks).
                int j1 = k - he, j2 = k + he;
                if (!ch.Closed) { j1 = Math.Max(0, j1); j2 = Math.Min(m, j2); }
                int p1 = ch.Closed ? (j1 % m + m) % m : j1;
                int p2 = ch.Closed ? (j2 % m + m) % m : j2;
                double dx = ch.X[p2] - ch.X[p1], dy = ch.Y[p2] - ch.Y[p1];
                double a = Math.Atan2(dy, dx);
                if (a < 0) a += Math.PI;
                if (a >= Math.PI) a -= Math.PI;
                ang[k] = a;
                int backed = 0, count = 0;
                for (int j = j1; j < j2; j++)
                {
                    int idx = ch.Closed ? (j % m + m) % m : j;
                    if (idx < 0 || idx >= m) continue;
                    count++;
                    if (eBacked[ch.Edges[idx]]) backed++;
                }
                bf[k] = count > 0 ? (double)backed / count : 0;
                if (bf[k] >= opt.SnapMinBackedFrac)
                {
                    int bin = (int)(a * 180 / Math.PI) % Bins;
                    wRaw[bin] += cellFt;
                    aRaw[bin] += cellFt * (a * 180 / Math.PI);
                }
            }
        }

        // ---- dominant directions: circular smoothing + NMS peak extraction ----
        double total = wRaw.Sum();
        var dirs = new List<double>();       // radians, ascending
        var dirShares = new List<double>();
        if (total > 0)
        {
            var kernel = new double[9];
            for (int d = -4; d <= 4; d++) kernel[d + 4] = Math.Exp(-d * d / 8.0);
            double kSum = kernel.Sum();
            var smooth = new double[Bins];
            for (int b = 0; b < Bins; b++)
            {
                double s = 0;
                for (int d = -4; d <= 4; d++) s += kernel[d + 4] * wRaw[((b + d) % Bins + Bins) % Bins];
                smooth[b] = s / kSum;
            }
            int sep = Math.Max(1, (int)Math.Round(opt.SnapDirSepDeg));
            for (int b = 0; b < Bins; b++)
            {
                double v = smooth[b];
                if (v <= 0) continue;
                bool isMax = true;
                for (int d = 1; d <= sep && isMax; d++)
                {
                    if (smooth[((b - d) % Bins + Bins) % Bins] >= v) isMax = false;
                    else if (smooth[(b + d) % Bins] > v) isMax = false;
                }
                if (!isMax) continue;
                // Refine from the ACTUAL contributing angles, not bin centers — bin-center
                // averaging biased perfectly axis-aligned walls to 0.5/90.5 deg, tilting every
                // fitted line (measured: corner joggle junk on the synthetic estate).
                double local = 0, sw = 0, sa = 0;
                for (int d = -4; d <= 4; d++)
                {
                    int bb = ((b + d) % Bins + Bins) % Bins;
                    double w = wRaw[bb];
                    if (Math.Abs(d) <= 3) local += w;
                    if (w <= 0) continue;
                    double binMean = aRaw[bb] / w;              // mean actual angle of this bin
                    double rel = binMean - (b + 0.5);           // unwrap relative to the peak
                    if (rel > 90) binMean -= 180;
                    else if (rel < -90) binMean += 180;
                    sw += w; sa += w * binMean;
                }
                if (local < opt.SnapDirMinShare * total) continue;
                double deg = (sw > 0 ? sa / sw : b + 0.5) % 180;
                if (deg < 0) deg += 180;
                dirs.Add(deg * Math.PI / 180);
                dirShares.Add(local / total);
            }
        }
        var dirOrder = Enumerable.Range(0, dirs.Count).OrderBy(i => dirs[i]).ToList();
        dirs = dirOrder.Select(i => dirs[i]).ToList();
        dirShares = dirOrder.Select(i => dirShares[i]).ToList();
        log("[snap] " + (dirs.Count == 0
            ? "no dominant directions detected — boundaries stay raw"
            : $"directions: " + string.Join(" ", dirs.Select(
                (a, i) => $"{a * 180 / Math.PI:F1}deg({dirShares[i] * 100:F0}%)"))));

        static double AngDist(double a, double b)
        {
            double d = Math.Abs(a - b) % Math.PI;
            return Math.Min(d, Math.PI - d);
        }

        // ---- per-edge direction assignment + run building + constrained line fits ----
        double tolRad = opt.SnapDirTolDeg * Math.PI / 180;
        for (int ci = 0; ci < chains.Count; ci++)
        {
            var ch = chains[ci];
            int m = ch.Edges.Count;
            ch.Dir = new int[m];
            for (int k = 0; k < m; k++)
            {
                ch.Dir[k] = -1;
                if (chBackedFrac[ci][k] < opt.SnapMinBackedFrac) continue;
                int best = -1; double bestD = tolRad;
                for (int di = 0; di < dirs.Count; di++)
                {
                    double d = AngDist(chAngle[ci][k], dirs[di]);
                    if (d <= bestD) { bestD = d; best = di; }
                }
                ch.Dir[k] = best;
            }

            // rotate closed chains so edge 0 sits at a direction-change boundary
            if (ch.Closed && m > 1)
            {
                int k0 = -1;
                for (int k = 0; k < m; k++)
                    if (ch.Dir[k] != ch.Dir[(k - 1 + m) % m]) { k0 = k; break; }
                if (k0 > 0)
                {
                    var nodes = new List<int>(m + 1);
                    var edges = new List<int>(m);
                    var xs = new double[m + 1]; var ys = new double[m + 1];
                    var dd = new int[m];
                    for (int i = 0; i < m; i++)
                    {
                        int s = (k0 + i) % m;
                        nodes.Add(ch.Nodes[s]); edges.Add(ch.Edges[s]);
                        xs[i] = ch.X[s]; ys[i] = ch.Y[s]; dd[i] = ch.Dir[s];
                    }
                    nodes.Add(ch.Nodes[k0]); xs[m] = ch.X[k0]; ys[m] = ch.Y[k0];
                    ch.Nodes = nodes; ch.Edges = edges; ch.X = xs; ch.Y = ys; ch.Dir = dd;
                }
            }

            // runs of constant direction
            ch.Runs.Clear();
            int r0 = 0;
            for (int k = 1; k <= m; k++)
                if (k == m || ch.Dir[k] != ch.Dir[r0])
                {
                    ch.Runs.Add(new Run { Start = r0, End = k - 1, Dir = ch.Dir[r0] });
                    r0 = k;
                }
            // absorb short raw gaps between same-direction runs (door-jamb noise)
            for (int i = 1; i + 1 < ch.Runs.Count; i++)
            {
                var r = ch.Runs[i];
                if (r.Dir == -1 && (r.End - r.Start + 1) * cellFt < opt.SnapMinRunFt
                    && ch.Runs[i - 1].Dir >= 0 && ch.Runs[i - 1].Dir == ch.Runs[i + 1].Dir)
                    r.Dir = ch.Runs[i - 1].Dir;
            }
            // demote too-short line runs; then merge adjacent equal-direction runs
            foreach (var r in ch.Runs)
                if (r.Dir >= 0 && (r.End - r.Start + 1) * cellFt < opt.SnapMinRunFt) r.Dir = -1;
            var merged = new List<Run>();
            foreach (var r in ch.Runs)
            {
                if (merged.Count > 0 && merged[^1].Dir == r.Dir) merged[^1].End = r.End;
                else merged.Add(r);
            }
            ch.Runs = merged;

            // constrained least-squares fit per line run (direction fixed, offset = mean projection)
            foreach (var r in ch.Runs)
            {
                r.StartCons = r.FitStart = r.Start;
                r.EndCons = r.FitEnd = r.End;
                if (r.Dir < 0) continue;
                double nx = -Math.Sin(dirs[r.Dir]), ny = Math.Cos(dirs[r.Dir]);
                double sum = 0; int np = r.End + 1 - r.Start + 1;
                for (int j = r.Start; j <= r.End + 1; j++) sum += ch.X[j] * nx + ch.Y[j] * ny;
                r.Offset = sum / np;
                double maxDev = 0;
                for (int j = r.Start; j <= r.End + 1; j++)
                    maxDev = Math.Max(maxDev, Math.Abs(ch.X[j] * nx + ch.Y[j] * ny - r.Offset));
                if (maxDev > opt.SnapMaxDevFt) r.Dir = -1;
                else r.Support = (r.End - r.Start + 1) * cellFt;
            }

            // corner absorption: the secant window blends directions across an L corner, leaving
            // a short raw runlet between two different-direction lines; if that runlet hugs the
            // wedge of the two lines, delete it so the lines meet at their intersection.
            bool HugsWedge(Run r, Run a, Run b)
            {
                double naX = -Math.Sin(dirs[a.Dir]), naY = Math.Cos(dirs[a.Dir]);
                double nbX = -Math.Sin(dirs[b.Dir]), nbY = Math.Cos(dirs[b.Dir]);
                for (int p = r.Start; p <= r.End + 1; p++)
                {
                    double da = Math.Abs(ch.X[p] * naX + ch.Y[p] * naY - a.Offset);
                    double db = Math.Abs(ch.X[p] * nbX + ch.Y[p] * nbY - b.Offset);
                    if (Math.Min(da, db) > opt.SnapMaxDevFt) return false;
                }
                return true;
            }
            for (int i = ch.Runs.Count - 2; i >= 1; i--)
            {
                var r = ch.Runs[i];
                var a = ch.Runs[i - 1]; var b = ch.Runs[i + 1];
                if (r.Dir >= 0 || a.Dir < 0 || b.Dir < 0 || a.Dir == b.Dir) continue;
                if ((r.End - r.Start + 1) * cellFt > opt.SnapWindowFt) continue;
                if (!HugsWedge(r, a, b)) continue;
                a.End = a.EndCons = r.End;
                ch.Runs.RemoveAt(i);
            }
            if (ch.Closed && ch.Runs.Count >= 3)
            {
                var r = ch.Runs[^1];
                var a = ch.Runs[^2]; var b = ch.Runs[0];
                if (r.Dir < 0 && a.Dir >= 0 && b.Dir >= 0 && a.Dir != b.Dir
                    && (r.End - r.Start + 1) * cellFt <= opt.SnapWindowFt && HugsWedge(r, a, b))
                {
                    a.End = a.EndCons = r.End;
                    ch.Runs.RemoveAt(ch.Runs.Count - 1);
                }
            }

            // terminal absorption: clamped windows at open-chain ends have arbitrary secant
            // parity, and watershed fronts drift inside wall-JOINT ink blobs, leaving short raw
            // stubs before the junction. When the stub itself is evidence-backed (it lives in
            // wall ink), the fitted line is the better centerline estimate — extend the line to
            // the junction (which then sees it as an intersection candidate). Unbacked stubs
            // (open-plan jags) stay raw; the per-room area guard bounds any overreach.
            bool StubBacked(Run r)
            {
                int backed = 0;
                for (int e = r.Start; e <= r.End; e++)
                    if (eBacked[ch.Edges[e]]) backed++;
                return backed >= opt.SnapMinBackedFrac * (r.End - r.Start + 1);
            }
            if (!ch.Closed)
            {
                if (ch.Runs.Count >= 2 && ch.Runs[0].Dir < 0 && ch.Runs[1].Dir >= 0
                    && (ch.Runs[0].End - ch.Runs[0].Start + 1) * cellFt <= opt.SnapWindowFt
                    && StubBacked(ch.Runs[0]))
                {
                    ch.Runs[1].Start = ch.Runs[0].Start;
                    ch.Runs.RemoveAt(0);
                }
                if (ch.Runs.Count >= 2 && ch.Runs[^1].Dir < 0 && ch.Runs[^2].Dir >= 0
                    && (ch.Runs[^1].End - ch.Runs[^1].Start + 1) * cellFt <= opt.SnapWindowFt
                    && StubBacked(ch.Runs[^1]))
                {
                    ch.Runs[^2].End = ch.Runs[^1].End;
                    ch.Runs.RemoveAt(ch.Runs.Count - 1);
                }
            }
        }

        // ---- line arrangement: cluster colinear runs per direction to shared wall lines ----
        for (int di = 0; di < dirs.Count; di++)
        {
            var members = new List<(Chain ch, Run r)>();
            foreach (var ch in chains)
                foreach (var r in ch.Runs)
                    if (r.Dir == di) members.Add((ch, r));
            members = members.OrderBy(t => t.r.Offset).ThenBy(t => chains.IndexOf(t.ch))
                .ThenBy(t => t.r.Start).ToList();
            int c0 = 0;
            for (int i = 1; i <= members.Count; i++)
            {
                if (i < members.Count && members[i].r.Offset - members[i - 1].r.Offset <= opt.SnapColinearTolFt)
                    continue;
                double supSum = 0, offSum = 0;
                for (int j = c0; j < i; j++)
                {
                    supSum += members[j].r.Support;
                    offSum += members[j].r.Support * members[j].r.Offset;
                }
                double clusterOff = offSum / supSum;
                double nx = -Math.Sin(dirs[di]), ny = Math.Cos(dirs[di]);
                for (int j = c0; j < i; j++)
                {
                    var (ch, r) = members[j];
                    double maxDev = 0;
                    for (int p = r.FitStart; p <= r.FitEnd + 1; p++)
                        maxDev = Math.Max(maxDev, Math.Abs(ch.X[p] * nx + ch.Y[p] * ny - clusterOff));
                    if (maxDev <= opt.SnapMaxDevFt) { r.Offset = clusterOff; r.Support = supSum; }
                }
                c0 = i;
            }
        }

        // ---- room -> chains map + raster loops (computed once) ----
        double cellArea = cellFt * cellFt;
        var roomChains = emitIds.ToDictionary(id => id, _ => new List<int>());
        for (int ci = 0; ci < chains.Count; ci++)
        {
            if (chains[ci].A > 0) roomChains[chains[ci].A].Add(ci);
            if (chains[ci].B > 0) roomChains[chains[ci].B].Add(ci);
        }
        var loopsById = emitIds.ToDictionary(
            id => id, id => Detector.TraceLoops(cellsById[id], mapped, id, W, H));

        // ---- snap + guard + staged revert loop (per-chain: full -> conservative -> raw) ----
        var frozen = new HashSet<int>();
        var result = new Dictionary<int, List<List<double[]>>>();
        int iterations = 0;
        for (int iter = 0; ; iter++)
        {
            iterations = iter + 1;
            if (iter == 12)
            {
                // final fallback: everything raw + every junction pinned == pre-snap raster
                foreach (var c in chains) c.Level = 2;
                foreach (var c in chains) { frozen.Add(c.Nodes[0]); frozen.Add(c.Nodes[^1]); }
            }
            var jpos = ResolveJunctions(chains, frozen, dirs, minX, minY, nodeW, cellFt, opt);
            for (int ci = 0; ci < chains.Count; ci++)
            {
                var ch = chains[ci];
                var runs = EffectiveRuns(ch, ch.Level);
                ch.IsRaw = ch.Level >= 2 || runs.All(r => r.Dir < 0);
                ch.Snapped = RebuildChain(ch, runs, ch.IsRaw, jpos, dirs, opt);
            }
            result.Clear();
            var failures = new List<int>();
            foreach (int id in emitIds)
            {
                var loops = AssembleLoops(loopsById[id], chains, edgeChain, eN1, eN2, nodeW);
                var collapsed = loops.Select(Detector.CollapseCollinear).Where(p => p.Count >= 3).ToList();
                bool touched = false;
                foreach (int ci in roomChains[id])
                {
                    var ch = chains[ci];
                    if (!ch.IsRaw) { touched = true; break; }
                    foreach (int node in new[] { ch.Nodes[0], ch.Nodes[^1] })
                        if (jpos.ContainsKey(node)) { touched = true; break; }
                    if (touched) break;
                }
                if (touched && !GuardOk(collapsed, cellsById[id].Count * cellArea))
                { failures.Add(id); continue; }
                result[id] = collapsed;
            }
            if (failures.Count == 0) break;
            foreach (int id in failures)
            {
                bool anyNew = false;
                foreach (int ci in roomChains[id])
                    if (chains[ci].Level < 2) { chains[ci].Level++; anyNew = true; }
                if (!anyNew)
                    foreach (int ci in roomChains[id])
                    { frozen.Add(chains[ci].Nodes[0]); frozen.Add(chains[ci].Nodes[^1]); }
            }
        }

        double totalLen = chains.Sum(ch => ch.Edges.Count) * cellFt;
        double snappedLen = chains.Where(ch => !ch.IsRaw)
            .Sum(ch => EffectiveRuns(ch, ch.Level).Where(r => r.Dir >= 0).Sum(r => r.End - r.Start + 1)) * cellFt;
        int demoted = chains.Count(c => c.Level == 1), rawed = chains.Count(c => c.Level >= 2);
        log($"[snap] chains={chains.Count} boundary={totalLen:F0}ft snapped={snappedLen:F0}ft " +
            $"({(totalLen > 0 ? 100 * snappedLen / totalLen : 0):F0}%) demotedChains={demoted} " +
            $"rawChains={rawed} frozenJunctions={frozen.Count} iterations={iterations}");
        return result;
    }

    // Junction positions: intersection of the two best-supported non-parallel incident wall
    // lines (capped move), else projection onto the single incident line, else stay put.
    private static Dictionary<int, double[]> ResolveJunctions(
        List<Chain> chains, HashSet<int> frozen, List<double> dirs,
        double minX, double minY, int nodeW, double cellFt, TakeoffOptions opt)
    {
        var cand = new SortedDictionary<int, List<(double sup, int dir, double off)>>();
        void Add(int node, Run r)
        {
            if (!cand.TryGetValue(node, out var list)) cand[node] = list = new List<(double, int, double)>();
            list.Add((r.Support, r.Dir, r.Offset));
        }
        for (int ci = 0; ci < chains.Count; ci++)
        {
            var ch = chains[ci];
            if (ch.Closed || ch.Level >= 2) continue;
            var runs = EffectiveRuns(ch, ch.Level);
            if (runs.Count == 0) continue;
            var first = runs[0];
            if (first.Dir >= 0 && first.Start == 0) Add(ch.Nodes[0], first);
            var last = runs[^1];
            if (last.Dir >= 0 && last.End == ch.Edges.Count - 1) Add(ch.Nodes[^1], last);
        }
        var jpos = new Dictionary<int, double[]>();
        foreach (var (node, rawList) in cand)
        {
            if (frozen.Contains(node)) continue;
            var list = rawList.GroupBy(t => (t.dir, t.off))
                .Select(g => (sup: g.Max(t => t.sup), g.Key.dir, g.Key.off))
                .OrderByDescending(t => t.sup).ThenBy(t => t.dir).ThenBy(t => t.off).ToList();
            var best = list[0];
            double ox = minX + node % nodeW * cellFt, oy = minY + node / nodeW * cellFt;
            double[]? pos = null;
            foreach (var second in list.Skip(1))
            {
                double sepDeg = AngDistDeg(dirs[best.dir], dirs[second.dir]);
                if (sepDeg < MinCornerAngleDeg) continue;
                var x = Intersect(dirs[best.dir], best.off, dirs[second.dir], second.off);
                if (Dist(x[0], x[1], ox, oy) <= opt.SnapMaxCornerMoveFt) pos = x;
                break;
            }
            if (pos == null)
            {
                var pr = Project(ox, oy, dirs[best.dir], best.off);
                if (Dist(pr[0], pr[1], ox, oy) <= opt.SnapMaxCornerMoveFt
                    && Dist(pr[0], pr[1], ox, oy) > 1e-12) pos = pr;
            }
            if (pos != null) jpos[node] = pos;
        }
        return jpos;
    }

    private static List<double[]> RebuildChain(
        Chain ch, List<Run> runs, bool raw, Dictionary<int, double[]> jpos, List<double> dirs,
        TakeoffOptions opt)
    {
        int m = ch.Edges.Count;
        double[] P(int j) => new[] { ch.X[j], ch.Y[j] };
        double[] NodePos(int idx)
        {
            int node = ch.Nodes[idx];
            return jpos.TryGetValue(node, out var p) ? p : P(idx);
        }
        var pts = new List<double[]>();
        void Append(double[] p)
        {
            if (pts.Count == 0 || Dist(pts[^1][0], pts[^1][1], p[0], p[1]) > 1e-9) pts.Add(p);
        }

        if (ch.Closed)
        {
            if (raw)
            {
                for (int j = 0; j < m; j++) Append(P(j));
                return pts;
            }
            int q = runs.Count;
            for (int i = 0; i < q; i++)
            {
                var prev = runs[(i - 1 + q) % q];
                var cur = runs[i];
                var t = P(cur.Start);
                var (exit, entry) = Anchor(prev, cur, t, dirs, opt);
                Append(exit); Append(entry);
                if (cur.Dir < 0)
                    for (int j = cur.Start + 1; j <= cur.End; j++) Append(P(j));
            }
            if (pts.Count > 1 && Dist(pts[0][0], pts[0][1], pts[^1][0], pts[^1][1]) <= 1e-9)
                pts.RemoveAt(pts.Count - 1);
            return pts;
        }

        var j0 = NodePos(0);
        var jq = NodePos(ch.Nodes.Count - 1);
        if (raw)
        {
            Append(j0);
            for (int j = 1; j < m; j++) Append(P(j));
            Append(jq);
            return pts;
        }
        Append(j0);
        for (int i = 0; i < runs.Count; i++)
        {
            var r = runs[i];
            if (i == 0 && r.Dir >= 0) Append(Project(j0[0], j0[1], dirs[r.Dir], r.Offset));
            if (i > 0)
            {
                var t = P(r.Start);
                var (exit, entry) = Anchor(runs[i - 1], r, t, dirs, opt);
                Append(exit); Append(entry);
            }
            if (r.Dir < 0)
                for (int j = r.Start + 1; j <= r.End; j++) Append(P(j));
            if (i == runs.Count - 1 && r.Dir >= 0) Append(Project(jq[0], jq[1], dirs[r.Dir], r.Offset));
        }
        Append(jq);
        return pts;
    }

    // Transition between consecutive runs at original corner t: two lines meeting at a healthy
    // angle intersect (capped move); near-parallel or capped-out pairs joggle via projections;
    // a line meeting raw geometry pins the transition onto the line.
    private static (double[] exit, double[] entry) Anchor(
        Run prev, Run cur, double[] t, List<double> dirs, TakeoffOptions opt)
    {
        if (prev.Dir >= 0 && cur.Dir >= 0)
        {
            if (AngDistDeg(dirs[prev.Dir], dirs[cur.Dir]) >= MinCornerAngleDeg)
            {
                var x = Intersect(dirs[prev.Dir], prev.Offset, dirs[cur.Dir], cur.Offset);
                if (Dist(x[0], x[1], t[0], t[1]) <= opt.SnapMaxCornerMoveFt) return (x, x);
            }
            return (Project(t[0], t[1], dirs[prev.Dir], prev.Offset),
                    Project(t[0], t[1], dirs[cur.Dir], cur.Offset));
        }
        if (prev.Dir >= 0)
        {
            var p = Project(t[0], t[1], dirs[prev.Dir], prev.Offset);
            return (p, p);
        }
        if (cur.Dir >= 0)
        {
            var p = Project(t[0], t[1], dirs[cur.Dir], cur.Offset);
            return (p, p);
        }
        return (t, t);
    }

    // Substitute snapped chain geometry into a room's raster loops. Each loop is split into
    // whole-chain traversals (chains never break mid-loop: interior chain nodes are degree-2),
    // orientation-matched by directed first edge, and re-assembled — both bordering rooms use
    // the identical chain polyline, so the partition stays total.
    private static List<List<double[]>> AssembleLoops(
        List<List<(int x, int y)>> intLoops, List<Chain> chains, int[] edgeChain,
        List<int> eN1, List<int> eN2, int nodeW)
    {
        // node-pair -> edge id
        var lookup = new Dictionary<long, int>();
        for (int e = 0; e < eN1.Count; e++)
        {
            long lo = Math.Min(eN1[e], eN2[e]), hi = Math.Max(eN1[e], eN2[e]);
            lookup[lo << 32 | hi] = e;
        }
        var outLoops = new List<List<double[]>>();
        foreach (var lp in intLoops)
        {
            int k = lp.Count;
            var nodeIds = new int[k];
            for (int i = 0; i < k; i++) nodeIds[i] = lp[i].y * nodeW + lp[i].x;
            var cIds = new int[k];
            for (int i = 0; i < k; i++)
            {
                long a = nodeIds[i], b = nodeIds[(i + 1) % k];
                long lo = Math.Min(a, b), hi = Math.Max(a, b);
                cIds[i] = edgeChain[lookup[lo << 32 | hi]];
            }
            var pts = new List<double[]>();
            void Append(double[] p)
            {
                if (pts.Count == 0 || Dist(pts[^1][0], pts[^1][1], p[0], p[1]) > 1e-9) pts.Add(p);
            }
            var ch0 = chains[cIds[0]];
            bool single = ch0.Closed;
            for (int i = 1; single && i < k; i++) single = cIds[i] == cIds[0];
            if (single)
            {
                bool fwd = false;
                for (int i = 0; i < k && !fwd; i++)
                    fwd = nodeIds[i] == ch0.Nodes[0] && nodeIds[(i + 1) % k] == ch0.Nodes[1];
                var src = ch0.Snapped;
                if (fwd) foreach (var p in src) Append(p);
                else for (int i = src.Count - 1; i >= 0; i--) Append(src[i]);
            }
            else
            {
                int start = 0;
                for (int i = 0; i < k; i++)
                    if (cIds[i] != cIds[(i - 1 + k) % k]) { start = i; break; }
                int i0 = start;
                while (i0 < start + k)
                {
                    int ci = cIds[i0 % k];
                    int j = i0;
                    while (j < start + k && cIds[j % k] == ci) j++;
                    var ch = chains[ci];
                    int sNode = nodeIds[i0 % k], nNode = nodeIds[(i0 + 1) % k];
                    bool fwd = ch.Nodes.Count > 1 && ch.Nodes[0] == sNode && ch.Nodes[1] == nNode;
                    if (!fwd && !(ch.Nodes[^1] == sNode && ch.Nodes[^2] == nNode))
                        fwd = ch.Nodes[0] == sNode;
                    var src = ch.Snapped;
                    if (fwd) foreach (var p in src) Append(p);
                    else for (int i = src.Count - 1; i >= 0; i--) Append(src[i]);
                    i0 = j;
                }
            }
            if (pts.Count > 1 && Dist(pts[0][0], pts[0][1], pts[^1][0], pts[^1][1]) <= 1e-9)
                pts.RemoveAt(pts.Count - 1);
            outLoops.Add(pts);
        }
        return outLoops;
    }

    // Per-room guard: simple polygons and area drift vs the raster partition within
    // max(0.5 sqft, 1%). Rooms failing revert their chains to raw (caller loop).
    private static bool GuardOk(List<List<double[]>> collapsed, double rasterSqft)
    {
        if (collapsed.Count == 0) return false;
        foreach (var p in collapsed)
            if (!IsSimple(p)) return false;
        var areas = collapsed.Select(p => Math.Abs(Detector.Shoelace(p))).ToList();
        double outer = areas.Max();
        double net = 2 * outer - areas.Sum();
        double bound = Math.Max(MaxAreaDriftSqft, MaxAreaDriftFrac * rasterSqft);
        return Math.Abs(net - rasterSqft) <= bound;
    }

    private static bool IsSimple(List<double[]> p)
    {
        int m = p.Count;
        for (int i = 0; i < m; i++)
        {
            var a1 = p[i]; var a2 = p[(i + 1) % m];
            for (int j = i + 2; j < m; j++)
            {
                if (i == 0 && j == m - 1) continue;   // adjacent via wrap
                if (SegmentsCross(a1, a2, p[j], p[(j + 1) % m])) return false;
            }
        }
        return true;
    }

    private static bool SegmentsCross(double[] a1, double[] a2, double[] b1, double[] b2)
    {
        const double eps = 1e-9;
        static double Cr(double[] o, double[] a, double[] b) =>
            (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
        double d1 = Cr(b1, b2, a1), d2 = Cr(b1, b2, a2), d3 = Cr(a1, a2, b1), d4 = Cr(a1, a2, b2);
        if ((d1 > eps && d2 < -eps || d1 < -eps && d2 > eps)
            && (d3 > eps && d4 < -eps || d3 < -eps && d4 > eps)) return true;
        static bool OnSeg(double[] s1, double[] s2, double[] c) =>
            c[0] >= Math.Min(s1[0], s2[0]) - eps && c[0] <= Math.Max(s1[0], s2[0]) + eps
            && c[1] >= Math.Min(s1[1], s2[1]) - eps && c[1] <= Math.Max(s1[1], s2[1]) + eps;
        if (Math.Abs(d1) <= eps && OnSeg(b1, b2, a1)) return true;
        if (Math.Abs(d2) <= eps && OnSeg(b1, b2, a2)) return true;
        if (Math.Abs(d3) <= eps && OnSeg(a1, a2, b1)) return true;
        if (Math.Abs(d4) <= eps && OnSeg(a1, a2, b2)) return true;
        return false;
    }

    private static double AngDistDeg(double a, double b)
    {
        double d = Math.Abs(a - b) % Math.PI;
        return Math.Min(d, Math.PI - d) * 180 / Math.PI;
    }

    private static double Dist(double x1, double y1, double x2, double y2) =>
        Math.Sqrt((x1 - x2) * (x1 - x2) + (y1 - y2) * (y1 - y2));

    // line: p . n(theta) == c with n = (-sin theta, cos theta)
    private static double[] Project(double px, double py, double theta, double c)
    {
        double nx = -Math.Sin(theta), ny = Math.Cos(theta);
        double d = c - (px * nx + py * ny);
        return new[] { px + d * nx, py + d * ny };
    }

    private static double[] Intersect(double t1, double c1, double t2, double c2)
    {
        double n1X = -Math.Sin(t1), n1Y = Math.Cos(t1);
        double n2X = -Math.Sin(t2), n2Y = Math.Cos(t2);
        double det = n1X * n2Y - n1Y * n2X;
        return new[] { (c1 * n2Y - c2 * n1Y) / det, (n1X * c2 - n2X * c1) / det };
    }
}
