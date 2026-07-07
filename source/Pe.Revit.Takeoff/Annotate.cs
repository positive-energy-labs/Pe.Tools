namespace Pe.Revit.Takeoff;

// Takeoff annotation: rainbow FilledRegions + optional text markers on a fresh, marker-named
// evidence view, plus census/cleanup. Conventions paid for in round 1 (Snowdon) and Chadds:
// - Never mutate user views; fresh evidence views, cropped to the regions bbox (an estate's
//   site survey otherwise dwarfs the building in every export).
// - FilledRegions are view-specific: deleting the evidence view cleans everything with it.
// - TextNote has NO Comments parameter — mark notes by text content; detail items get
//   ALL_MODEL_INSTANCE_COMMENTS.
// - ExportImage must run in a separate ReadOnly execution: the host owns one transaction per
//   script run and Revit will not export mid-transaction.
public static class Annotate
{
    public static string DrawEvidence(
        Document doc, Level level, TakeoffResult result, TakeoffOptions opt, Action<string> log)
    {
        string vname = $"{opt.Marker} takeoff {level.Name}";
        var stale = new FilteredElementCollector(doc).OfClass(typeof(ViewPlan)).Cast<ViewPlan>()
            .Where(v => v.Name == vname).Select(v => v.Id).ToList();
        if (stale.Count > 0) doc.Delete(stale); // ICollection overload — see ProjectionSeed note

        var vft = new FilteredElementCollector(doc).OfClass(typeof(ViewFamilyType)).Cast<ViewFamilyType>()
            .First(t => t.ViewFamily == ViewFamily.FloorPlan);
        var view = ViewPlan.Create(doc, vft.Id, level.Id);
        view.Name = vname;
        try { view.ViewTemplateId = ElementId.InvalidElementId; } catch { } // template locks props — see ProjectionSeed
        try { view.Discipline = ViewDiscipline.Coordination; } catch { }
        try { view.Scale = 96; } catch { }

        var frType = new FilteredElementCollector(doc).OfClass(typeof(FilledRegionType)).Cast<FilledRegionType>().First();
        var solid = new FilteredElementCollector(doc).OfClass(typeof(FillPatternElement)).Cast<FillPatternElement>()
            .First(f => f.GetFillPattern().IsSolidFill);

        double x0 = double.MaxValue, y0 = double.MaxValue, x1 = double.MinValue, y1 = double.MinValue;
        int made = 0, failed = 0, idx = 0;
        foreach (var room in result.Rooms)
        {
            var color = Rainbow(idx++, result.Rooms.Count);
            try
            {
                var loops = new List<CurveLoop> { ToLoop(room.Polygon) };
                foreach (var h in room.Holes)
                    try { loops.Add(ToLoop(h)); } catch { /* tiny hole loops can degenerate */ }
                var fr = FilledRegion.Create(doc, frType.Id, view.Id, loops);
                fr.get_Parameter(BuiltInParameter.ALL_MODEL_INSTANCE_COMMENTS)?.Set($"{opt.Marker} {room.Id}");
                var ogs = new OverrideGraphicSettings()
                    .SetSurfaceForegroundPatternId(solid.Id)
                    .SetSurfaceForegroundPatternColor(color)
                    .SetSurfaceTransparency(35)
                    .SetProjectionLineColor(new Color(60, 60, 60));
                view.SetElementOverrides(fr.Id, ogs);
                made++;
                foreach (var p in room.Polygon)
                {
                    x0 = Math.Min(x0, p[0]); x1 = Math.Max(x1, p[0]);
                    y0 = Math.Min(y0, p[1]); y1 = Math.Max(y1, p[1]);
                }
            }
            catch (Exception ex) { failed++; log($"[annotate] {room.Id} failed: {ex.Message}"); }
        }
        if (made > 0)
        {
            var cb = view.CropBox;
            cb.Min = new XYZ(x0 - 25, y0 - 25, cb.Min.Z);
            cb.Max = new XYZ(x1 + 25, y1 + 25, cb.Max.Z);
            view.CropBox = cb;
            view.CropBoxActive = true;
            view.CropBoxVisible = false;
        }
        log($"[annotate] view='{vname}' regions made={made} failed={failed}");
        return vname;
    }

