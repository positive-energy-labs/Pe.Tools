namespace Pe.Revit.Placement;

// Draft: placeholders are THE draft medium (mep-sketch's insight) — visible, user-draggable,
// disposable. Commit converts whatever marked placeholders are in the model via
// ConvertDuctPlaceholders (elbows/taps come from the conversion), then places takeoff fittings
// against the trunk and connects free terminals (IsConnected-gated; occupied ones were already
// drafted stub-short by the engine).
internal static class Draft
{
    public const double Setback = 0.15; // ft left short of an occupied terminal connector (1.8 in)

    // ---------- DRAFT: placeholder ducts per path piece, Marks "<key>#<n>" keep chains ordered ----------
    public static List<string> Materialize(Document doc, SolveDto s)
    {
        var log = new List<string>();
        int made = 0;
        foreach (var p in s.Paths)
        {
            int idx = 0;
            var typeId = p.DuctTypeId.ToElementId();
            var sysId = s.SystemTypeId.ToElementId();
            var lvlId = s.LevelId.ToElementId();
            void Place(XYZ a, XYZ b, string what)
            {
                if (a.DistanceTo(b) < 0.05) return;
                try
                {
                    var d = Duct.CreatePlaceholder(doc, sysId, typeId, lvlId, a, b);
                    SetSize(d, p); TK.Tag(d, $"{p.Key}#{idx++}"); made++;
                }
                catch (Exception ex) { log.Add($"  draft {what} failed ({p.Key}): {Short(ex)}"); }
            }
            if (p.Points3 != null && p.Points3.Count > 1)
                for (int k = 1; k < p.Points3.Count; k++)
                    Place(new XYZ(p.Points3[k - 1][0], p.Points3[k - 1][1], p.Points3[k - 1][2]),
                          new XYZ(p.Points3[k][0], p.Points3[k][1], p.Points3[k][2]), $"seg#{k}");
            else
                for (int k = 1; k < p.Points.Count; k++)
                    Place(new XYZ(p.Points[k - 1][0], p.Points[k - 1][1], p.ZFt),
                          new XYZ(p.Points[k][0], p.Points[k][1], p.ZFt), $"leg#{k}");
            if (p.Riser != null && Math.Abs(p.Riser.Z1 - p.Riser.Z0) > 0.05)
                Place(new XYZ(p.Riser.X, p.Riser.Y, p.Riser.Z0), new XYZ(p.Riser.X, p.Riser.Y, p.Riser.Z1), "riser");
            if (p.Stub != null)
                Place(new XYZ(p.Stub.From[0], p.Stub.From[1], p.Stub.From[2]),
                      new XYZ(p.Stub.To[0], p.Stub.To[1], p.Stub.To[2]), "stub");
        }
        doc.Regenerate();
        log.Insert(0, $"DRAFT: {made} placeholder ducts placed (marker {TK.Marker}). They are draggable — commit converts what is in the model.");
        return log;
    }

