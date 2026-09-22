namespace Pe.Revit.Placement;

// VerbRoute — the fluent escape hatch (from mep-route's VSession, cut to 6 verbs). Same probe voice
// (Report.Scan), same draft medium (placeholders via Draft.Materialize), same marker, same
// last_solve.json — so Commit() converts a verbs draft exactly like an intent draft. No A* here:
// you place legs, the report tells you what they hit.
//
// Config injected by DuctPlacer: the resolved level/system/duct-types and the state dir replace the
// pod's hardcoded "L4"/"Supply Air" defaults and workspace-relative last_solve.json path.
public sealed class VerbRoute
{
    readonly Document Doc;
    readonly StringBuilder Buf = new StringBuilder();
    readonly SolveDto Dto;
    readonly DuctType BranchType;
    readonly double LvlZ;
    readonly string StateDir;
    double X, Y, Z;          // cursor
    bool HasCursor;
    PathDto Trunk;           // Points3 polyline

    void W(string s) => Buf.AppendLine(s);

    internal VerbRoute(Document doc, string stateDir, Level level, MechanicalSystemType system,
        DuctType trunkType, DuctType branchType, string name, string size, double elevationFt, double clearanceIn)
    {
        Doc = doc; StateDir = stateDir; BranchType = branchType; LvlZ = level.ProjectElevation;
        var parts = size.ToLowerInvariant().Replace("\"", "").Split('x');
        if (parts.Length != 2 || !double.TryParse(parts[0], out var wIn) || !double.TryParse(parts[1], out var hIn))
            throw new InvalidOperationException($"trunk size '{size}' unreadable. Use inches as \"WxH\", e.g. \"12x8\".");
        Dto = new SolveDto
        {
            SolvedAt = DateTime.Now.ToString("yyyy-MM-dd HH:mm:ss"),
            IntentName = name, Source = "verbs",
            LevelId = level.Id.Value(), LevelElev = level.ProjectElevation, SystemTypeId = system.Id.Value(),
            ClearanceIn = clearanceIn,
            Avoid = new List<string> { "mep", "walls", "structure", "equipment", "terminals" },
        };
        Z = level.ProjectElevation + elevationFt;
        Trunk = new PathDto
        {
            Key = "trunk", Kind = "trunk", DuctTypeId = trunkType.Id.Value(), Shape = "rect",
            WidthIn = wIn, HeightIn = hIn, ZFt = level.ProjectElevation + elevationFt,
            Points3 = new List<double[]>(),
        };
        W($"VERBS '{name}' level={level.Name} sys={system.Name} trunk {wIn:F0}x{hIn:F0}in z={Z:F2} ({elevationFt:F2} above level)");
    }

    /// Verb 1 — put the cursor somewhere (model feet).
    public VerbRoute StartAt(double x, double y)
    {
        X = x; Y = y; HasCursor = true;
        Trunk.Points3.Add(new[] { X, Y, Z });
        W($"STAGE start at ({x:F1},{y:F1},{Z:F2})");
        return this;
    }

    /// Verb 2 — straight trunk leg to (x,y) at the current elevation.
    public VerbRoute Toward(double x, double y)
    {
        if (!HasCursor) { W("STAGE Toward skipped: call StartAt first"); return this; }
        if (Math.Abs(x - X) < 0.05 && Math.Abs(y - Y) < 0.05) { W("STAGE Toward skipped: degenerate leg"); return this; }
        X = x; Y = y;
        Trunk.Points3.Add(new[] { X, Y, Z });
        W($"STAGE T{Trunk.Points3.Count - 1} toward ({x:F1},{y:F1}) at z={Z:F2}");
        return this;
    }

    /// Verb 3 — vertical trunk move to a new centerline elevation (feet above level). Down is fine.
    public VerbRoute RiseTo(double elevationFt)
    {
        double nz = LvlZ + elevationFt;
        if (!HasCursor) { Z = nz; W($"STAGE elevation set to {nz:F2} (no cursor yet)"); return this; }
        if (Math.Abs(nz - Z) < 0.05) { W($"STAGE RiseTo skipped: already at z={Z:F2}"); return this; }
        W($"STAGE {(nz > Z ? "RISE" : "DROP")} {Math.Abs(nz - Z):F1} ft to z={nz:F2} at ({X:F1},{Y:F1})");
        Z = nz;
        Trunk.Points3.Add(new[] { X, Y, Z });
        return this;
    }

