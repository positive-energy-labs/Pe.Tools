namespace Pe.Revit.Placement;

// Engine: the deterministic middle. Intent -> obstacle index -> lattice A* trunk + branches -> PathDtos.
// Report: the route-grammar voice (HIT/PASS/NEAR/CLEAR + computed fix: lines + VERDICT), used by
// Solve, Commit recheck, and the verbs session alike. The report always checks ALL obstacle groups
// plus links; `avoid` only steers the router.
internal static class Engine
{
    // Routes the intent. Returns the dto (paths only; collision fields are filled by Report.Scan).
    // Throws with a named-blocker diagnosis when the trunk cannot be routed.
    public static SolveDto Solve(Document doc, Intent it, Action<string> Say)
    {
        double lvlZ = it.Level.ProjectElevation; // internal-origin frame (matches geometry); see DuctPlacer.Scout
        double zTrunk = lvlZ + it.TrunkElevFt;
        double zBranch = lvlZ + it.BranchZRel;
        Say($"SOLVE '{it.Name}' level={it.Level.Name} sys={it.System.Name} trunk {it.TrunkWFt * 12:F0}x{it.TrunkHFt * 12:F0}in z={zTrunk:F2} ({it.TrunkElevFt:F2} above level); branches {it.BranchDiaFt * 12:F0}in-dia z={zBranch:F2}");

        // ---- resolve terminals ----
        var terms = new List<(long id, XYZ origin, XYZ basis, bool occupied)>();
        foreach (var tid in it.Terminals)
        {
            var fi = doc.GetElement(tid.ToElementId()) as FamilyInstance;
            var c = fi == null ? null : Draft.TerminalConnector(fi);
            if (c == null) { Say($"WARN terminal {tid}: not found / no HVAC connector — skipped"); continue; }
            var sysName = c.DuctSystemType.ToString();
            if (!it.System.Name.Replace(" ", "").Contains(sysName, StringComparison.OrdinalIgnoreCase))
                Say($"WARN terminal {tid}: connector is {sysName}, intent is {it.System.Name}");
            terms.Add((tid, c.Origin, c.CoordinateSystem.BasisZ, c.IsConnected));
        }

        // ---- solve region + lattice anchored on trunk.from ----
        double cell = it.GridFt;
        var xs = new List<double> { it.FromX, it.ToX };
        var ys = new List<double> { it.FromY, it.ToY };
        foreach (var t in terms) { xs.Add(t.origin.X); ys.Add(t.origin.Y); }
        double rx0 = xs.Min() - 15, rx1 = xs.Max() + 15, ry0 = ys.Min() - 15, ry1 = ys.Max() + 15;
        double ox = it.FromX - Math.Ceiling((it.FromX - rx0) / cell) * cell;
        double oy = it.FromY - Math.Ceiling((it.FromY - ry0) / cell) * cell;
        int nx = (int)Math.Floor((rx1 - ox) / cell) + 1;
        int ny = (int)Math.Floor((ry1 - oy) / cell) + 1;
        if ((long)nx * ny > 300000)
            throw new InvalidOperationException($"solve region {nx}x{ny} cells is too large — coarsen constraints.gridFt or pull endpoints closer");

        double zLo = Math.Min(zTrunk - it.TrunkHFt / 2, zBranch - it.BranchDiaFt / 2);
        double zHi = Math.Max(zTrunk + it.TrunkHFt / 2, zBranch + it.BranchDiaFt / 2);
        foreach (var t in terms) { zLo = Math.Min(zLo, t.origin.Z - 0.5); zHi = Math.Max(zHi, t.origin.Z + 0.5); }
        zLo -= it.ClearanceFt + 0.5; zHi += it.ClearanceFt + 0.5;

        var ix = ObstacleIndex.Build(doc, rx0, ry0, rx1, ry1, zLo, zHi);
        for (int k = 0; k < it.KeepOut.Count; k++)
            ix.AddKeepOut(it.KeepOut[k][0], it.KeepOut[k][1], it.KeepOut[k][2], it.KeepOut[k][3], zLo, zHi, it.KeepOutNames[k]);
        Say($"OBSTACLES: {ix.Summary}; avoid=[{string.Join(",", it.Avoid)}] grid={cell:F1}ft {nx}x{ny}");

        Func<string, bool> avoid = g => it.Avoid.Contains(g);

        // ---- trunk ----
        var occT = ix.Occupancy(ox, oy, nx, ny, cell, it.TrunkWFt / 2, zTrunk - it.TrunkHFt / 2, zTrunk + it.TrunkHFt / 2, it.ClearanceFt, avoid);
        var tr = Router.Route(ox, oy, nx, ny, cell, occT, it.FromX, it.FromY, it.ToX, it.ToY, 6.0, it.MaxBends, -1);
        if (!tr.Ok)
        {
            var why = Diagnose(ix, ox, oy, nx, ny, cell, it, zTrunk, avoid, tr.Fail);
            Say("TRUNK REFUSED: " + why);
            throw new InvalidOperationException("SOLVE FAILED (all changes rolled back; previous draft intact): " + why);
        }
        var dto = new SolveDto
        {
            SolvedAt = DateTime.Now.ToString("yyyy-MM-dd HH:mm:ss"),
            IntentName = it.Name,
            Source = "intent",
            LevelId = it.Level.Id.Value(),
            LevelElev = lvlZ,
            SystemTypeId = it.System.Id.Value(),
            GridFt = cell,
            ClearanceIn = it.ClearanceFt * 12,
            Avoid = it.Avoid.OrderBy(x => x).ToList(),
            KeepOut = it.KeepOut.ToList(),
            KeepOutNames = it.KeepOutNames.ToList(),
            FromElementId = it.FromElementId,
            ToElementId = it.ToElementId,
        };
        dto.Paths.Add(new PathDto
        {
            Key = "trunk", Kind = "trunk", DuctTypeId = it.TrunkType.Id.Value(), Shape = "rect",
            WidthIn = it.TrunkWFt * 12, HeightIn = it.TrunkHFt * 12, ZFt = zTrunk,
            Points = tr.Waypoints, LengthFt = tr.LengthFt, Bends = tr.Bends,
        });
        Say($"TRUNK ok: len {tr.LengthFt:F1} ft, {tr.Bends} bends, goal snap {tr.SnapErrFt * 12:F1} in");

        // ---- branches: occupancy also blocks the trunk itself; takeoffs are carved free ----
        var ixB = new ObstacleIndex();
        ixB.Boxes = new List<ObstacleBox>(ix.Boxes);
        for (int k = 1; k < tr.Waypoints.Count; k++)
            ixB.Boxes.Add(new ObstacleBox
            {
                X0 = Math.Min(tr.Waypoints[k - 1][0], tr.Waypoints[k][0]) - it.TrunkWFt / 2,
                X1 = Math.Max(tr.Waypoints[k - 1][0], tr.Waypoints[k][0]) + it.TrunkWFt / 2,
                Y0 = Math.Min(tr.Waypoints[k - 1][1], tr.Waypoints[k][1]) - it.TrunkWFt / 2,
                Y1 = Math.Max(tr.Waypoints[k - 1][1], tr.Waypoints[k][1]) + it.TrunkWFt / 2,
                Z0 = zTrunk - it.TrunkHFt / 2, Z1 = zTrunk + it.TrunkHFt / 2,
                Group = "trunk", Label = "my trunk", Id = -1,
            });
        Func<string, bool> avoidB = g => g == "trunk" || it.Avoid.Contains(g);
        var occB = ixB.Occupancy(ox, oy, nx, ny, cell, it.BranchDiaFt / 2, zBranch - it.BranchDiaFt / 2, zBranch + it.BranchDiaFt / 2, it.ClearanceFt, avoidB);

        foreach (var t in terms)
        {
            bool vertical = Math.Abs(t.basis.Z) > 0.7;
            double coz = t.origin.Z;
            double ux = 0, uy = 0, gx, gy;
            if (vertical) { gx = t.origin.X; gy = t.origin.Y; }
            else
            {
                ux = t.basis.X; uy = t.basis.Y;
                double ul = Math.Sqrt(ux * ux + uy * uy);
                ux /= ul; uy /= ul;
                double d1 = DistToPolyline(tr.Waypoints, t.origin.X + ux * it.StubFt, t.origin.Y + uy * it.StubFt);
                double d2 = DistToPolyline(tr.Waypoints, t.origin.X - ux * it.StubFt, t.origin.Y - uy * it.StubFt);
                if (d2 < d1) { ux = -ux; uy = -uy; }
                gx = t.origin.X + ux * it.StubFt; gy = t.origin.Y + uy * it.StubFt;
            }
            CarveDisk(occB, ox, oy, nx, ny, cell, gx, gy, 1.3);

            var tk = TakeoffOn(tr.Waypoints, gx, gy, cell, ox, oy);
            CarveDisk(occB, ox, oy, nx, ny, cell, tk.x, tk.y, 1.3);
            int force = tk.alongX ? (gy > tk.y ? 2 : 3) : (gx > tk.x ? 0 : 1);

            var rr = Router.Route(ox, oy, nx, ny, cell, occB, tk.x, tk.y, gx, gy, 4.0, it.MaxBends, force);
            if (!rr.Ok) { Say($"BRANCH {t.id} REFUSED: {rr.Fail} — skipped (edit constraints and re-solve)"); continue; }

            var p = new PathDto
            {
                Key = t.id.ToString(), Kind = "branch", DuctTypeId = it.BranchType.Id.Value(), Shape = "round",
                DiaIn = it.BranchDiaFt * 12, ZFt = zBranch, Points = rr.Waypoints,
                LengthFt = rr.LengthFt, Bends = rr.Bends, TerminalId = t.id, Connect = it.Connect,
                Conn = new[] { t.origin.X, t.origin.Y, coz },
            };
            double sb = t.occupied || !it.Connect ? Draft.Setback : 0;
            if (vertical)
            {
                if (Math.Abs(coz - zBranch) > 0.05)
                    p.Riser = new RiserDto { X = gx, Y = gy, Z0 = zBranch, Z1 = coz + Math.Sign(zBranch - coz) * sb };
            }
            else
            {
                if (Math.Abs(coz - zBranch) >= 0.2)
                    p.Riser = new RiserDto { X = gx, Y = gy, Z0 = zBranch, Z1 = coz };
                p.Stub = new StubDto
                {
                    From = new[] { gx, gy, p.Riser != null ? coz : zBranch },
                    To = new[] { t.origin.X + ux * sb, t.origin.Y + uy * sb, coz },
                };
            }
            p.TerminalStatus = !it.Connect ? "connect=false (drop ends near terminal)"
                : t.occupied ? $"terminal already connected -> near-connect ({Draft.Setback * 12:F1} in short)"
                : "terminal free -> will connect at commit";
            dto.Paths.Add(p);
            var riserTxt = p.Riser != null ? $", riser {Math.Abs(p.Riser.Z1 - p.Riser.Z0):F1} ft {(p.Riser.Z1 > p.Riser.Z0 ? "up" : "down")}" : "";
            Say($"BRANCH {t.id} ok: len {rr.LengthFt:F1} ft, {rr.Bends} bends{riserTxt}; {p.TerminalStatus}");
        }
        return dto;
    }

