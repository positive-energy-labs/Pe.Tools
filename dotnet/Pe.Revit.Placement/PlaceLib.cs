using Newtonsoft.Json;
using Newtonsoft.Json.Linq;
using Newtonsoft.Json.Serialization;

namespace Pe.Revit.Placement;

// TK = toolkit core: marker, intent parsing, solve DTOs, resolution helpers, diff.
// Combined toolkit (mep-place): intent front door from mep-solve, placeholder draft medium from
// mep-sketch, route-grammar feedback from mep-route. Everything is model feet unless a name says In.
// Config de-hardcoded from the pod: state dir + views/level are injected by DuctPlacer, not consts.
internal static class TK
{
    public const string Marker = "PEA-TK-PLACE";
    // Kept increments: retagged on Keep() so the next Solve's DeleteMarked leaves them, and the
    // obstacle index treats them as ordinary existing ducts (it only excludes the live Marker).
    public const string DoneMarker = "PEA-TK-DONE";

    public static readonly JsonSerializerSettings Json = new JsonSerializerSettings
    {
        Formatting = Formatting.Indented,
        ContractResolver = new CamelCasePropertyNamesContractResolver(),
    };

    // ---------- marker element handling (parameter filter: any category) ----------
    static ElementParameterFilter MineFilter()
        => new ElementParameterFilter(ParameterFilterRuleFactory.CreateEqualsRule(
            new ElementId(BuiltInParameter.ALL_MODEL_INSTANCE_COMMENTS), Marker));

    public static List<Element> MarkerElements(Document doc)
        => new FilteredElementCollector(doc).WhereElementIsNotElementType().WherePasses(MineFilter()).ToList();

    public static List<Duct> MarkerPlaceholders(Document doc)
        => new FilteredElementCollector(doc).OfCategory(BuiltInCategory.OST_PlaceHolderDucts)
            .WhereElementIsNotElementType().WherePasses(MineFilter()).OfType<Duct>().ToList();

    public static List<Duct> MarkerRealDucts(Document doc)
        => new FilteredElementCollector(doc).OfCategory(BuiltInCategory.OST_DuctCurves)
            .WhereElementIsNotElementType().WherePasses(MineFilter()).OfType<Duct>().ToList();

    public static int DeleteMarked(Document doc)
    {
        var els = MarkerElements(doc);
        if (els.Count == 0) return 0;
        doc.Delete(els.Select(e => e.Id).ToList());
        return els.Count;
    }

    public static void Tag(Element e, string mark = null)
    {
        var p = e.get_Parameter(BuiltInParameter.ALL_MODEL_INSTANCE_COMMENTS);
        if (p != null && !p.IsReadOnly) p.Set(Marker);
        if (mark != null)
        {
            var m = e.get_Parameter(BuiltInParameter.ALL_MODEL_MARK);
            if (m != null && !m.IsReadOnly) m.Set(mark);
        }
    }

    public static bool IsMine(Element e)
    {
        var p = e.get_Parameter(BuiltInParameter.ALL_MODEL_INSTANCE_COMMENTS);
        return p != null && p.AsString() == Marker;
    }

    // Graduate the current committed increment: retag Marker -> DoneMarker so subsequent
    // Solve()/Cleanup() calls leave it alone and the collision index sees it as existing duct.
    public static int KeepMarked(Document doc)
    {
        var els = MarkerElements(doc);
        foreach (var e in els)
        {
            var p = e.get_Parameter(BuiltInParameter.ALL_MODEL_INSTANCE_COMMENTS);
            if (p != null && !p.IsReadOnly) p.Set(DoneMarker);
        }
        return els.Count;
    }

