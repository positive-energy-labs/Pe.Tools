namespace Pe.Revit.Takeoff;

using System.Security.Cryptography;
using System.Text;

// Facade. Detection runs as separate script executions because the host owns exactly one
// transaction per run and ExportImage refuses to run mid-transaction:
//   1. Prepare (WriteTransaction) — resolve level, size the crop, create the stripped seed views;
//      persists a state file so later runs re-derive nothing.
//   2. Detect (ReadOnly) — export + read the seed ink, build the heightfield, detect, write TSV.
// Method: ink = walls (Revit's renderer through clipped top-down 3D bands), field = physics (the
// headroom field rejects roofless areas and supplies ceiling heights).
// See docs/features/takeoffs/rhvac-and-mj-reference.md.
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
        var (va, va2, vb, vbf, vf, vf0, vd) = ProjectionSeed.PrepareSeedViews(doc, level, crop, opt, log);
        SaveState(opt, level, crop, va, va2, vb, vbf, vf, vf0, vd);
        log($"[prepare] level='{level.Name}' crop=({crop.Min.X:F0},{crop.Min.Y:F0})..({crop.Max.X:F0},{crop.Max.Y:F0})");
    }

    public static TakeoffResult Detect(Document doc, string levelNameContains, Action<string> log, TakeoffOptions? optOverride = null)
    {
        var opt = optOverride ?? new TakeoffOptions();
        opt.LevelNameContains = levelNameContains;
        var level = ResolveLevel(doc, levelNameContains);
        var (crop, va, va2, vb, vbf, vf, vf0, vd) = LoadState(opt, level);
        string workDir = ArtifactDir(opt);
        var heightfieldOptions = opt.InferLevelProfile
            ? new TakeoffOptions {
                InferLevelProfile = false,
                CellFt = opt.CellFt,
                FloorTolFt = opt.FloorTolFt,
                StoryCapFt = new LevelProfileThresholds().EvidenceStoryCapFt,
                CeilingCloseFt = 0,
            }
            : opt;
        string captureOptions = DetectSnapshot.CaptureOptionsOf(heightfieldOptions);
        var hf = Heightfield.Build(doc, level, crop, heightfieldOptions, log);
        int n = hf.W * hf.H;
        var bands = ProjectionSeed.CaptureBands(
            doc, va, va2, vb, vbf, vf, vf0, vd, crop, hf.W, hf.H, opt.CellFt, workDir, opt, log);
        var ink = ProjectionSeed.ComposeInk(
            bands.Plan, bands.Header, hf.W, hf.H, opt.CellFt, opt, floorEdge: null, log);
        double lvlZ = level.ProjectElevation;
        var snapshot = new DetectSnapshot {
            LevelName = level.Name, LevelElevation = lvlZ,
            CaptureOptions = captureOptions, Field = hf, SeedInk = ink,
        };
        LevelProfile? appliedProfile = null;
        if (opt.InferLevelProfile)
        {
            appliedProfile = TakeoffPolicy.InferLevelProfile(snapshot);
            appliedProfile.ApplyPolicyTo(opt);
            log($"[profile] {appliedProfile.Provenance}");
        }
        var planObstruction = Detector.BuildObstruction(hf, ink, lvlZ, opt, _ => { });
        var footprint = Detector.InkBoundedFloor(hf, planObstruction, lvlZ, opt.FloorTolFt);
        // floor-slab edge: stair voids, overlooks, and the building envelope (which the header
        // band's proximity gate anchors on — eave walls under a roof slope have no knee ink)
        var floorEdge = new bool[n];
        for (int i = 0; i < n; i++)
        {
            if (!footprint[i]) continue;
            int x = i % hf.W, y = i / hf.W;
            if (x > 0 && !footprint[i - 1] || x < hf.W - 1 && !footprint[i + 1]
                || y > 0 && !footprint[i - hf.W] || y < hf.H - 1 && !footprint[i + hf.W])
                floorEdge[i] = true;
        }
        if (opt.DumpReplaySnapshot)
        {
            // Offline-iteration capture: exactly what Detector.Detect consumes (see DetectSnapshot
            // header for the honesty boundary).
            string snapPath = Path.Combine(workDir, $"replay_{Sanitize(level.Name)}.bin");
            DetectSnapshot.Save(snapPath, snapshot);
            log($"[replay] detect-input snapshot -> {snapPath}");
        }
        var result = appliedProfile == null
            ? Detector.Detect(hf, ink, level.Name, level.ProjectElevation, opt, log)
            : TakeoffPolicy.Detect(snapshot, appliedProfile, log);
        result.SeedViewA = va; result.SeedViewB = vb;
        // Boundary-evidence raster for materialization: where is a boundary REAL geometry rather
        // than an equidistance seam? Real = knee-band wall ink (doors are open at +4 ft; the header
        // band would mark sealed openings as walls) or a floor edge (stair voids, overlooks).
        var evidence = (bool[])bands.Plan.Clone();
        for (int i = 0; i < n; i++) evidence[i] |= floorEdge[i];
        InkSupport.Save(InkPath(opt, level), hf.W, hf.H, hf.MinX, hf.MinY, opt.CellFt, evidence);

        string tsv = Path.Combine(workDir, $"rooms_{Sanitize(level.Name)}.tsv");
        File.WriteAllText(tsv, result.ToTsv());
        log($"[detect] rooms={result.Rooms.Count} totalSqft={result.TotalSqft:F0} -> {tsv}");
        return result;
    }

    private static string InkPath(TakeoffOptions opt, Level level) =>
        Path.Combine(ArtifactDir(opt), $"ink_{Sanitize(level.Name)}.bin");

    private static string DocumentIdentity(Document doc)
    {
        try
        {
            if (doc.IsModelInCloud)
            {
                var path = doc.GetCloudModelPath();
                return $"cloud:{path.GetProjectGUID():D}:{path.GetModelGUID():D}";
            }
            if (!string.IsNullOrWhiteSpace(doc.PathName))
                return "path:" + Path.GetFullPath(doc.PathName).ToUpperInvariant();
        }
        catch
        {
            // Fall through to a process-local identity for unsaved/test documents.
        }
        return $"session:{doc.Title}:{doc.GetHashCode()}";
    }

    private static string Sha256(string value)
    {
        using var sha = SHA256.Create();
        return BitConverter.ToString(sha.ComputeHash(Encoding.UTF8.GetBytes(value)))
            .Replace("-", "").ToLowerInvariant();
    }

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

    private static void SaveState(TakeoffOptions opt, Level level, BoundingBoxXYZ crop, string va, string va2, string vb, string vbf, string vf, string vf0, string? vd)
    {
        var ic = CultureInfo.InvariantCulture;
        var lines = new List<string> {
            $"minx={crop.Min.X.ToString("F6", ic)}", $"miny={crop.Min.Y.ToString("F6", ic)}",
            $"maxx={crop.Max.X.ToString("F6", ic)}", $"maxy={crop.Max.Y.ToString("F6", ic)}",
            $"minz={crop.Min.Z.ToString("F6", ic)}", $"maxz={crop.Max.Z.ToString("F6", ic)}",
            $"viewA={va}", $"viewA2={va2}", $"viewB={vb}", $"viewBF={vbf}", $"viewF={vf}", $"viewF0={vf0}",
        };
        if (vd != null) lines.Add($"viewD={vd}");
        File.WriteAllLines(StatePath(opt, level), lines);
    }

    private static (BoundingBoxXYZ crop, string va, string va2, string vb, string vbf, string vf, string vf0, string? vd) LoadState(TakeoffOptions opt, Level level)
    {
        var path = StatePath(opt, level);
        if (!File.Exists(path)) throw new InvalidOperationException($"no takeoff state at {path} — run Prepare first");
        var kv = File.ReadAllLines(path).Select(l => l.Split(new[] { '=' }, 2))
            .Where(p => p.Length == 2).ToDictionary(p => p[0], p => p[1]);
        if (!kv.ContainsKey("viewBF"))
            throw new InvalidOperationException("takeoff state predates the framing-support seed — run Prepare again");
        double G(string k) => double.Parse(kv[k], CultureInfo.InvariantCulture);
        var crop = new BoundingBoxXYZ { Min = new XYZ(G("minx"), G("miny"), G("minz")), Max = new XYZ(G("maxx"), G("maxy"), G("maxz")) };
        return (crop, kv["viewA"], kv["viewA2"], kv["viewB"], kv["viewBF"], kv["viewF"], kv["viewF0"], kv.GetValueOrDefault("viewD"));
    }

    private static TakeoffResult LoadResult(TakeoffOptions opt, Level level)
    {
        string tsv = Path.Combine(ArtifactDir(opt), $"rooms_{Sanitize(level.Name)}.tsv");
        if (!File.Exists(tsv)) throw new InvalidOperationException($"no detection result at {tsv} — run Detect first");
        return LoadResult(File.ReadAllText(tsv), level.Name, level.ProjectElevation);
    }

    internal static TakeoffResult LoadResult(string tsv, string levelName, double levelElevation)
    {
        var result = new TakeoffResult { LevelName = levelName, LevelElevation = levelElevation };
        var rooms = new Dictionary<string, RoomResult>();
        var ic = CultureInfo.InvariantCulture;
        foreach (var line in tsv.Split(new[] { "\r\n", "\n" }, StringSplitOptions.RemoveEmptyEntries))
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
            else if (p.Length == 3 && p[0] == "META" && p[1] == "flag")
            {
                int separator = p[2].IndexOf(':');
                if (separator > 0 && rooms.TryGetValue(p[2][..separator], out var flagged))
                    flagged.Flags.AddRange(p[2][(separator + 1)..]
                        .Split(new[] { '+' }, StringSplitOptions.RemoveEmptyEntries));
            }
            else if (p.Length == 3 && p[0] == "META"
                     && p[1] is "splitFrom" or "mergedFrom")
            {
                int separator = p[2].IndexOf(':');
                if (separator > 0 && rooms.TryGetValue(p[2][..separator], out var tracked))
                {
                    string provenance = p[2][(separator + 1)..];
                    if (p[1] == "splitFrom") tracked.SplitFrom = provenance;
                    else tracked.MergedFrom = provenance;
                }
            }
            else if (p.Length >= 9 && p[0] == "META" && p[1] == "residue")
            {
                var residue = new ResidueResult {
                    Id = p[2], Reason = (ResidueReason)Enum.Parse(typeof(ResidueReason), p[3], true), RawSqft = double.Parse(p[4], ic),
                    LabelX = double.Parse(p[5], ic), LabelY = double.Parse(p[6], ic),
                    MeanCeilingFt = double.Parse(p[7], ic), Polygon = ParsePoly(p[8], ic),
                };
                for (int i = 9; i < p.Length; i++) residue.Holes.Add(ParsePoly(p[i], ic));
                result.Residues.Add(residue);
            }
        }
        return result;
    }

    private static List<double[]> ParsePoly(string text, CultureInfo ic) =>
        text.Split('|').Select(pt => {
            var xy = pt.Split(';');
            return new[] { double.Parse(xy[0], ic), double.Parse(xy[1], ic) };
        }).ToList();
}