    // ---------- named-blocker refusal diagnosis (mep-solve, verbatim) ----------
    static string Diagnose(ObstacleIndex ix, double ox, double oy, int nx, int ny, double cell,
        Intent it, double zT, Func<string, bool> avoid, string baseFail)
    {
        double z0 = zT - it.TrunkHFt / 2, z1 = zT + it.TrunkHFt / 2;
        double pad = it.TrunkWFt / 2 + it.ClearanceFt;
        var detail = $" | at from: {Named(ix, it.FromX, it.FromY, z0, z1, pad, it.ClearanceFt, avoid)} | at to: {Named(ix, it.ToX, it.ToY, z0, z1, pad, it.ClearanceFt, avoid)} | along straight from->to: {LineScan(ix, it, z0, z1, pad, avoid)}";
        var occ0 = ix.Occupancy(ox, oy, nx, ny, cell, it.TrunkWFt / 2, z0, z1, 0, avoid);
        var r0 = Router.Route(ox, oy, nx, ny, cell, occ0, it.FromX, it.FromY, it.ToX, it.ToY, 6.0, 99, -1);
        if (r0.Ok) return $"{baseFail}; a path EXISTS at zero clearance — clearanceIn={it.ClearanceFt * 12:F1} is the binding constraint (reduce it, or change trunk.elevationFt){detail}";
        var rE = Router.Route(ox, oy, nx, ny, cell, new byte[nx, ny], it.FromX, it.FromY, it.ToX, it.ToY, 6.0, 99, -1);
        if (rE.Ok) return $"{baseFail}; avoided obstacles fully block z={zT:F2} between from/to — change trunk.elevationFt, drop groups from constraints.avoid, or reroute endpoints{detail}";
        return $"{baseFail}; endpoints unreachable even with zero obstacles — check trunk.from/to are sane model coordinates{detail}";
    }