    // ---------- intent parsing (loose: unknown fields warn, bad values name valid options) ----------
    // Parses from a JSON STRING (the pod parsed from a file path). `authoritativeLevel` is the
    // DuctPlacer constructor's level; if the JSON's `level` field mismatches, warn and keep it.
    public static Intent ParseIntent(Document doc, string json, Level authoritativeLevel)
    {
        if (string.IsNullOrWhiteSpace(json))
            throw new InvalidOperationException("intent JSON is empty. Pass an intent JSON string (schema: see INTENT.md).");
        JObject jd;
        try { jd = JObject.Parse(json); }
        catch (JsonReaderException ex) { throw new InvalidOperationException($"intent JSON is not valid JSON: {ex.Message}"); }
        {
            var root = jd;
            var it = new Intent();
            WarnUnknown(it, root, "intent", "name", "level", "system", "trunk", "branches", "constraints");

            it.Name = Str(root, "name") ?? "unnamed";

            // constructor's level is authoritative; a mismatching intent.level only warns.
            it.Level = authoritativeLevel;
            var jsonLevel = Str(root, "level");
            if (jsonLevel != null)
            {
                var byName = TryResolveLevel(doc, jsonLevel);
                if (byName == null)
                    it.Warnings.Add($"intent.level '{jsonLevel}' not resolvable — using constructor level '{authoritativeLevel.Name}'");
                else if (byName.Id.Value() != authoritativeLevel.Id.Value())
                    it.Warnings.Add($"intent.level '{jsonLevel}' ({byName.Name}) differs from constructor level '{authoritativeLevel.Name}' — using the constructor's (authoritative)");
            }

            it.System = ResolveSystem(doc, Str(root, "system") ?? "Supply Air");

            if (!root.TryGetValue("trunk", out var trunkToken) || trunkToken is not JObject tr)
                throw new InvalidOperationException("intent.trunk missing. Need: { ductType, size, elevationFt, from:[x,y], to:[x,y] }");
            WarnUnknown(it, tr, "trunk", "ductType", "size", "elevationFt", "from", "to");
            it.TrunkType = ResolveDuctType(doc, Str(tr, "ductType") ?? "Rectangular Duct: Mitered Elbows / Taps");
            var size = ParseRectSize(Str(tr, "size") ?? "12x8");
            it.TrunkWFt = size.Item1; it.TrunkHFt = size.Item2;
            it.TrunkElevFt = Num(tr, "elevationFt") ?? 9.0;
            var f = ResolvePoint(doc, tr, "from"); it.FromX = f.Item1; it.FromY = f.Item2; it.FromElementId = f.Item3;
            var t2 = ResolvePoint(doc, tr, "to"); it.ToX = t2.Item1; it.ToY = t2.Item2; it.ToElementId = t2.Item3;

            if (root.TryGetValue("branches", out var branchesToken) && branchesToken is JObject br)
            {
                WarnUnknown(it, br, "branches", "ductType", "sizeIn", "elevationFt", "stubFt", "terminals", "connect");
                it.BranchType = ResolveDuctType(doc, Str(br, "ductType") ?? "Round Duct: Taps");
                it.BranchDiaFt = (Num(br, "sizeIn") ?? 8.0) / 12.0;
                it.BranchElevFt = Num(br, "elevationFt") ?? double.NaN;
                it.StubFt = Num(br, "stubFt") ?? 1.5;
                it.Connect = Bool(br, "connect") ?? true;
                if (br.TryGetValue("terminals", out var terminalsToken) && terminalsToken is JArray terms)
                    foreach (var value in terms) it.Terminals.Add(value.Value<long>());
            }
            else it.BranchType = ResolveDuctType(doc, "Round Duct: Taps");

            if (root.TryGetValue("constraints", out var constraintsToken) && constraintsToken is JObject cs)
            {
                WarnUnknown(it, cs, "constraints", "avoid", "clearanceIn", "maxBends", "gridFt", "keepOut");
                if (cs.TryGetValue("avoid", out var avoidToken) && avoidToken is JArray av)
                {
                    it.Avoid.Clear();
                    foreach (var value in av)
                    {
                        var g = value.Value<string>() ?? "";
                        if (!Intent.KnownGroups.Contains(g, StringComparer.OrdinalIgnoreCase))
                            it.Warnings.Add($"constraints.avoid: unknown group '{g}' ignored (valid: {string.Join(",", Intent.KnownGroups)})");
                        else it.Avoid.Add(g.ToLowerInvariant());
                    }
                }
                it.ClearanceFt = (Num(cs, "clearanceIn") ?? 2.0) / 12.0;
                it.MaxBends = (int)(Num(cs, "maxBends") ?? 8);
                it.GridFt = Num(cs, "gridFt") ?? 0.5;
                if (cs.TryGetValue("keepOut", out var keepOutToken) && keepOutToken is JArray ko)
                    foreach (var value in ko)
                    {
                        var k = (JObject)value;
                        var mn = (JArray)k["min"]!; var mx = (JArray)k["max"]!;
                        it.KeepOut.Add(new double[] { mn[0]!.Value<double>(), mn[1]!.Value<double>(), mx[0]!.Value<double>(), mx[1]!.Value<double>() });
                        it.KeepOutNames.Add(Str(k, "name") ?? $"keepOut{it.KeepOut.Count}");
                    }
            }
            return it;
        }
    }

