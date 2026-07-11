namespace Pe.Revit.Takeoff;

// Facade. Room detection needs THREE script executions because the host owns exactly one
// transaction per run and ExportImage refuses to run mid-transaction:
//
//   1. Prepare (WriteTransaction) — resolve level, size the crop from geometry, create the two
//      stripped seed views. Persists a state file so later runs re-derive nothing.
//   2. Detect (ReadOnly) — export + read the seed ink, build the heightfield, detect, write TSV.
//   3. Annotate (WriteTransaction) — rainbow evidence view.  Then ExportEvidence (ReadOnly),
//      Cleanup (WriteTransaction) as needed.
//
// A pea script therefore stays tiny:
//   RoomTakeoff.Prepare(doc, new TakeoffOptions { LevelNameContains = "Upper" }, WriteLine);
//   ...next run...   var r = RoomTakeoff.Detect(doc, "Upper", WriteLine);
//   ...next run...   RoomTakeoff.Annotate(doc, "Upper", WriteLine);
//
// Method choice (why projection seed + heightfield, decided 2026-07-06 on Chadds Ford):
// four competing approaches ran as isolated pods against a framing-stage IFC estate (70k
// DirectShapes, no Wall elements, no Rooms). Autodesk-native (EnergyAnalysisDetailModel, gbXML,
// link room-bounding) is definitively blind to DirectShapes; geometry slicing needs a per-model
// cut-height hack per failure mode; Revit's renderer supplies wall ink through physically clipped
// top-down 3D bands, while the headroom field rejects roofless areas and adds ceiling heights.
// The composite is deliberate: ink = walls, field = physics.
// Dev law: extract once, iterate locally — never tune detection through repeated bridge runs.
public static class RoomTakeoff
{
    private static readonly HashSet<ElementId> SpatialSlabCategories = new(new[] {
        BuiltInCategory.OST_Floors, BuiltInCategory.OST_Roofs, BuiltInCategory.OST_Ceilings,
        BuiltInCategory.OST_Stairs, BuiltInCategory.OST_Ramps,
    }.Select(category => ((long)category).ToElementId()));