    static string Named(ObstacleIndex ix, double x, double y, double z0, double z1, double pad, double clearZ, Func<string, bool> avoid)
    {
        var at = ix.At(x, y, z0, z1, pad, clearZ, avoid);
        return at.Count == 0 ? "clear"
            : string.Join("; ", at.Take(3).Select(b => $"{b.Group} {b.Label} {b.Id} z[{b.Z0:F1},{b.Z1:F1}] xy({b.X0:F1},{b.Y0:F1})..({b.X1:F1},{b.Y1:F1})"));
    }

    static string LineScan(ObstacleIndex ix, Intent it, double z0, double z1, double pad, Func<string, bool> avoid)
    {
        var seen = new Dictionary<long, string>();
        double dx = it.ToX - it.FromX, dy = it.ToY - it.FromY;
        double len = Math.Sqrt(dx * dx + dy * dy);
        int n = Math.Max(2, (int)(len / 1));  // 1-ft sampling: 2-ft can miss thin risers (mep-solve NOTES)
        for (int k = 0; k <= n && seen.Count < 5; k++)
            foreach (var b in ix.At(it.FromX + dx * k / n, it.FromY + dy * k / n, z0, z1, pad, it.ClearanceFt, avoid))
                if (!seen.ContainsKey(b.Id)) seen[b.Id] = $"{b.Group} {b.Label} {b.Id} z[{b.Z0:F1},{b.Z1:F1}]";
        return seen.Count == 0 ? "clear" : string.Join("; ", seen.Values.Take(5));
    }