    static void WarnUnknown(Intent it, JObject obj, string where, params string[] known)
    {
        foreach (var property in obj.Properties())
            if (!known.Contains(property.Name, StringComparer.OrdinalIgnoreCase))
                it.Warnings.Add($"{where}.{property.Name}: unknown field ignored (known: {string.Join(",", known)})");
    }

    static string Str(JObject obj, string name)
        => obj.TryGetValue(name, out var value) && value.Type == JTokenType.String ? value.Value<string>() : null;

    static double? Num(JObject obj, string name)
        => obj.TryGetValue(name, out var value) && value.Type is JTokenType.Integer or JTokenType.Float
            ? value.Value<double>() : (double?)null;

    static bool? Bool(JObject obj, string name)
        => obj.TryGetValue(name, out var value) && value.Type == JTokenType.Boolean
            ? value.Value<bool>() : (bool?)null;

    static (double, double) ParseRectSize(string s)
    {
        var parts = s.ToLowerInvariant().Replace("\"", "").Split('x');
        if (parts.Length != 2 || !double.TryParse(parts[0], out var w) || !double.TryParse(parts[1], out var h))
            throw new InvalidOperationException($"trunk.size '{s}' unreadable. Use inches as \"WxH\", e.g. \"12x8\".");
        return (w / 12.0, h / 12.0);
    }

    static (double, double, long?) ResolvePoint(Document doc, JObject parent, string name)
    {
        if (!parent.TryGetValue(name, out var value))
            throw new InvalidOperationException($"trunk.{name} missing. Use [x,y] in model feet or {{\"element\": <id>}}.");
        if (value is JArray points && points.Count >= 2)
            return (points[0]!.Value<double>(), points[1]!.Value<double>(), null);
        if (value is JObject point && point.TryGetValue("element", out var idToken))
        {
            var idv = idToken.Value<long>();
            var el = doc.GetElement(idv.ToElementId());
            if (el == null) throw new InvalidOperationException($"trunk.{name}.element {idv} not found in model.");
            if (el.Location is LocationPoint lp) return (lp.Point.X, lp.Point.Y, idv);
            var bb = el.get_BoundingBox(null);
            if (bb == null) throw new InvalidOperationException($"trunk.{name}.element {idv} has no location/bbox.");
            return ((bb.Min.X + bb.Max.X) / 2, (bb.Min.Y + bb.Max.Y) / 2, idv);
        }
        throw new InvalidOperationException($"trunk.{name} must be [x,y] or {{\"element\": id}}.");
    }

    static Level TryResolveLevel(Document doc, string q)
    {
        var levels = new FilteredElementCollector(doc).OfClass(typeof(Level)).Cast<Level>().ToList();
        if (long.TryParse(q, out var id))
        {
            var byId = levels.FirstOrDefault(l => l.Id.Value() == id);
            if (byId != null) return byId;
        }
        return levels.FirstOrDefault(l => string.Equals(l.Name, q, StringComparison.OrdinalIgnoreCase));
    }

    public static Level ResolveLevel(Document doc, string q)
    {
        var hit = TryResolveLevel(doc, q);
        if (hit != null) return hit;
        var levels = new FilteredElementCollector(doc).OfClass(typeof(Level)).Cast<Level>().ToList();
        throw new InvalidOperationException($"level '{q}' not found. Valid: {string.Join(", ", levels.OrderBy(l => l.Elevation).Select(l => l.Name))}");
    }