    /// Verb 4 — branch from the nearest horizontal trunk leg to an air terminal.
    /// Reads the connector (size/facing/IsConnected); occupied terminals get a stub-short end.
    public VerbRoute BranchTo(long terminalId, double stubFt = 1.5)
    {
        var fi = Doc.GetElement(terminalId.ToElementId()) as FamilyInstance;
        var tc = fi == null ? null : Draft.TerminalConnector(fi);
        if (tc == null) { W($"STAGE BRANCH {terminalId}: SKIPPED — no HVAC connector on that element"); return this; }
        XYZ o = tc.Origin, d = tc.CoordinateSystem.BasisZ;
        bool occupied = tc.IsConnected;
        double diaIn = tc.Shape == ConnectorProfileType.Round ? tc.Radius * 24.0
            : Math.Round(Math.Sqrt(tc.Width * 12.0 * tc.Height * 12.0)); // rect neck -> equivalent round dia
        W($"STAGE BRANCH -> terminal {terminalId} \"{fi.Name}\" conn {(tc.Shape == ConnectorProfileType.Round ? $"rnd{diaIn:F0}in" : $"{tc.Width * 12:F0}x{tc.Height * 12:F0}in")} facing ({d.X:F1},{d.Y:F1},{d.Z:F1}) at ({o.X:F1},{o.Y:F1},{o.Z:F2}){(occupied ? " [ALREADY CONNECTED]" : "")}");

        // nearest horizontal trunk segment
        int seg = -1; double best = double.MaxValue; double segZ = Z;
        for (int k = 1; k < Trunk.Points3.Count; k++)
        {
            var a = Trunk.Points3[k - 1]; var b = Trunk.Points3[k];
            if (Math.Abs(b[2] - a[2]) > 0.05) continue;
            double dist = Engine.DistToPolyline(new List<double[]> { new[] { a[0], a[1] }, new[] { b[0], b[1] } }, o.X, o.Y);
            if (dist < best) { best = dist; seg = k; segZ = a[2]; }
        }
        if (seg < 0) { W("  BRANCH SKIPPED: no horizontal trunk leg staged yet"); return this; }
        var pa = Trunk.Points3[seg - 1]; var pb = Trunk.Points3[seg];
        double vx = pb[0] - pa[0], vy = pb[1] - pa[1];
        double len = Math.Sqrt(vx * vx + vy * vy);
        double t = Math.Max(0, Math.Min(1, ((o.X - pa[0]) * vx + (o.Y - pa[1]) * vy) / (len * len)));
        double tFt = Math.Max(1.0, Math.Min(len - 1.0, t * len));
        double tkx = pa[0] + vx / len * tFt, tky = pa[1] + vy / len * tFt;

        bool vertical = Math.Abs(d.Z) > 0.7;
        double sb = occupied ? Draft.Setback : 0;
        var p = new PathDto
        {
            Key = terminalId.ToString(), Kind = "branch", DuctTypeId = BranchType.Id.Value(), Shape = "round",
            DiaIn = diaIn, ZFt = segZ, TerminalId = terminalId, Connect = !occupied,
            Conn = new[] { o.X, o.Y, o.Z },
            Points3 = new List<double[]> { new[] { tkx, tky, segZ } },
            Points = new List<double[]> { new[] { tkx, tky } },
        };
        if (vertical)
        {
            p.Points3.Add(new[] { o.X, o.Y, segZ });
            p.Points.Add(new[] { o.X, o.Y });
            if (Math.Abs(o.Z - segZ) > 0.05)
                p.Riser = new RiserDto { X = o.X, Y = o.Y, Z0 = segZ, Z1 = o.Z + Math.Sign(segZ - o.Z) * sb };
        }
        else
        {
            double ux = d.X, uy = d.Y;
            double ul = Math.Sqrt(ux * ux + uy * uy); ux /= ul; uy /= ul;
            // approach from the trunk side
            double d1 = Math.Pow(o.X + ux * stubFt - tkx, 2) + Math.Pow(o.Y + uy * stubFt - tky, 2);
            double d2 = Math.Pow(o.X - ux * stubFt - tkx, 2) + Math.Pow(o.Y - uy * stubFt - tky, 2);
            if (d2 < d1) { ux = -ux; uy = -uy; }
            double gx = o.X + ux * stubFt, gy = o.Y + uy * stubFt;
            p.Points3.Add(new[] { gx, gy, segZ });
            p.Points.Add(new[] { gx, gy });
            if (Math.Abs(o.Z - segZ) >= 0.2)
                p.Riser = new RiserDto { X = gx, Y = gy, Z0 = segZ, Z1 = o.Z };
            p.Stub = new StubDto
            {
                From = new[] { gx, gy, p.Riser != null ? o.Z : segZ },
                To = new[] { o.X + ux * sb, o.Y + uy * sb, o.Z },
            };
        }
        double plen = 0;
        for (int k = 1; k < p.Points3.Count; k++)
            plen += Math.Sqrt(Math.Pow(p.Points3[k][0] - p.Points3[k - 1][0], 2) + Math.Pow(p.Points3[k][1] - p.Points3[k - 1][1], 2) + Math.Pow(p.Points3[k][2] - p.Points3[k - 1][2], 2));
        if (p.Riser != null) plen += Math.Abs(p.Riser.Z1 - p.Riser.Z0);
        p.LengthFt = plen;
        p.TerminalStatus = occupied ? $"terminal already connected -> near-connect ({Draft.Setback * 12:F1} in short)" : "terminal free -> will connect at commit";
        Dto.Paths.Add(p);
        W($"  BRANCH staged off trunk@({tkx:F1},{tky:F1}): {p.Points3.Count - 1} leg(s){(p.Riser != null ? " + riser" : "")}{(p.Stub != null ? " + stub" : "")}; {p.TerminalStatus}");
        return this;
    }