    // ---------- shared geometry ----------

    // axis-aligned boxes for a path: legs + riser + stub. kind: leg|riser|stub
    public static IEnumerable<(double x0, double y0, double z0, double x1, double y1, double z1, string kind)> SegBoxes(PathDto p)
    {
        double halfW = (p.Shape == "rect" ? p.WidthIn : p.DiaIn) / 24.0;
        double halfH = (p.Shape == "rect" ? p.HeightIn : p.DiaIn) / 24.0;
        if (p.Points3 != null && p.Points3.Count > 1)
        {
            // verbs mode: 3D polyline, direction-aware inflation (diagonals get conservative AABBs)
            for (int k = 1; k < p.Points3.Count; k++)
            {
                double ax = p.Points3[k - 1][0], ay = p.Points3[k - 1][1], az = p.Points3[k - 1][2];
                double bx = p.Points3[k][0], by = p.Points3[k][1], bz = p.Points3[k][2];
                bool vert = Math.Abs(bz - az) > 0.05 && Math.Abs(bx - ax) < 0.05 && Math.Abs(by - ay) < 0.05;
                bool alongX = !vert && Math.Abs(by - ay) < 0.05 && Math.Abs(bz - az) < 0.05;
                bool alongY = !vert && Math.Abs(bx - ax) < 0.05 && Math.Abs(bz - az) < 0.05;
                double px = vert || alongY ? halfW : (alongX ? 0 : halfW);
                double py = vert || alongX ? halfW : (alongY ? 0 : halfW);
                double pz = vert ? 0 : halfH;
                yield return (Math.Min(ax, bx) - px, Math.Min(ay, by) - py, Math.Min(az, bz) - pz,
                              Math.Max(ax, bx) + px, Math.Max(ay, by) + py, Math.Max(az, bz) + pz,
                              vert ? "riser" : "leg");
            }
            if (p.Riser != null)
                yield return (p.Riser.X - halfW, p.Riser.Y - halfW, Math.Min(p.Riser.Z0, p.Riser.Z1),
                              p.Riser.X + halfW, p.Riser.Y + halfW, Math.Max(p.Riser.Z0, p.Riser.Z1), "riser");
            if (p.Stub != null)
                yield return (Math.Min(p.Stub.From[0], p.Stub.To[0]) - halfW, Math.Min(p.Stub.From[1], p.Stub.To[1]) - halfW, Math.Min(p.Stub.From[2], p.Stub.To[2]) - halfH,
                              Math.Max(p.Stub.From[0], p.Stub.To[0]) + halfW, Math.Max(p.Stub.From[1], p.Stub.To[1]) + halfW, Math.Max(p.Stub.From[2], p.Stub.To[2]) + halfH, "stub");
            yield break;
        }
        for (int k = 1; k < p.Points.Count; k++)
        {
            double ax = p.Points[k - 1][0], ay = p.Points[k - 1][1], bx = p.Points[k][0], by = p.Points[k][1];
            bool alongX = Math.Abs(by - ay) < 0.05, alongY = Math.Abs(bx - ax) < 0.05;
            double px = alongY ? halfW : (alongX ? 0 : halfW);
            double py = alongX ? halfW : (alongY ? 0 : halfW);
            yield return (Math.Min(ax, bx) - px, Math.Min(ay, by) - py, p.ZFt - halfH,
                          Math.Max(ax, bx) + px, Math.Max(ay, by) + py, p.ZFt + halfH, "leg");
        }
        if (p.Riser != null)
            yield return (p.Riser.X - halfW, p.Riser.Y - halfW, Math.Min(p.Riser.Z0, p.Riser.Z1),
                          p.Riser.X + halfW, p.Riser.Y + halfW, Math.Max(p.Riser.Z0, p.Riser.Z1), "riser");
        if (p.Stub != null)
            yield return (Math.Min(p.Stub.From[0], p.Stub.To[0]) - halfW, Math.Min(p.Stub.From[1], p.Stub.To[1]) - halfW, Math.Min(p.Stub.From[2], p.Stub.To[2]) - halfH,
                          Math.Max(p.Stub.From[0], p.Stub.To[0]) + halfW, Math.Max(p.Stub.From[1], p.Stub.To[1]) + halfW, Math.Max(p.Stub.From[2], p.Stub.To[2]) + halfH, "stub");
    }