    // ---------- COMMIT: current marked placeholders -> connected real ducts + fittings ----------
    public static List<string> CommitConvert(Document doc, SolveDto s)
    {
        var log = new List<string>();

        // replace-on-commit: drop previously committed REAL marked elements, keep the placeholders
        var stale = TK.MarkerElements(doc)
            .Where(e => e.Category != null && (BuiltInCategory)e.Category.Id.Value() != BuiltInCategory.OST_PlaceHolderDucts)
            .ToList();
        if (stale.Count > 0)
        {
            doc.Delete(stale.Select(e => e.Id).ToList());
            doc.Regenerate();
            log.Add($"CLEAR: {stale.Count} previously committed elements removed (placeholders kept)");
        }

        // chains from the CURRENT model state (hand-dragged placeholders are honored)
        var phs = TK.MarkerPlaceholders(doc);
        if (phs.Count == 0)
            throw new InvalidOperationException("no marked placeholder draft in the model — call Solve() (or run a verbs session) first");
        var chains = new Dictionary<string, List<(int idx, Duct ph, XYZ a, XYZ b)>>();
        foreach (var ph in phs)
        {
            if (ph.Location is not LocationCurve lc || lc.Curve is not Line ln) continue;
            var mark = ph.get_Parameter(BuiltInParameter.ALL_MODEL_MARK)?.AsString() ?? "";
            var hash = mark.IndexOf('#');
            string key = hash > 0 ? mark[..hash] : mark;
            int idx = hash > 0 && int.TryParse(mark[(hash + 1)..], out var i) ? i : 0;
            if (!chains.TryGetValue(key, out var list)) chains[key] = list = new List<(int, Duct, XYZ, XYZ)>();
            list.Add((idx, ph, ln.GetEndPoint(0), ln.GetEndPoint(1)));
        }
        foreach (var k in chains.Keys.ToList()) chains[k] = chains[k].OrderBy(x => x.idx).ToList();
        log.Add($"COMMIT: {phs.Count} placeholders in {chains.Count} chains [{string.Join(", ", chains.Keys)}]");

        // elbow-connect consecutive pieces (ConvertDuctPlaceholders then emits the elbow fittings)
        int elbowOk = 0, elbowTry = 0;
        foreach (var pair in chains)
        {
            var key = pair.Key;
            var chain = pair.Value;
            for (int i = 0; i + 1 < chain.Count; i++)
            {
                double gap = chain[i].b.DistanceTo(chain[i + 1].a);
                if (gap > 0.05)
                {
                    if (gap < 5.0) log.Add($"  corner gap {key}#{i}->{i + 1}: {gap:F2} ft — left unconnected (dragged apart? re-solve or drag back)");
                    continue;
                }
                elbowTry++;
                try { if (MechanicalUtils.ConnectDuctPlaceholdersAtElbow(doc, chain[i].ph.Id, chain[i + 1].ph.Id)) elbowOk++; }
                catch (Exception ex) { log.Add($"  elbow-connect {key}#{i}->{i + 1} failed: {Short(ex)}"); }
            }
        }
        doc.Regenerate();
        log.Add($"JOINTS: {elbowOk}/{elbowTry} placeholder elbows connected");

        // convert to real ducts + fittings
        var phIds = TK.MarkerPlaceholders(doc).Select(d => d.Id).ToList();
        ICollection<ElementId> outIds;
        try { outIds = MechanicalUtils.ConvertDuctPlaceholders(doc, phIds); }
        catch (Exception ex) { throw new InvalidOperationException($"ConvertDuctPlaceholders failed ({phIds.Count} placeholders): {ex.Message}"); }
        doc.Regenerate();
        int ducts = 0, fits = 0;
        foreach (var id in outIds)
        {
            var e = doc.GetElement(id);
            if (e == null) continue;
            TK.Tag(e);   // conversion re-ids everything; re-stamp (mep-sketch finding)
            if (e is Duct) ducts++; else fits++;
        }
        doc.Regenerate();
        log.Add($"CONVERT: in={phIds.Count} out={outIds.Count} (ducts={ducts} fittings={fits})");

        // takeoffs: when the branch chain start sits exactly ON a trunk leg centerline,
        // ConvertDuctPlaceholders emits the tap fitting itself (proven live) — detect that first;
        // NewTakeoffFitting is the fallback for gapped/hand-dragged junction geometry.
        var fittings = TK.MarkerElements(doc)
            .Where(e => e.Category != null && (BuiltInCategory)e.Category.Id.Value() == BuiltInCategory.OST_DuctFitting)
            .Select(e => (e, bb: e.get_BoundingBox(null)))
            .Where(x => x.bb != null)
            .Select(x => (x.e, c: (x.bb.Min + x.bb.Max) / 2))
            .ToList();
        var reals = TK.MarkerRealDucts(doc)
            .Select(d => (d, ln: (d.Location as LocationCurve)?.Curve as Line))
            .Where(x => x.ln != null)
            .Select(x => (x.d, a: x.ln.GetEndPoint(0), b: x.ln.GetEndPoint(1)))
            .ToList();
        int takeoffs = 0, converted = 0, branchCount = 0;
        foreach (var p in s.Paths.Where(p => p.Kind == "branch" && p.Points.Count > 0))
        {
            branchCount++;
            var start = new XYZ(p.Points[0][0], p.Points[0][1], p.ZFt);
            var tap = fittings.FirstOrDefault(f => f.c.DistanceTo(start) < 0.8);
            if (tap.e != null) { converted++; log.Add($"  takeoff {p.Key}: tap emitted by conversion (fitting {tap.e.Id.Value()})"); continue; }
            var host = reals.FirstOrDefault(r => DistToSeg(start, r.a, r.b) < 0.1
                && Math.Abs(r.a.Z - r.b.Z) < 0.05
                && !(r.a.DistanceTo(start) < 0.15 || r.b.DistanceTo(start) < 0.15));
            var mine = reals.FirstOrDefault(r => (r.a.DistanceTo(start) < 0.5 || r.b.DistanceTo(start) < 0.5) && r.d != host.d);
            if (host.d == null) { log.Add($"  takeoff skipped ({p.Key}): no trunk duct under ({start.X:F1},{start.Y:F1})"); continue; }
            if (mine.d == null) { log.Add($"  takeoff skipped ({p.Key}): no branch duct starting at ({start.X:F1},{start.Y:F1})"); continue; }
            var bc = NearestConnector(mine.d, start);
            if (bc == null) { log.Add($"  takeoff skipped ({p.Key}): branch connector not found"); continue; }
            try { var fi = doc.Create.NewTakeoffFitting(bc, host.d); TK.Tag(fi); takeoffs++; }
            catch (Exception ex) { log.Add($"  takeoff FAILED ({p.Key}): {Short(ex)}"); }
        }
        doc.Regenerate();
        log.Add($"TAKEOFFS: {converted + takeoffs}/{branchCount} ({converted} taps from conversion, {takeoffs} takeoff fittings)");

        // terminal connections (only when the terminal connector is free)
        foreach (var p in s.Paths.Where(p => p.Kind == "branch" && p.TerminalId != 0))
        {
            var term = doc.GetElement(p.TerminalId.ToElementId()) as FamilyInstance;
            var tc = TerminalConnector(term);
            if (tc == null) { log.Add($"  connect {p.Key}: terminal connector not found"); continue; }
            if (tc.IsConnected) { log.Add($"  connect {p.Key}: terminal already connected -> near-connect (duct ends {Setback * 12:F1} in short)"); continue; }
            if (!p.Connect) { log.Add($"  connect {p.Key}: connect=false (drop ends near terminal)"); continue; }
            reals = TK.MarkerRealDucts(doc)
                .Select(d => (d, ln: (d.Location as LocationCurve)?.Curve as Line))
                .Where(x => x.ln != null)
                .Select(x => (x.d, a: x.ln.GetEndPoint(0), b: x.ln.GetEndPoint(1)))
                .ToList();
            var end = reals
                .Select(r => (r.d, c: NearestConnector(r.d, tc.Origin)))
                .Where(x => x.c != null && !x.c.IsConnected)
                .OrderBy(x => x.c.Origin.DistanceTo(tc.Origin))
                .FirstOrDefault();
            if (end.c == null || end.c.Origin.DistanceTo(tc.Origin) > 0.5)
            { log.Add($"  connect {p.Key}: no free duct end near terminal connector"); continue; }
            try { end.c.ConnectTo(tc); log.Add($"  connect {p.Key}: CONNECTED"); }
            catch (Exception ex) { log.Add($"  connect {p.Key}: failed ({Short(ex)})"); }
        }
        doc.Regenerate();
        return log;
    }