    /// Verb 5 — probe everything staged against the full model + links. Mutates nothing. Returns the report.
    public string Preview()
    {
        Seal();
        W("");
        W($"PREVIEW '{Dto.IntentName}' — probing staged route (nothing placed)");
        Report.Scan(Doc, Dto, W);
        W(Report.Verdict(Dto, false));
        return Buf.ToString();
    }

    /// Verb 6 — replace the marked draft with this session's placeholders + persist last_solve.json.
    /// DuctPlacer.Commit() then converts to real ducts + fittings, same as an intent draft.
    public string Commit()
    {
        Seal();
        W("");
        W($"VERBS COMMIT '{Dto.IntentName}' — drafting placeholders");
        var prev = TK.ReadLastSolve(StateDir);
        int deleted = TK.DeleteMarked(Doc);
        W($"CLEAR: {deleted} prior {TK.Marker} elements removed");
        foreach (var line in Draft.Materialize(Doc, Dto)) W(line);
        Report.Scan(Doc, Dto, W);
        foreach (var line in TK.Diff(prev, Dto)) W(line);
        Dto.Report = new List<string> { $"verbs session '{Dto.IntentName}'" };
        TK.WriteLastSolve(StateDir, Dto);
        W(Report.Verdict(Dto, false));
        return Buf.ToString();
    }

    void Seal()
    {
        if (Trunk.Points3.Count >= 2 && !Dto.Paths.Contains(Trunk))
        {
            Trunk.Points = Trunk.Points3.Select(q => new[] { q[0], q[1] }).ToList();
            Trunk.ZFt = Trunk.Points3[0][2];
            double plen = 0; int bends = 0;
            for (int k = 1; k < Trunk.Points3.Count; k++)
            {
                var a = Trunk.Points3[k - 1]; var b = Trunk.Points3[k];
                plen += Math.Sqrt(Math.Pow(b[0] - a[0], 2) + Math.Pow(b[1] - a[1], 2) + Math.Pow(b[2] - a[2], 2));
                if (k >= 2) bends++;
            }
            Trunk.LengthFt = plen; Trunk.Bends = Math.Max(0, bends);
            Dto.Paths.Insert(0, Trunk);
        }
    }
}
