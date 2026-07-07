using System.Windows.Media.Imaging;

namespace Pe.Revit.Takeoff;

// Room-seed layer: steal Revit's own 2D projection instead of slicing geometry ourselves.
// Chadds Ford proved why: the architect's deliverable was a framing-stage IFC — 70k DirectShapes,
// zero Wall elements — where every LocationCurve/native-room approach is dead on arrival, and
// Revit's plan renderer still draws perfect wall ink (it solves view range, cut planes, link
// display, and DirectShape sectioning for free). We export a surgically stripped plan view to PNG
// at a known crop->pixel mapping and read the ink back as an occupancy grid.
//
// The recipe (every line below was paid for in blood on Chadds, 2026-07-06):
// - FRESH ViewPlan; never mutate user views (their templates/crops fight everything).
// - THIN-SLAB view range (top = cut + 0.5, bottom = cut - 0.5): keeps below-cut projection noise
//   (low roofs, floor framing, decks) out of the ink, and cut a 12-min export to ~1 min.
// - TWO bands OR'd downstream: KneeBand (~4 ft) catches knee walls and under-window studs;
//   HeaderBand (~8.5 ft, ABOVE door/window heads) is the door-sealer — Revit draws headers
//   continuous through openings, which morphological closing provably cannot do for collinear
//   gaps. Cut height is a per-model knob: this estate ran 10 ft ceilings / 8 ft heads.
// - Hide EVERYTHING except the wall-ink categories, but OST_RvtLinks itself MUST stay visible —
//   hiding it blanks the entire linked IFC (first vgprint export was an empty page).
// - Host-view category visibility/overrides flow into IFC links directly; no per-link
//   RevitLinkGraphicsSettings needed.
// - NO surface patterns (solid surface fill let projected roof planes flood the dormer wing);
//   cut+projection lines black, heavy-ish weight so 1-cell walls survive the grid downsample.
// - Open-to-sky spaces (courtyards, terraces) look enclosed in plan ink — both 2D pods
//   false-positived the courtyard. The Heightfield ceiling test is the corrective; never ship
//   projection-seed detection without it.
public static class ProjectionSeed
{
    private static readonly BuiltInCategory[] InkCategories = {
        BuiltInCategory.OST_Walls, BuiltInCategory.OST_Columns, BuiltInCategory.OST_StructuralColumns,
        BuiltInCategory.OST_StructuralFraming, BuiltInCategory.OST_GenericModel,
        BuiltInCategory.OST_CurtainWallPanels, BuiltInCategory.OST_CurtainWallMullions,
    };

    // WriteTransaction step: create the two stripped band views, cropped to `crop` (model coords).
    // Returns view names. Idempotent: same-named views are deleted first.
    public static (string viewA, string viewB) PrepareSeedViews(
        Document doc, Level level, BoundingBoxXYZ crop, TakeoffOptions opt, Action<string> log)
    {
        string nameA = $"{opt.Marker} seed A {level.Name}";
        string nameB = $"{opt.Marker} seed B {level.Name}";
        // doc.Delete(singleId) on a VIEW silently rolls back the host-owned transaction with
        // success-looking logs (dwgvec pod, 2026-07-06). Always delete views via the ICollection
        // overload.
        var stale = new FilteredElementCollector(doc).OfClass(typeof(ViewPlan)).Cast<ViewPlan>()
            .Where(v => v.Name == nameA || v.Name == nameB).Select(v => v.Id).ToList();
        if (stale.Count > 0) doc.Delete(stale);

        MakeBandView(doc, level, crop, opt.KneeBandFt, nameA, opt);
        MakeBandView(doc, level, crop, opt.HeaderBandFt, nameB, opt);
        log($"[seed] views '{nameA}' (cut +{opt.KneeBandFt} ft) and '{nameB}' (cut +{opt.HeaderBandFt} ft)");
        return (nameA, nameB);
    }