    static void SetSize(Duct d, PathDto p)
    {
        if (p.Shape == "rect")
        {
            var w = d.get_Parameter(BuiltInParameter.RBS_CURVE_WIDTH_PARAM);
            var h = d.get_Parameter(BuiltInParameter.RBS_CURVE_HEIGHT_PARAM);
            if (w != null && !w.IsReadOnly) w.Set(p.WidthIn / 12.0);
            if (h != null && !h.IsReadOnly) h.Set(p.HeightIn / 12.0);
        }
        else
        {
            var dia = d.get_Parameter(BuiltInParameter.RBS_CURVE_DIAMETER_PARAM);
            if (dia != null && !dia.IsReadOnly) dia.Set(p.DiaIn / 12.0);
        }
    }

    public static Connector NearestConnector(MEPCurve mc, XYZ pt)
    {
        Connector best = null; double bd = double.MaxValue;
        foreach (Connector c in mc.ConnectorManager.Connectors)
        {
            var d = c.Origin.DistanceTo(pt);
            if (d < bd) { bd = d; best = c; }
        }
        return bd < 0.5 ? best : null;
    }

    public static Connector TerminalConnector(FamilyInstance fi)
    {
        var cm = fi?.MEPModel?.ConnectorManager;
        if (cm == null) return null;
        // Multi-connector equipment (fans: intake + discharge + non-duct stubs) — prefer the FREE
        // HVAC end connector; "first HVAC" used to grab an already-connected intake side.
        Connector free = null, any = null;
        foreach (Connector c in cm.Connectors)
        {
            if (c.Domain != Domain.DomainHvac) continue;
            if (c.ConnectorType != ConnectorType.End && c.ConnectorType != ConnectorType.Curve) continue;
            if (any == null) any = c;
            bool connected; try { connected = c.IsConnected; } catch { connected = true; }
            if (!connected && free == null) free = c;
        }
        return free ?? any;
    }

    static double DistToSeg(XYZ p, XYZ a, XYZ b)
    {
        var ab = b - a; var len = ab.GetLength();
        if (len < 1e-9) return p.DistanceTo(a);
        var t = Math.Max(0, Math.Min(1, (p - a).DotProduct(ab) / (len * len)));
        return p.DistanceTo(a + ab.Multiply(t));
    }

    static string Short(Exception ex) => ex.Message.Length > 140 ? ex.Message.Substring(0, 140) : ex.Message;
}