    public static double DistToPolyline(List<double[]> wp, double x, double y)
    {
        double best = double.MaxValue;
        for (int k = 1; k < wp.Count; k++)
        {
            double ax = wp[k - 1][0], ay = wp[k - 1][1], bx = wp[k][0], by = wp[k][1];
            double vx = bx - ax, vy = by - ay;
            double len2 = vx * vx + vy * vy;
            double t = len2 < 1e-12 ? 0 : Math.Max(0, Math.Min(1, ((x - ax) * vx + (y - ay) * vy) / len2));
            double dx = x - (ax + t * vx), dy = y - (ay + t * vy);
            best = Math.Min(best, Math.Sqrt(dx * dx + dy * dy));
        }
        return best;
    }

    // nearest lattice point ON the trunk polyline to (gx,gy), kept >=1 ft from leg ends
    public static (double x, double y, bool alongX) TakeoffOn(List<double[]> wp, double gx, double gy, double cell, double ox, double oy)
    {
        double bx = wp[0][0], by = wp[0][1]; bool bAlongX = true; double bd = double.MaxValue;
        for (int k = 1; k < wp.Count; k++)
        {
            double ax = wp[k - 1][0], ay = wp[k - 1][1], cx = wp[k][0], cy = wp[k][1];
            bool alongX = Math.Abs(cy - ay) < 0.05;
            double px, py;
            if (alongX)
            {
                double lo = Math.Min(ax, cx), hi = Math.Max(ax, cx);
                double margin = Math.Min(1.0, (hi - lo) / 2);
                px = Math.Max(lo + margin, Math.Min(hi - margin, gx));
                px = ox + Math.Round((px - ox) / cell) * cell;
                px = Math.Max(lo, Math.Min(hi, px));
                py = ay;
            }
            else
            {
                double lo = Math.Min(ay, cy), hi = Math.Max(ay, cy);
                double margin = Math.Min(1.0, (hi - lo) / 2);
                py = Math.Max(lo + margin, Math.Min(hi - margin, gy));
                py = oy + Math.Round((py - oy) / cell) * cell;
                py = Math.Max(lo, Math.Min(hi, py));
                px = ax;
            }
            double d = Math.Sqrt((px - gx) * (px - gx) + (py - gy) * (py - gy));
            if (d < bd) { bd = d; bx = px; by = py; bAlongX = alongX; }
        }
        return (bx, by, bAlongX);
    }