    private static void MakeBandView(
        Document doc, Level level, BoundingBoxXYZ crop, double cutFt, string name, TakeoffOptions opt)
    {
        var vft = new FilteredElementCollector(doc).OfClass(typeof(ViewFamilyType)).Cast<ViewFamilyType>()
            .First(t => t.ViewFamily == ViewFamily.FloorPlan);
        var v = ViewPlan.Create(doc, vft.Id, level.Id);
        v.Name = name;
        // The default ViewFamilyType often carries a view TEMPLATE, which locks DetailLevel/Scale
        // ("Detail Level cannot be modified", Chadds). Detach it before any view-property writes.
        try { v.ViewTemplateId = ElementId.InvalidElementId; } catch { }
        try { v.Discipline = ViewDiscipline.Coordination; } catch { /* discipline param can be locked */ }
        try { v.DetailLevel = ViewDetailLevel.Medium; } catch { }
        try { v.Scale = 96; } catch { }
        v.CropBox = crop;
        v.CropBoxActive = true;
        v.CropBoxVisible = false;

        var vr = v.GetViewRange();
        vr.SetOffset(PlanViewPlane.TopClipPlane, cutFt + 0.5);
        vr.SetOffset(PlanViewPlane.CutPlane, cutFt);
        vr.SetOffset(PlanViewPlane.BottomClipPlane, cutFt - 0.5);
        vr.SetOffset(PlanViewPlane.ViewDepthPlane, cutFt - 0.5);
        v.SetViewRange(vr);

        var keep = new HashSet<ElementId>(InkCategories.Select(c => ((long)c).ToElementId()));
        keep.Add(((long)BuiltInCategory.OST_RvtLinks).ToElementId()); // hiding the link category blanks the IFC
        foreach (Category cat in doc.Settings.Categories)
        {
            if (cat.CategoryType != CategoryType.Model && cat.CategoryType != CategoryType.Annotation) continue;
            try { if (!keep.Contains(cat.Id) && v.CanCategoryBeHidden(cat.Id)) v.SetCategoryHidden(cat.Id, true); }
            catch { /* some categories reject visibility calls per view type */ }
        }

        var black = new Color(0, 0, 0);
        var ogs = new OverrideGraphicSettings()
            .SetProjectionLineColor(black).SetProjectionLineWeight(5)
            .SetCutLineColor(black).SetCutLineWeight(7);
        foreach (var bic in InkCategories)
        {
            try { v.SetCategoryOverrides(((long)bic).ToElementId(), ogs); } catch { }
        }
    }

    // ReadOnly step: export both band views to PNG and read the ink back as one OR'd grid.
    // Pixel->model mapping is exact: the export fills the crop box edge-to-edge (verified 0.02%
    // aspect agreement at 6000 px on Chadds); ftPerPx = cropWidth / pixelWidth.
    public static bool[] CaptureInk(
        Document doc, string viewA, string viewB, BoundingBoxXYZ crop,
        int gridW, int gridH, double cellFt, string workDir, TakeoffOptions opt, Action<string> log)
    {
        var ink = new bool[gridW * gridH];
        foreach (var name in new[] { viewA, viewB })
        {
            var v = new FilteredElementCollector(doc).OfClass(typeof(ViewPlan)).Cast<ViewPlan>()
                .FirstOrDefault(x => x.Name == name) ?? throw new InvalidOperationException($"seed view '{name}' missing — run PrepareSeedViews first");
            string basePath = Path.Combine(workDir, "seed_" + v.Id);
            var eo = new ImageExportOptions {
                ExportRange = ExportRange.SetOfViews,
                FilePath = basePath,
                HLRandWFViewsFileType = ImageFileType.PNG,
                ShadowViewsFileType = ImageFileType.PNG,
                ImageResolution = ImageResolution.DPI_150,
                PixelSize = opt.SeedPixelSize,
                FitDirection = FitDirectionType.Horizontal,
                ZoomType = ZoomFitType.FitToPage,
            };
            eo.SetViewsAndSheets(new List<ElementId> { v.Id });
            doc.ExportImage(eo); // Revit appends " - Floor Plan - <name>.png"
            var file = Directory.GetFiles(workDir, Path.GetFileName(basePath) + "*")
                .OrderByDescending(File.GetLastWriteTimeUtc).First();
            StampPng(file, ink, crop, gridW, gridH, cellFt);
            log($"[seed] captured {Path.GetFileName(file)}");
        }
        return ink;
    }

    // PNG -> grid. PresentationCore decoder (Revit is WPF-hosted; zero extra deps). A grid cell
    // is ink if ANY dark pixel maps into it — walls must never thin out below one cell.
    private static void StampPng(string path, bool[] ink, BoundingBoxXYZ crop, int gridW, int gridH, double cellFt)
    {
        BitmapFrame frame;
        using (var fs = new FileStream(path, FileMode.Open, FileAccess.Read, FileShare.Read))
            frame = BitmapFrame.Create(fs, BitmapCreateOptions.None, BitmapCacheOption.OnLoad);
        var bmp = new FormatConvertedBitmap(frame, System.Windows.Media.PixelFormats.Gray8, null, 0);
        int pw = bmp.PixelWidth, ph = bmp.PixelHeight;
        var px = new byte[pw * ph];
        bmp.CopyPixels(px, pw, 0);

        double cropW = crop.Max.X - crop.Min.X, cropH = crop.Max.Y - crop.Min.Y;
        for (int y = 0; y < ph; y++)
        {
            for (int x = 0; x < pw; x++)
            {
                if (px[y * pw + x] > 128) continue; // ink = dark
                // pixel row 0 is the TOP of the crop (max Y in model coords)
                double mx = crop.Min.X + (x + 0.5) / pw * cropW;
                double my = crop.Max.Y - (y + 0.5) / ph * cropH;
                int gx = (int)((mx - crop.Min.X) / cellFt), gy = (int)((my - crop.Min.Y) / cellFt);
                if (gx >= 0 && gy >= 0 && gx < gridW && gy < gridH) ink[gy * gridW + gx] = true;
            }
        }
    }
}
