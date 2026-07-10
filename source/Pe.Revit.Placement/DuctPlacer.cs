using Pe.Revit.DocumentData.AgentContext;

namespace Pe.Revit.Placement;

/// <summary>
/// Opinionated collision-aware duct-placement facade over the mep-place toolkit.
/// Declare an intent (JSON), Solve() to route + draft draggable placeholder ducts with a
/// route-grammar report, Commit() to convert them into real connected ducts + fittings.
/// The escape hatch is Verbs() for interactive nudging when intent JSON is the wrong tool.
///
/// All report-returning methods return the full text (nothing is written to a console).
/// State (last_solve.json) lives under <c>stateDir</c>; images go to caller-provided out dirs.
/// The constructor level is AUTHORITATIVE — a mismatching intent.level warns and is ignored.
/// </summary>
public sealed class DuctPlacer
{
    readonly Document _doc;
    readonly Level _level;
    readonly ElementId _planViewId;   // may be null if none resolvable
    readonly ElementId _isoViewId;    // may be null if none resolvable
    readonly string _stateDir;

    /// <param name="doc">Active Revit document.</param>
    /// <param name="level">Level name or ElementId string (authoritative).</param>
    /// <param name="planViewId">Floor plan view id; auto-resolved from the level when null.</param>
    /// <param name="isoViewId">3D/iso view id; auto-resolved when null.</param>
    /// <param name="stateDir">Where last_solve.json lives. Defaults to
    /// %LOCALAPPDATA%\Pe.Tools\placement\&lt;sanitized doc title&gt; (created on demand).</param>
    public DuctPlacer(Document doc, string level, long? planViewId = null, long? isoViewId = null, string stateDir = null)
    {
        _doc = doc ?? throw new ArgumentNullException(nameof(doc));
        if (string.IsNullOrWhiteSpace(level)) throw new ArgumentException("level is required (name or ElementId string).", nameof(level));
        _level = TK.ResolveLevel(doc, level);

        _planViewId = planViewId.HasValue ? new ElementId(planViewId.Value) : ResolvePlanView(doc, _level);
        _isoViewId = isoViewId.HasValue ? new ElementId(isoViewId.Value) : ResolveIsoView(doc);

        if (string.IsNullOrWhiteSpace(stateDir))
        {
            var local = Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData);
            var title = Sanitize(doc.Title);
            stateDir = Path.Combine(local, "Pe.Tools", "placement", string.IsNullOrEmpty(title) ? "untitled" : title);
        }
        _stateDir = stateDir;
        Directory.CreateDirectory(_stateDir);
    }

    // ---------- Scout: read-only recon (terminals + connectors, equipment, existing duct band) ----------
    public string Scout()
    {
        var sb = new StringBuilder();
        void W(string s) => sb.AppendLine(s);

        var lvl = _level;
        // ProjectElevation is the internal-origin frame that element geometry lives in.
        // Level.Elevation is offset by the Project Base Point (0 on Snowdon, 348ft on Chadds),
        // so banding off it silently finds zero geometry on any project with a survey offset.
        double z0 = lvl.ProjectElevation, z1 = lvl.ProjectElevation + 13.0;
        W($"{lvl.Name} elev={z0:F2} band=[{z0:F2},{z1:F2})");

        // --- Air terminals in the band, with their HVAC connector ---
        var terms = new FilteredElementCollector(_doc)
            .OfCategory(BuiltInCategory.OST_DuctTerminal).WhereElementIsNotElementType()
            .Cast<FamilyInstance>()
            .Select(fi => (fi, bb: fi.get_BoundingBox(null)))
            .Where(x => x.bb != null && x.bb.Min.Z >= z0 - 0.5 && x.bb.Min.Z < z1)
            .ToList();
        int free = 0;
        W($"TERMINALS {terms.Count}");
        // Full lines only where they carry decisions: unconnected terminals are the routable ones.
        // Connected terminals collapse into per-family groups past 30 — ids stay (the solver looks up
        // connectors by id), geometry noise goes.
        var withConn = terms.Select(x => (x.fi, c: Draft.TerminalConnector(x.fi))).ToList();
        string Line(FamilyInstance fi, Connector c)
        {
            if (c == null) return $"T {fi.Id.Value} {fi.Symbol.FamilyName}:{fi.Name} [none]";
            string size = c.Shape == ConnectorProfileType.Round
                ? $"D{c.Radius * 24:F0}in"
                : $"{c.Width * 12:F0}x{c.Height * 12:F0}in";
            return $"T {fi.Id.Value} {fi.Symbol.FamilyName}:{fi.Name} [{c.DuctSystemType}|{c.Shape}|{size}|o=({c.Origin.X:F1},{c.Origin.Y:F1},{c.Origin.Z:F2})|dZ={c.CoordinateSystem.BasisZ.Z:F1}|conn={c.IsConnected}]";
        }
        foreach (var (fi, c) in withConn.Where(x => x.c == null || !x.c.IsConnected))
        {
            if (c != null) free++;
            W(Line(fi, c));
        }
        var connected = withConn.Where(x => x.c != null && x.c.IsConnected).ToList();
        if (connected.Count <= 30)
            foreach (var (fi, c) in connected) W(Line(fi, c));
        else
            foreach (var g in connected.GroupBy(x => $"{x.fi.Symbol.FamilyName}:{x.fi.Name}"))
            {
                var ids = g.Select(x => x.fi.Id.Value).ToList();
                W($"Tgrp {g.Key} conn=True n={ids.Count} ids={string.Join(",", ids.Take(40))}{(ids.Count > 40 ? ",..." : "")}");
            }
        W($"TERMINALS unconnected: {free} (occupied terminals get near-connect stubs, by design)");

        // --- Mechanical equipment in band ---
        var eq = new FilteredElementCollector(_doc)
            .OfCategory(BuiltInCategory.OST_MechanicalEquipment).WhereElementIsNotElementType()
            .Cast<FamilyInstance>()
            .Select(fi => (fi, bb: fi.get_BoundingBox(null)))
            .Where(x => x.bb != null && x.bb.Min.Z >= z0 - 2 && x.bb.Min.Z < z1)
            .ToList();
        W($"EQUIPMENT {eq.Count}");
        foreach (var (fi, bb) in eq)
        {
            // free duct connectors matter for routing TO equipment: their z is where the run must end,
            // not the bbox and not the trunk band.
            var freeConns = (fi.MEPModel?.ConnectorManager?.Connectors.Cast<Connector>() ?? Enumerable.Empty<Connector>())
                .Where(c => (c.ConnectorType == ConnectorType.End || c.ConnectorType == ConnectorType.Curve)
                            && c.Domain == Domain.DomainHvac && !c.IsConnected)
                .Select(c => $"({c.Origin.X:F1},{c.Origin.Y:F1},z={c.Origin.Z:F2})").ToList();
            W($"E {fi.Id.Value} {fi.Symbol.FamilyName}:{fi.Name} bb=({bb.Min.X:F1},{bb.Min.Y:F1},{bb.Min.Z:F1})..({bb.Max.X:F1},{bb.Max.Y:F1},{bb.Max.Z:F1})"
              + (freeConns.Count > 0 ? $" freeDuctConn: {string.Join(" ", freeConns)}" : ""));
        }

        // --- Existing ducts in band: count, XY extent, centerline z stats ---
        var ducts = new FilteredElementCollector(_doc)
            .OfCategory(BuiltInCategory.OST_DuctCurves).WhereElementIsNotElementType()
            .Select(d => (d, bb: d.get_BoundingBox(null)))
            .Where(x => x.bb != null && x.bb.Max.Z > z0 && x.bb.Min.Z < z1)
            .ToList();
        double minX = 1e9, minY = 1e9, maxX = -1e9, maxY = -1e9;
        var zs = new List<double>();
        foreach (var (d, bb) in ducts)
        {
            minX = Math.Min(minX, bb.Min.X); minY = Math.Min(minY, bb.Min.Y);
            maxX = Math.Max(maxX, bb.Max.X); maxY = Math.Max(maxY, bb.Max.Y);
            if (d is MEPCurve mc && mc.Location is LocationCurve lc && lc.Curve is Line ln && Math.Abs(ln.Direction.Z) < 0.1)
                zs.Add(ln.GetEndPoint(0).Z);
        }
        zs.Sort();
        W($"DUCTS in band: {ducts.Count} extentXY=({minX:F0},{minY:F0})..({maxX:F0},{maxY:F0})");
        if (zs.Count > 0)
            W($"DUCT centerline z: min={zs[0]:F2} med={zs[zs.Count / 2]:F2} max={zs[^1]:F2} (rel level: {zs[zs.Count / 2] - z0:F2})");

        // --- Terminal XY extent (region hint) ---
        if (terms.Count > 0)
        {
            double tMinX = terms.Min(t => t.bb.Min.X), tMinY = terms.Min(t => t.bb.Min.Y);
            double tMaxX = terms.Max(t => t.bb.Max.X), tMaxY = terms.Max(t => t.bb.Max.Y);
            W($"TERMINAL extentXY=({tMinX:F0},{tMinY:F0})..({tMaxX:F0},{tMaxY:F0})");
        }

        if (_planViewId != null)
        {
            var png = RevitViewImageExporter.ExportPng(_doc, _planViewId, Path.Combine(_stateDir, "img"), $"scout_{Sanitize(_level.Name)}");
            W($"PNG {png}");
        }
        else W("PNG skipped: no floor plan view resolved for this level (pass planViewId to enable).");
        W("NEXT: write your intent JSON, then call MapProbe() BEFORE trusting any endpoint.");
        return sb.ToString();
    }

    // ---------- MapProbe: ASCII occupancy map of the trunk band ----------
    public string MapProbe(string intentJson)
    {
        var sb = new StringBuilder();
        void W(string s) => sb.AppendLine(s);

        var it = TK.ParseIntent(_doc, intentJson, _level);
        foreach (var w in it.Warnings) W("WARN " + w);
        double lvlZ = it.Level.ProjectElevation;
        double zT = lvlZ + it.TrunkElevFt;
        double z0 = zT - it.TrunkHFt / 2, z1 = zT + it.TrunkHFt / 2;

        var termPts = new List<double[]>();
        foreach (var tid in it.Terminals)
        {
            var fi = _doc.GetElement(new ElementId(tid)) as FamilyInstance;
            var c = fi == null ? null : Draft.TerminalConnector(fi);
            if (c != null) termPts.Add(new[] { c.Origin.X, c.Origin.Y });
        }

        var xs = new List<double> { it.FromX, it.ToX };
        var ys = new List<double> { it.FromY, it.ToY };
        foreach (var t in termPts) { xs.Add(t[0]); ys.Add(t[1]); }
        double x0 = Math.Floor(xs.Min() - 12), x1 = Math.Ceiling(xs.Max() + 12);
        double y0 = Math.Floor(ys.Min() - 12), y1 = Math.Ceiling(ys.Max() + 12);
        double cell = (x1 - x0) > 140 ? 2.0 : 1.0;
        int nx = (int)((x1 - x0) / cell) + 1, ny = (int)((y1 - y0) / cell) + 1;

        var ix = ObstacleIndex.Build(_doc, x0, y0, x1, y1, z0 - 1, z1 + 1);
        Func<string, bool> hard = g => g == "walls" || g == "structure";
        Func<string, bool> all = g => g == "walls" || g == "structure" || g == "mep" || g == "equipment";
        var occH = ix.Occupancy(x0, y0, nx, ny, cell, it.TrunkWFt / 2, z0, z1, it.ClearanceFt, hard);
        var occA = ix.Occupancy(x0, y0, nx, ny, cell, it.TrunkWFt / 2, z0, z1, it.ClearanceFt, all);

        W($"MAP z=[{z0:F2},{z1:F2}] region x[{x0},{x1}] y[{y0},{y1}] cell={cell}ft  '#'=walls/struct 'm'=mep/equip ','=soft '.'=free  A=from B=to T=terminal");
        for (int j = ny - 1; j >= 0; j--)
        {
            var row = new char[nx];
            for (int i = 0; i < nx; i++)
            {
                double px = x0 + i * cell, py = y0 + j * cell;
                char ch = occH[i, j] == 2 ? '#' : occA[i, j] == 2 ? 'm' : occH[i, j] == 1 ? ',' : '.';
                if (Math.Abs(px - it.FromX) < cell / 2 && Math.Abs(py - it.FromY) < cell / 2) ch = 'A';
                else if (Math.Abs(px - it.ToX) < cell / 2 && Math.Abs(py - it.ToY) < cell / 2) ch = 'B';
                else if (termPts.Any(t => Math.Abs(px - t[0]) < cell / 2 && Math.Abs(py - t[1]) < cell / 2)) ch = 'T';
                row[i] = ch;
            }
            W($"y{y0 + j * cell,5:F0} {new string(row)}");
        }
        W($"      x from {x0} to {x1} (each char = {cell} ft). A and B must sit in '.' lanes that connect; T must be reachable from the lane.");
        return sb.ToString();
    }

    // ---------- Solve: parse intent STRING -> route -> draft placeholders -> report + diff ----------
    public string Solve(string intentJson)
    {
        var sw = System.Diagnostics.Stopwatch.StartNew();
        var sb = new StringBuilder();
        var R = new List<string>();
        Action<string> Say = s => { sb.AppendLine(s); R.Add(s); };

        var it = TK.ParseIntent(_doc, intentJson, _level);
        foreach (var w in it.Warnings) Say("WARN " + w);

        var prev = TK.ReadLastSolve(_stateDir);
        int deleted = TK.DeleteMarked(_doc);
        Say($"CLEAR: {deleted} prior {TK.Marker} elements removed (each solve re-materializes from scratch)");

        var dto = Engine.Solve(_doc, it, Say);          // throws with named-blocker refusal on trunk fail
        foreach (var line in Draft.Materialize(_doc, dto)) Say(line);
        Report.Scan(_doc, dto, Say);                    // always checks ALL groups + links; avoid only steered the router
        Report.EndpointGaps(_doc, dto, Say);            // declared-element endpoints must be physically reached
        foreach (var line in TK.Diff(prev, dto)) Say(line);
        Say(Report.Verdict(dto, false));

        dto.Report = R;
        TK.WriteLastSolve(_stateDir, dto);
        Say($"SOLVED in {sw.ElapsedMilliseconds} ms. Draft = placeholder ducts (draggable). Next: ExportPlan() to see it, refine the intent + re-solve, or Commit().");
        return sb.ToString();
    }

    // ---------- Commit: convert the marked placeholder draft -> real connected ducts + fittings ----------
    public string Commit()
    {
        var sb = new StringBuilder();
        void W(string s) => sb.AppendLine(s);

        var s = TK.ReadLastSolve(_stateDir);
        if (s == null) throw new InvalidOperationException("no last_solve.json in the state dir — call Solve() (or a verbs session) first: declare -> solve -> draft -> commit");
        // The state dir outlives sessions: without a live draft in the model, this DTO is a relic
        // of an earlier session and committing it re-materializes stale geometry.
        if (TK.MarkerElements(_doc).Count == 0)
            throw new InvalidOperationException($"stale state: solve '{s.IntentName}' ({s.SolvedAt}) has no {TK.Marker} draft in the model — that solve belongs to an earlier session. Re-run Solve() with your intent first.");
        W($"COMMIT '{s.IntentName}' (solved {s.SolvedAt}, source={s.Source}): {s.Paths.Count} paths");

        foreach (var line in Draft.CommitConvert(_doc, s)) W(line);

        W("");
        W("POST-COMMIT CHECK (real geometry vs full index; marked elements excluded from the index):");
        Report.Scan(_doc, s, W);
        Report.EndpointGaps(_doc, s, W);
        W(Report.Verdict(s, true));
        TK.WriteLastSolve(_stateDir, s);   // keep collision fields current for the next DIFF

        var mine = TK.MarkerElements(_doc);
        var byCat = mine.GroupBy(e => e.Category?.Name ?? "?").Select(g => $"{g.Key} {g.Count()}");
        W($"PLACED: {mine.Count} elements [{string.Join(", ", byCat)}]");
        W($"IDS: {string.Join(",", mine.Take(40).Select(e => e.Id.Value))}{(mine.Count > 40 ? ",..." : "")}");
        W("COMMITTED. Export evidence via ExportPlan()/ExportIso(). To refine: edit the intent, re-run Solve() (replaces this), re-commit. Done with this increment? Call Keep() BEFORE the next Solve — Solve deletes anything still tagged " + TK.Marker + ".");
        return sb.ToString();
    }

    // ---------- Keep: graduate the committed increment out of the live marker ----------
    // After a Commit you intend to keep, call this before the next Solve: the next Solve's
    // clear step deletes everything still tagged PEA-TK-PLACE, including committed real ducts.
    public string Keep()
    {
        int n = TK.KeepMarked(_doc);
        return n == 0
            ? "KEEP: nothing tagged PEA-TK-PLACE (commit first, then keep)"
            : $"KEEP: {n} elements retagged {TK.DoneMarker} — safe from future Solve()/Cleanup(); the next solve treats them as existing ducts.";
    }

    // ---------- Cleanup: delete all PEA-TK-PLACE elements + empty systems; return count ----------
    public int Cleanup()
    {
        var els = TK.MarkerElements(_doc);
        // remember systems our curves belong to, then delete
        var sysIds = els.OfType<MEPCurve>()
            .Select(m => { try { return m.MEPSystem?.Id; } catch { return null; } })
            .Where(id => id != null).Distinct().ToList();
        int count = els.Count;
        if (els.Count > 0) _doc.Delete(els.Select(e => e.Id).ToList());
        _doc.Regenerate();

        foreach (var sid in sysIds)
        {
            try
            {
                if (_doc.GetElement(sid) is MechanicalSystem ms && (ms.Elements == null || ms.Elements.IsEmpty))
                    _doc.Delete(sid);
            }
            catch { /* leave it */ }
        }
        _doc.Regenerate();

        int remaining = TK.MarkerElements(_doc).Count;
        if (remaining > 0)
            throw new InvalidOperationException($"Cleanup left {remaining} marked elements — investigate before continuing.");
        return count;
    }

    // ---------- solve + commit in one call (the thin-first-commit fast path) ----------
    // Solves the intent; when the draft is fully clean (no hard collisions, no self hits) it
    // commits and keeps the increment in the same call and appends the plan-export path.
    // Dirty or refused solves leave the draft for iteration exactly like Solve().
    public string SolveAndCommitIfClean(string intentJson)
    {
        var sb = new StringBuilder();
        sb.Append(Solve(intentJson));   // throws with the named-blocker refusal on trunk fail
        var dto = TK.ReadLastSolve(_stateDir);
        if (dto == null || dto.Collisions != 0 || dto.SelfHits != 0)
        {
            sb.AppendLine($"NOT COMMITTED: draft has HARD {dto?.Collisions ?? -1} / self-overlaps {dto?.SelfHits ?? -1}. Fix the named blocker in the intent and re-run.");
            return sb.ToString();
        }
        sb.Append(Commit());
        sb.AppendLine(Keep());
        try { sb.AppendLine("PLAN " + ExportPlan()); } catch (Exception ex) { sb.AppendLine("PLAN export skipped: " + ex.Message); }
        return sb.ToString();
    }

    // ---------- evidence exports ----------
    public string ExportPlan(string outDir = null, string baseName = "placement")
    {
        if (_planViewId == null)
            throw new InvalidOperationException("no floor plan view resolved for this level — pass planViewId to the constructor.");
        return RevitViewImageExporter.ExportPng(_doc, _planViewId, outDir ?? Path.Combine(_stateDir, "img"), baseName, 3500);
    }

    public string ExportIso(string outDir = null, string baseName = "placement")
    {
        if (_isoViewId == null)
            throw new InvalidOperationException("no 3D/iso view resolved — pass isoViewId to the constructor.");
        return RevitViewImageExporter.ExportPng(_doc, _isoViewId, outDir ?? Path.Combine(_stateDir, "img"), baseName, 3000);
    }

    // ---------- fluent escape hatch ----------
    /// <summary>Open a fluent verbs session (StartAt/Toward/RiseTo/BranchTo/Preview/Commit).
    /// Same marker/report/commit pipeline as Solve(); DuctPlacer.Commit() converts its draft identically.</summary>
    public VerbRoute Verbs(string name = "verbs", string system = "Supply Air",
        string trunkType = "Rectangular Duct: Mitered Elbows / Taps", string branchType = "Round Duct: Taps",
        string size = "12x8", double elevationFt = 9.0, double clearanceIn = 2.0)
    {
        var sys = TK.ResolveSystem(_doc, system);
        var tt = TK.ResolveDuctType(_doc, trunkType);
        var bt = TK.ResolveDuctType(_doc, branchType);
        return new VerbRoute(_doc, _stateDir, _level, sys, tt, bt, name, size, elevationFt, clearanceIn);
    }

    // ---------- helpers ----------
    static ElementId ResolvePlanView(Document doc, Level level)
    {
        var v = new FilteredElementCollector(doc).OfClass(typeof(ViewPlan)).Cast<ViewPlan>()
            .Where(p => !p.IsTemplate && p.ViewType == ViewType.FloorPlan)
            .FirstOrDefault(p => p.GenLevel != null && p.GenLevel.Id.Value == level.Id.Value);
        return v?.Id;
    }

    static ElementId ResolveIsoView(Document doc)
    {
        var v = new FilteredElementCollector(doc).OfClass(typeof(View3D)).Cast<View3D>()
            .FirstOrDefault(x => !x.IsTemplate);
        return v?.Id;
    }

    static string Sanitize(string s)
    {
        if (string.IsNullOrEmpty(s)) return "";
        foreach (var ch in Path.GetInvalidFileNameChars()) s = s.Replace(ch, '_');
        return s.Trim();
    }
}