    static void CarveDisk(byte[,] occ, double ox, double oy, int nx, int ny, double cell, double x, double y, double r)
    {
        int i0 = Math.Max(0, (int)Math.Floor((x - r - ox) / cell)), i1 = Math.Min(nx - 1, (int)Math.Ceiling((x + r - ox) / cell));
        int j0 = Math.Max(0, (int)Math.Floor((y - r - oy) / cell)), j1 = Math.Min(ny - 1, (int)Math.Ceiling((y + r - oy) / cell));
        for (int i = i0; i <= i1; i++)
            for (int j = j0; j <= j1; j++)
            {
                double dx = ox + i * cell - x, dy = oy + j * cell - y;
                if (dx * dx + dy * dy <= r * r) occ[i, j] = 0;
            }
    }
}

// ---------- the feedback voice (from mep-route, adapted to bbox scan honesty) ----------
internal static class Report
{
    // Scans dto geometry vs a fresh full obstacle index (ALL groups + links + keepOuts, regardless
    // of avoid). Fills dto.Collisions/Exempted/SelfHits and per-path fields. Prints route grammar:
    //   PATH header, then HIT (with computed fix:), PASS (walls when not avoided), NEAR, CLEAR.
    public static void Scan(Document doc, SolveDto s, Action<string> Say)
    {
        double rx0 = 1e9, ry0 = 1e9, rx1 = -1e9, ry1 = -1e9, zLo = 1e9, zHi = -1e9;
        foreach (var p in s.Paths)
            foreach (var b in Engine.SegBoxes(p))
            {
                rx0 = Math.Min(rx0, b.x0); ry0 = Math.Min(ry0, b.y0); zLo = Math.Min(zLo, b.z0);
                rx1 = Math.Max(rx1, b.x1); ry1 = Math.Max(ry1, b.y1); zHi = Math.Max(zHi, b.z1);
            }
        if (rx0 > rx1) { Say("SCAN: no paths to check"); return; }
        var ix = ObstacleIndex.Build(doc, rx0 - 5, ry0 - 5, rx1 + 5, ry1 + 5, zLo - 1, zHi + 1);
        for (int k = 0; k < s.KeepOut.Count; k++)
            ix.AddKeepOut(s.KeepOut[k][0], s.KeepOut[k][1], s.KeepOut[k][2], s.KeepOut[k][3], zLo - 1, zHi + 1,
                k < s.KeepOutNames.Count ? s.KeepOutNames[k] : $"keepOut{k}");

        var connZones = s.Paths.Where(p => p.Conn != null).Select(p => p.Conn).ToList();
        var avoid = new HashSet<string>(s.Avoid, StringComparer.OrdinalIgnoreCase);
        double clearFt = s.ClearanceIn / 12.0;

        int collisions = 0, exempted = 0, passes = 0, nears = 0;
        foreach (var p in s.Paths)
        {
            double halfH = (p.Shape == "rect" ? p.HeightIn : p.DiaIn) / 24.0;
            string size = p.Shape == "rect" ? $"rect {p.WidthIn:F0}x{p.HeightIn:F0}in" : $"rnd {p.DiaIn:F0}in";
            var a = p.Points.Count > 0 ? p.Points[0] : new[] { 0.0, 0.0 };
            var b2 = p.Points.Count > 0 ? p.Points[^1] : a;
            Say($"{(p.Kind == "trunk" ? "T" : "B")} {p.Key} {size} z={p.ZFt:F2}: ({a[0]:F1},{a[1]:F1})->({b2[0]:F1},{b2[1]:F1}) | {p.LengthFt:F1} ft | {p.Bends} bends");

            int pathHits = 0;
            double minClear = 12.0; string pinch = "";
            var lines = new List<string>();
            foreach (var (x0, y0, z0, x1, y1, z1, kind) in Engine.SegBoxes(p))
            {
                foreach (var hb in ix.HardHits(x0, y0, z0, x1, y1, z1))
                {
                    double cx = (Math.Max(x0, hb.X0) + Math.Min(x1, hb.X1)) / 2;
                    double cy = (Math.Max(y0, hb.Y0) + Math.Min(y1, hb.Y1)) / 2;
                    double cz = (Math.Max(z0, hb.Z0) + Math.Min(z1, hb.Z1)) / 2;
                    bool exempt = connZones.Any(zz => Math.Sqrt(Math.Pow(cx - zz[0], 2) + Math.Pow(cy - zz[1], 2) + Math.Pow(cz - zz[2], 2)) < 1.5);
                    if (exempt) { exempted++; continue; }
                    bool isPass = hb.Group == "walls" && !avoid.Contains("walls");
                    if (isPass)
                    {
                        passes++;
                        lines.Add($"  PASS {hb.Group} {hb.Label} {hb.Id} @({cx:F1},{cy:F1},z{cz:F1}) (penetration assumed ok; walls not in avoid)");
                        continue;
                    }
                    pathHits++;
                    if (lines.Count < 14)
                    {
                        lines.Add($"  HIT [{kind}] vs {hb.Group} {hb.Label} {hb.Id} @({cx:F1},{cy:F1},z{cz:F1}) obstacle z[{hb.Z0:F2},{hb.Z1:F2}] xy({hb.X0:F1},{hb.Y0:F1})..({hb.X1:F1},{hb.Y1:F1})  [approx bbox]");
                        var fixes = new List<string>();
                        double drop = hb.Z0 - clearFt - 0.15 - halfH - s.LevelElev;
                        double rise = hb.Z1 + clearFt + 0.15 + halfH - s.LevelElev;
                        fixes.Add($"elevationFt {drop:F2} (drop below)");
                        fixes.Add($"elevationFt {rise:F2} (rise above)");
                        if (!avoid.Contains(hb.Group) && hb.Group != "keepout" && hb.Group != "trunk")
                            fixes.Add($"avoid+=\"{hb.Group}\" (router will dodge it)");
                        else if (kind != "leg")
                            fixes.Add($"move takeoff: keepOut {{min:[{hb.X0 - 1:F0},{hb.Y0 - 1:F0}],max:[{hb.X1 + 1:F0},{hb.Y1 + 1:F0}]}}");
                        lines.Add($"      fix: {string.Join(" | ", fixes)}  [approx, from obstacle bbox]");
                    }
                }
                if (kind == "leg")
                {
                    var mc = ix.MinClearIn(x0, y0, z0, x1, y1, z1);
                    if (mc.Item1 < minClear) { minClear = mc.Item1; pinch = mc.Item2; }
                }
            }
            p.Collisions = pathHits;
            p.MinClearIn = minClear;
            p.Pinch = pinch;
            collisions += pathHits;
            if (pathHits == 0 && minClear < 11.9)
            {
                nears++;
                string tight = minClear < s.ClearanceIn ? $"  [TIGHT: < clearanceIn {s.ClearanceIn:F1}]" : "";
                lines.Add($"  NEAR {pinch} gap {minClear:F1} in{tight}");
            }
            if (lines.Count == 0) lines.Add("  CLEAR nothing within 12 in");
            foreach (var l in lines) Say(l);
        }

        // self-overlaps between my own paths (junction zones excused)
        var junctions = s.Paths.Where(p => p.Kind == "branch" && p.Points.Count > 0)
            .Select(p => new[] { p.Points[0][0], p.Points[0][1] }).ToList();
        int selfHits = 0;
        var all = s.Paths.SelectMany(p => Engine.SegBoxes(p).Select(b => (p.Key, b))).ToList();
        for (int a3 = 0; a3 < all.Count; a3++)
            for (int b3 = a3 + 1; b3 < all.Count; b3++)
            {
                if (all[a3].Key == all[b3].Key) continue;
                var A = all[a3].b; var B = all[b3].b;
                if (A.x0 < B.x1 && A.x1 > B.x0 && A.y0 < B.y1 && A.y1 > B.y0 && A.z0 < B.z1 && A.z1 > B.z0)
                {
                    double cx = (Math.Max(A.x0, B.x0) + Math.Min(A.x1, B.x1)) / 2;
                    double cy = (Math.Max(A.y0, B.y0) + Math.Min(A.y1, B.y1)) / 2;
                    if (!junctions.Any(j => Math.Sqrt(Math.Pow(cx - j[0], 2) + Math.Pow(cy - j[1], 2)) < 1.3)) selfHits++;
                }
            }

        s.Collisions = collisions; s.Exempted = exempted; s.SelfHits = selfHits;
        double totLen = s.Paths.Sum(p => p.LengthFt);
        Say($"SUMMARY '{s.IntentName}': {s.Paths.Count} paths | {totLen:F0} ft | HARD {collisions} | PASS {passes} | NEAR {nears} | self-overlaps {selfHits} | exempted-at-connections {exempted}");
    }