    public static MechanicalSystemType ResolveSystem(Document doc, string q)
    {
        var all = new FilteredElementCollector(doc).OfClass(typeof(MechanicalSystemType)).Cast<MechanicalSystemType>().ToList();
        if (long.TryParse(q, out var id))
        {
            var byId = all.FirstOrDefault(s => s.Id.Value() == id);
            if (byId != null) return byId;
        }
        // Exact name wins outright — real projects have both "Exhaust Air" and "ERV Exhaust Air",
        // so contains-matching alone refuses the most common asks.
        var exact = all.FirstOrDefault(s => s.Name.Equals(q, StringComparison.OrdinalIgnoreCase));
        if (exact != null) return exact;
        var hits = all.Where(s => s.Name.Contains(q, StringComparison.OrdinalIgnoreCase)).ToList();
        if (hits.Count == 1) return hits[0];
        throw new InvalidOperationException($"system '{q}' matched {hits.Count} of: {string.Join(", ", all.Select(s => s.Name))}");
    }

    public static DuctType ResolveDuctType(Document doc, string q)
    {
        var all = new FilteredElementCollector(doc).OfClass(typeof(DuctType)).Cast<DuctType>().ToList();
        if (long.TryParse(q, out var id))
        {
            var byId = all.FirstOrDefault(t => t.Id.Value() == id);
            if (byId != null) return byId;
        }
        string Label(DuctType t) => $"{t.FamilyName}: {t.Name}";
        var exact = all.FirstOrDefault(t => Label(t).Equals(q, StringComparison.OrdinalIgnoreCase)
            || t.Name.Equals(q, StringComparison.OrdinalIgnoreCase));
        if (exact != null) return exact;
        var hits = all.Where(t => Label(t).Contains(q, StringComparison.OrdinalIgnoreCase)).ToList();
        if (hits.Count == 1) return hits[0];
        var names = string.Join(" | ", all.Select(Label));
        throw new InvalidOperationException(hits.Count == 0
            ? $"ductType '{q}' matched nothing. Valid: {names}"
            : $"ductType '{q}' ambiguous ({string.Join(" | ", hits.Select(Label))}). Be more specific.");
    }

    // ---------- persistence + diff (state dir injected; last_solve.json under it) ----------
    public static string LastSolvePath(string stateDir) => Path.Combine(stateDir, "last_solve.json");

    public static SolveDto ReadLastSolve(string stateDir)
    {
        var path = LastSolvePath(stateDir);
        if (!File.Exists(path)) return null;
        try { return JsonConvert.DeserializeObject<SolveDto>(File.ReadAllText(path), Json); }
        catch { return null; }
    }

    public static void WriteLastSolve(string stateDir, SolveDto dto)
    {
        Directory.CreateDirectory(stateDir);
        File.WriteAllText(LastSolvePath(stateDir), JsonConvert.SerializeObject(dto, Json));
    }

    public static IEnumerable<string> Diff(SolveDto prev, SolveDto cur)
    {
        if (prev == null) { yield return "DIFF: first solve, no baseline."; yield break; }
        yield return $"DIFF vs solve of {prev.SolvedAt}:";
        foreach (var p in cur.Paths)
        {
            var o = prev.Paths.FirstOrDefault(x => x.Key == p.Key);
            if (o == null) { yield return $"  {p.Key}: NEW (len {p.LengthFt:F1} ft, {p.Bends} bends)"; continue; }
            var bits = new List<string>();
            if (Math.Abs(p.LengthFt - o.LengthFt) > 0.05) bits.Add($"len {o.LengthFt:F1}->{p.LengthFt:F1} ({p.LengthFt - o.LengthFt:+0.0;-0.0} ft)");
            if (p.Bends != o.Bends) bits.Add($"bends {o.Bends}->{p.Bends}");
            if (Math.Abs(p.ZFt - o.ZFt) > 0.01) bits.Add($"z {o.ZFt:F2}->{p.ZFt:F2} ({p.ZFt - o.ZFt:+0.00;-0.00} ft)");
            if (Math.Abs(p.MinClearIn - o.MinClearIn) > 0.3) bits.Add($"minClear {o.MinClearIn:F1}->{p.MinClearIn:F1} in");
            if (p.Collisions != o.Collisions) bits.Add($"collisions {o.Collisions}->{p.Collisions}");
            yield return $"  {p.Key}: {(bits.Count == 0 ? "unchanged" : string.Join(", ", bits))}";
        }
        foreach (var o in prev.Paths.Where(o => cur.Paths.All(p => p.Key != o.Key)))
            yield return $"  {o.Key}: REMOVED";
        if (prev.Collisions != cur.Collisions)
            yield return $"  total collisions {prev.Collisions}->{cur.Collisions}";
    }
}