    public static string DefaultArtifactDir =>
        Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.MyDocuments), "Pe.Tools", "takeoff");

    public static void Prepare(Document doc, TakeoffOptions opt, Action<string> log)
    {
        var level = ResolveLevel(doc, opt.LevelNameContains);
        var crop = ComputeCrop(doc, level, opt);
        var (va, vb) = ProjectionSeed.PrepareSeedViews(doc, level, crop, opt, log);
        SaveState(opt, level, crop, va, vb);
        log($"[prepare] level='{level.Name}' crop=({crop.Min.X:F0},{crop.Min.Y:F0})..({crop.Max.X:F0},{crop.Max.Y:F0})");
    }

    public static TakeoffResult Detect(Document doc, string levelNameContains, Action<string> log, TakeoffOptions? optOverride = null)
    {
        var opt = optOverride ?? new TakeoffOptions();
        opt.LevelNameContains = levelNameContains;
        var level = ResolveLevel(doc, levelNameContains);
        var (crop, va, vb) = LoadState(opt, level);
        string workDir = ArtifactDir(opt);

        var hf = Heightfield.Build(doc, level, crop, opt, log);
        int n = hf.W * hf.H;
        var ink = ProjectionSeed.CaptureInk(doc, va, vb, crop, hf.W, hf.H, opt.CellFt, workDir, opt, log);
        var result = Detector.Detect(hf, ink, level, opt, log);
        result.SeedViewA = va; result.SeedViewB = vb;

        string tsv = Path.Combine(workDir, $"rooms_{Sanitize(level.Name)}.tsv");
        File.WriteAllText(tsv, result.ToTsv());
        log($"[detect] rooms={result.Rooms.Count} totalSqft={result.TotalSqft:F0} -> {tsv}");
        return result;
    }

    public static string Annotate(Document doc, string levelNameContains, Action<string> log, TakeoffOptions? optOverride = null)
    {
        var opt = optOverride ?? new TakeoffOptions();
        opt.LevelNameContains = levelNameContains;
        var level = ResolveLevel(doc, levelNameContains);
        var result = LoadResult(opt, level);
        return Annotate_(doc, level, result, opt, log);
    }

    public static List<string> ExportEvidence(Document doc, Action<string> log, TakeoffOptions? optOverride = null)
    {
        var opt = optOverride ?? new TakeoffOptions();
        return Takeoff.Annotate.ExportEvidence(doc, $"{opt.Marker} takeoff", Path.Combine(ArtifactDir(opt), "evidence"), log);
    }

    public static int Cleanup(Document doc, Action<string> log, TakeoffOptions? optOverride = null) =>
        Takeoff.Annotate.Cleanup(doc, optOverride ?? new TakeoffOptions(), log);

    private static string Annotate_(Document doc, Level level, TakeoffResult result, TakeoffOptions opt, Action<string> log) =>
        Takeoff.Annotate.DrawEvidence(doc, level, result, opt, log);

    private static Level ResolveLevel(Document doc, string nameContains) =>
        new FilteredElementCollector(doc).OfClass(typeof(Level)).Cast<Level>()
            .OrderBy(l => l.ProjectElevation)
            .FirstOrDefault(l => l.Name.IndexOf(nameContains, StringComparison.OrdinalIgnoreCase) >= 0)
        ?? throw new InvalidOperationException($"no level matching '{nameContains}'");

    // Crop = XY extent of geometry crossing the level's occupancy band, padded. Cheap bb pass over
    // host + links (transformed corners — link transforms are non-identity on real projects).
    private static BoundingBoxXYZ ComputeCrop(Document doc, Level level, TakeoffOptions opt)
    {
        double zLo = level.ProjectElevation + 1.0, zHi = level.ProjectElevation + opt.HeaderBandFt + 1.0;
        double x0 = double.MaxValue, y0 = double.MaxValue, x1 = double.MinValue, y1 = double.MinValue;
        foreach (var (srcDoc, xf) in Sources(doc))
        {
            foreach (var e in new FilteredElementCollector(srcDoc).WhereElementIsNotElementType())
            {
                var categoryId = e.Category?.Id;
                if (!ProjectionSeed.IsInkCategory(categoryId)
                    && (categoryId == null || !SpatialSlabCategories.Contains(categoryId))) continue;
                var bb = e.get_BoundingBox(null);
                if (bb == null) continue;
                double bx0 = double.MaxValue, by0 = double.MaxValue, bz0 = double.MaxValue;
                double bx1 = double.MinValue, by1 = double.MinValue, bz1 = double.MinValue;
                foreach (var cx in new[] { bb.Min.X, bb.Max.X })
                    foreach (var cy in new[] { bb.Min.Y, bb.Max.Y })
                        foreach (var cz in new[] { bb.Min.Z, bb.Max.Z })
                        {
                            var p = xf.OfPoint(new XYZ(cx, cy, cz));
                            bx0 = Math.Min(bx0, p.X); bx1 = Math.Max(bx1, p.X);
                            by0 = Math.Min(by0, p.Y); by1 = Math.Max(by1, p.Y);
                            bz0 = Math.Min(bz0, p.Z); bz1 = Math.Max(bz1, p.Z);
                        }
                if (bz0 > zHi || bz1 < zLo) continue;
                // skip absurd spans (site/topo/survey junk inflates the grid massively)
                if (bx1 - bx0 > 500 || by1 - by0 > 500) continue;
                x0 = Math.Min(x0, bx0); x1 = Math.Max(x1, bx1);
                y0 = Math.Min(y0, by0); y1 = Math.Max(y1, by1);
            }
        }
        if (x0 > x1) throw new InvalidOperationException("no geometry found at level band");
        return new BoundingBoxXYZ {
            Min = new XYZ(x0 - 5, y0 - 5, level.ProjectElevation),
            Max = new XYZ(x1 + 5, y1 + 5, level.ProjectElevation + 12),
        };
    }

    private static IEnumerable<(Document doc, Transform xf)> Sources(Document host)
    {
        yield return (host, Transform.Identity);
        foreach (var li in new FilteredElementCollector(host).OfClass(typeof(RevitLinkInstance)).Cast<RevitLinkInstance>())
        {
            var ld = li.GetLinkDocument();
            if (ld != null) yield return (ld, li.GetTotalTransform());
        }
    }

    // ---- tiny state file: steps run in separate script executions; no JSON dep needed ----
    private static string ArtifactDir(TakeoffOptions opt)
    {
        var dir = opt.ArtifactDir ?? DefaultArtifactDir;
        Directory.CreateDirectory(dir);
        return dir;
    }

    private static string Sanitize(string s) =>
        string.Concat(s.Select(ch => char.IsLetterOrDigit(ch) ? ch : '_'));

    private static string StatePath(TakeoffOptions opt, Level level) =>
        Path.Combine(ArtifactDir(opt), $"state_{Sanitize(level.Name)}.txt");

    private static void SaveState(TakeoffOptions opt, Level level, BoundingBoxXYZ crop, string va, string vb)
    {
        var ic = CultureInfo.InvariantCulture;
        File.WriteAllLines(StatePath(opt, level), new[] {
            $"minx={crop.Min.X.ToString("F6", ic)}", $"miny={crop.Min.Y.ToString("F6", ic)}",
            $"maxx={crop.Max.X.ToString("F6", ic)}", $"maxy={crop.Max.Y.ToString("F6", ic)}",
            $"minz={crop.Min.Z.ToString("F6", ic)}", $"maxz={crop.Max.Z.ToString("F6", ic)}",
            $"viewA={va}", $"viewB={vb}",
        });
    }

    private static (BoundingBoxXYZ crop, string va, string vb) LoadState(TakeoffOptions opt, Level level)
    {
        var path = StatePath(opt, level);
        if (!File.Exists(path)) throw new InvalidOperationException($"no takeoff state at {path} — run Prepare first");
        var kv = File.ReadAllLines(path).Select(l => l.Split(new[] { '=' }, 2))
            .Where(p => p.Length == 2).ToDictionary(p => p[0], p => p[1]);
        double G(string k) => double.Parse(kv[k], CultureInfo.InvariantCulture);
        var crop = new BoundingBoxXYZ { Min = new XYZ(G("minx"), G("miny"), G("minz")), Max = new XYZ(G("maxx"), G("maxy"), G("maxz")) };
        return (crop, kv["viewA"], kv["viewB"]);
    }

    private static TakeoffResult LoadResult(TakeoffOptions opt, Level level)
    {
        string tsv = Path.Combine(ArtifactDir(opt), $"rooms_{Sanitize(level.Name)}.tsv");
        if (!File.Exists(tsv)) throw new InvalidOperationException($"no detection result at {tsv} — run Detect first");
        var result = new TakeoffResult { LevelName = level.Name, LevelElevation = level.ProjectElevation };
        var rooms = new Dictionary<string, RoomResult>();
        var ic = CultureInfo.InvariantCulture;
        foreach (var line in File.ReadAllLines(tsv))
        {
            var p = line.Split('\t');
            if (p[0] == "ROOM")
            {
                var r = new RoomResult {
                    Id = p[1],
                    RawSqft = double.Parse(p[2], ic), PerimeterFt = double.Parse(p[3], ic),
                    LabelX = double.Parse(p[4], ic), LabelY = double.Parse(p[5], ic),
                    MeanCeilingFt = double.Parse(p[6], ic),
                };
                rooms[r.Id] = r;
                result.Rooms.Add(r);
                result.TotalSqft += r.RawSqft;
            }
            else if (p[0] == "POLY" && rooms.TryGetValue(p[1], out var room))
            {
                var poly = p[3].Split('|').Select(pt => {
                    var xy = pt.Split(';');
                    return new[] { double.Parse(xy[0], ic), double.Parse(xy[1], ic) };
                }).ToList();
                if (p[2] == "outer") room.Polygon = poly; else room.Holes.Add(poly);
            }
        }
        return result;
    }
}