    // Endpoint honesty: when trunk.from/to was declared as {"element": id}, measure the gap from
    // the trunk's path end to that element's nearest physical connector. A run that floats 18 ft
    // above its fan while every collision line reads clean is NOT done — say so, with the fix.
    public static void EndpointGaps(Document doc, SolveDto s, Action<string> Say)
    {
        var trunk = s.Paths.FirstOrDefault(p => p.Kind == "trunk");
        if (trunk == null) return;
        List<double[]> pts;
        if (trunk.Points3 != null && trunk.Points3.Count > 0) pts = trunk.Points3;
        else if (trunk.Points != null && trunk.Points.Count > 0)
            pts = trunk.Points.Select(p => new[] { p[0], p[1], trunk.ZFt }).ToList();
        else return;
        Check(doc, s, "trunk.from", s.FromElementId, pts[0], Say);
        Check(doc, s, "trunk.to", s.ToElementId, pts[pts.Count - 1], Say);
    }

    static void Check(Document doc, SolveDto s, string which, long? idv, double[] end, Action<string> Say)
    {
        if (idv == null) return;
        var el = doc.GetElement(idv.Value.ToElementId());
        if (el == null) { Say($"ENDPOINT {which} -> #{idv}: element no longer in model"); return; }
        ConnectorManager cm = (el as FamilyInstance)?.MEPModel?.ConnectorManager ?? (el as MEPCurve)?.ConnectorManager;
        var ep = new XYZ(end[0], end[1], end[2]);
        var conns = cm?.Connectors.Cast<Connector>()
            .Where(c => c.ConnectorType == ConnectorType.End || c.ConnectorType == ConnectorType.Curve)
            .Where(c => { try { return c.Domain == Domain.DomainHvac; } catch { return false; } })
            .OrderBy(c => c.Origin.DistanceTo(ep)).ToList();
        if (conns == null || conns.Count == 0)
        {
            var bb = el.get_BoundingBox(null);
            double d0 = bb == null ? double.NaN : Math.Max(0, Math.Max(Math.Max(bb.Min.X - ep.X, ep.X - bb.Max.X), Math.Max(Math.Max(bb.Min.Y - ep.Y, ep.Y - bb.Max.Y), Math.Max(bb.Min.Z - ep.Z, ep.Z - bb.Max.Z))));
            Say($"ENDPOINT {which} -> #{idv} ({el.Name}): no MEP connectors; bbox gap {(double.IsNaN(d0) ? "?" : d0.ToString("F1"))} ft");
            return;
        }
        var best = conns.FirstOrDefault(c => !c.IsConnected) ?? conns[0];
        double gap = best.Origin.DistanceTo(ep);
        double dz = best.Origin.Z - ep.Z;
        if (gap <= 0.5)
        {
            Say($"ENDPOINT {which} -> #{idv} ({el.Name}): gap {gap * 12:F1} in{(best.IsConnected ? " (connector already connected)" : "")} — OK (stub range)");
            return;
        }
        double connElev = best.Origin.Z - s.LevelElev;
        Say($"ENDPOINT GAP {which} -> #{idv} ({el.Name}): path end ({ep.X:F1},{ep.Y:F1},{ep.Z:F2}) vs connector ({best.Origin.X:F1},{best.Origin.Y:F1},{best.Origin.Z:F2}) — gap {gap:F1} ft ({Math.Abs(dz):F1} vertical). NOT reaching the declared element; this is unfinished routing, not a stub.");
        Say($"  fix: trunk.elevationFt={connElev:F2} to run at the connector's z, or — after Commit() + Keep() on this run — close the vertical with Verbs().StartAt({best.Origin.X:F1},{best.Origin.Y:F1}).RiseTo({end[2] - s.LevelElev:F2}) then Toward the run (Keep first: any Solve or Verbs commit deletes un-kept {TK.Marker} elements).");
    }

    public static string Verdict(SolveDto s, bool committed)
    {
        if (s.Collisions == 0 && s.SelfHits == 0)
            return committed
                ? "VERDICT: clear. Export evidence via ExportPlan()/ExportIso() and hand back."
                : "VERDICT: clear to commit — call Commit(). Review the draft first via ExportPlan().";
        return $"VERDICT: resolve {s.Collisions} HARD hit(s){(s.SelfHits > 0 ? $" + {s.SelfHits} self-overlap(s)" : "")} — use the fix: lines. Cheapest order: trunk.elevationFt, then avoid/keepOut, then endpoints (re-check with MapProbe()).";
    }
}