// Parsed intent, with resolved Revit objects. All lengths in feet.
internal sealed class Intent
{
    public static readonly string[] KnownGroups = { "mep", "walls", "structure", "equipment", "terminals" };

    public string Name = "unnamed";
    public Level Level;
    public MechanicalSystemType System;
    public DuctType TrunkType;
    public double TrunkWFt, TrunkHFt;
    public double TrunkElevFt = 9.0;      // centerline above level
    public double FromX, FromY, ToX, ToY;
    public long? FromElementId, ToElementId;   // set when from/to was declared as {"element": id}
    public DuctType BranchType;
    public double BranchDiaFt = 8.0 / 12;
    public double BranchElevFt = double.NaN; // centerline above level; NaN = trunk elevation
    public double StubFt = 1.5;
    public List<long> Terminals = new List<long>();
    public bool Connect = true;
    public HashSet<string> Avoid = new HashSet<string>(StringComparer.OrdinalIgnoreCase)
        { "mep", "walls", "structure", "equipment", "terminals" };
    public double ClearanceFt = 2.0 / 12;
    public int MaxBends = 8;
    public double GridFt = 0.5;
    public List<double[]> KeepOut = new List<double[]>();     // x0,y0,x1,y1
    public List<string> KeepOutNames = new List<string>();
    public List<string> Warnings = new List<string>();

    public double BranchZRel => double.IsNaN(BranchElevFt) ? TrunkElevFt : BranchElevFt;
}

// ---------- solve result DTOs (persisted to <stateDir>/last_solve.json; Commit reads this) ----------
public sealed class SolveDto
{
    public string SolvedAt { get; set; } = "";
    public string IntentName { get; set; } = "";
    public string Source { get; set; } = "intent";  // intent | verbs
    public long LevelId { get; set; }
    public double LevelElev { get; set; }
    public long SystemTypeId { get; set; }
    public double GridFt { get; set; }
    public double ClearanceIn { get; set; }
    public List<string> Avoid { get; set; } = new List<string>();
    public List<double[]> KeepOut { get; set; } = new List<double[]>();   // x0,y0,x1,y1
    public List<string> KeepOutNames { get; set; } = new List<string>();
    public List<PathDto> Paths { get; set; } = new List<PathDto>();
    public long? FromElementId { get; set; }   // trunk endpoints declared as {"element": id}
    public long? ToElementId { get; set; }
    public int Collisions { get; set; }
    public int Exempted { get; set; }
    public int SelfHits { get; set; }
    public List<string> Report { get; set; } = new List<string>();
}

public sealed class PathDto
{
    public string Key { get; set; } = "";      // "trunk" or terminal id
    public string Kind { get; set; } = "";     // trunk | branch
    public long DuctTypeId { get; set; }
    public string Shape { get; set; } = "";    // rect | round
    public double WidthIn { get; set; }
    public double HeightIn { get; set; }
    public double DiaIn { get; set; }
    public double ZFt { get; set; }            // absolute centerline z
    public List<double[]> Points { get; set; } = new List<double[]>(); // XY waypoints
    public List<double[]> Points3 { get; set; } // verbs mode: [x,y,z] polyline (overrides Points for geometry)
    public double LengthFt { get; set; }
    public int Bends { get; set; }
    public double MinClearIn { get; set; }
    public string Pinch { get; set; } = "";
    public int Collisions { get; set; }
    // branch extras
    public long TerminalId { get; set; }
    public double[] Conn { get; set; }         // terminal connector origin xyz
    public RiserDto Riser { get; set; }        // null when branch z ~= connector z
    public StubDto Stub { get; set; }          // null when riser lands on connector XY
    public bool Connect { get; set; }
    public string TerminalStatus { get; set; } = "";
}

public sealed class RiserDto { public double X { get; set; } public double Y { get; set; } public double Z0 { get; set; } public double Z1 { get; set; } }
public sealed class StubDto { public double[] From { get; set; } public double[] To { get; set; } }