    // Separate ReadOnly execution (see class comment). Returns exported file paths.
    public static List<string> ExportEvidence(Document doc, string viewNamePrefix, string outDir, Action<string> log)
    {
        Directory.CreateDirectory(outDir);
        var files = new List<string>();
        foreach (var v in new FilteredElementCollector(doc).OfClass(typeof(ViewPlan)).Cast<ViewPlan>()
                 .Where(x => !x.IsTemplate && x.Name.StartsWith(viewNamePrefix)))
        {
            string basePath = Path.Combine(outDir, v.Name.Replace(" ", "_").ToLowerInvariant());
            var eo = new ImageExportOptions {
                ExportRange = ExportRange.SetOfViews,
                FilePath = basePath,
                HLRandWFViewsFileType = ImageFileType.PNG,
                ShadowViewsFileType = ImageFileType.PNG,
                ImageResolution = ImageResolution.DPI_150,
                PixelSize = 3000,
                FitDirection = FitDirectionType.Horizontal,
                ZoomType = ZoomFitType.FitToPage,
            };
            eo.SetViewsAndSheets(new List<ElementId> { v.Id });
            doc.ExportImage(eo);
            var file = Directory.GetFiles(outDir, Path.GetFileName(basePath) + "*")
                .OrderByDescending(File.GetLastWriteTimeUtc).FirstOrDefault();
            if (file != null) { files.Add(file); log($"[evidence] {file}"); }
        }
        return files;
    }

    // Census-then-delete of everything this library created (views carry their regions with
    // them). Census-first is the law on a shared bridge: after a transport failure the mutation
    // may still have landed — never blindly re-issue, count first.
    public static int Cleanup(Document doc, TakeoffOptions opt, Action<string> log)
    {
        var views = new FilteredElementCollector(doc).OfClass(typeof(ViewPlan)).Cast<ViewPlan>()
            .Where(v => v.Name.StartsWith(opt.Marker)).Select(v => v.Id).ToList();
        if (views.Count > 0) doc.Delete(views);
        log($"[cleanup] deleted {views.Count} views (regions go with them)");
        return views.Count;
    }

    private static CurveLoop ToLoop(List<double[]> pts)
    {
        var clean = new List<XYZ>();
        foreach (var p in pts)
        {
            var xyz = new XYZ(p[0], p[1], 0);
            if (clean.Count == 0 || clean[^1].DistanceTo(xyz) > 0.01) clean.Add(xyz);
        }
        if (clean.Count > 1 && clean[0].DistanceTo(clean[^1]) <= 0.01) clean.RemoveAt(clean.Count - 1);
        if (clean.Count < 3) throw new InvalidOperationException("degenerate loop");
        var cl = new CurveLoop();
        for (int i = 0; i < clean.Count; i++)
            cl.Append(Line.CreateBound(clean[i], clean[(i + 1) % clean.Count]));
        return cl;
    }

    private static Color Rainbow(int i, int n)
    {
        double h = i * 360.0 / Math.Max(1, n) % 360, s = 0.85, vv = 0.95;
        double c = vv * s, x = c * (1 - Math.Abs(h / 60 % 2 - 1)), m2 = vv - c;
        double r = 0, g = 0, b = 0;
        if (h < 60) { r = c; g = x; } else if (h < 120) { r = x; g = c; }
        else if (h < 180) { g = c; b = x; } else if (h < 240) { g = x; b = c; }
        else if (h < 300) { r = x; b = c; } else { r = c; b = x; }
        return new Color((byte)((r + m2) * 255), (byte)((g + m2) * 255), (byte)((b + m2) * 255));
    }
}
