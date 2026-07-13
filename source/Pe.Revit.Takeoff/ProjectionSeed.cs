using System.Windows.Media.Imaging;

namespace Pe.Revit.Takeoff;

// Room-seed layer: use Revit's renderer instead of slicing geometry ourselves.
// Chadds Ford proved why: the architect's deliverable was a framing-stage IFC — 70k DirectShapes,
// zero Wall elements — where every LocationCurve/native-room approach is dead on arrival, and
// Revit's plan renderer still draws perfect wall ink (it solves view range, cut planes, link
// display, and DirectShape sectioning for free). We export a surgically stripped plan view to PNG
// at a known crop->pixel mapping and read the ink back as an occupancy grid.
//
// The recipe (every line below was paid for in blood on Chadds, 2026-07-06):
// - FRESH top-down orthographic View3D; never mutate user views.
// - PHYSICAL one-foot section box around each cut. Plan view ranges are insufficient for IFC
//   DirectShapes: Revit projects geometry from other stories even when all four range planes are
//   correctly bound to the current level (Chadds live proof, 2026-07-10).
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

    internal static bool IsInkCategory(ElementId? id) =>
        id != null && InkCategories.Any(category => id == ((long)category).ToElementId());

    // WriteTransaction step: create the stripped seed views, cropped to `crop` (model coords).
    // Band A is cut TWICE (vertical-consistency pair, see CaptureInk). When the model carries the
    // architect's own 2D plan for this level (a flat linked DWG at the level elevation — standard
    // MEP background practice), a fourth "seed D" view isolates it: that linework is finished
    // walls, one story, near-zero noise, and beats any cut through framing. Idempotent:
    // same-named views are deleted first.
    public static (string viewA, string viewA2, string viewB, string? viewD) PrepareSeedViews(
        Document doc, Level level, BoundingBoxXYZ crop, TakeoffOptions opt, Action<string> log)
    {
        string nameA = $"{opt.Marker} seed A {level.Name}";
        string nameA2 = $"{opt.Marker} seed A2 {level.Name}";
        string nameB = $"{opt.Marker} seed B {level.Name}";
        string nameD = $"{opt.Marker} seed D {level.Name}";
        // doc.Delete(singleId) on a VIEW silently rolls back the host-owned transaction with
        // success-looking logs (dwgvec pod, 2026-07-06). Always delete views via the ICollection
        // overload.
        var stale = new FilteredElementCollector(doc).OfClass(typeof(View)).Cast<View>()
            .Where(v => v.Name == nameA || v.Name == nameA2 || v.Name == nameB || v.Name == nameD)
            .Select(v => v.Id).ToList();
        if (stale.Count > 0) doc.Delete(stale);

        MakeBandView(doc, level, crop, opt.KneeBandFt, nameA, opt);
        MakeBandView(doc, level, crop, opt.KneeBandFt - opt.BandPairSeparationFt, nameA2, opt);
        MakeBandView(doc, level, crop, opt.HeaderBandFt, nameB, opt);
        var dwg = FindLevelDwg(doc, level, crop);
        string? viewD = null;
        if (dwg != null)
        {
            MakeDwgView(doc, level, crop, dwg, nameD);
            viewD = nameD;
        }
        log($"[seed] views '{nameA}' (+{opt.KneeBandFt} ft), '{nameA2}' (+{opt.KneeBandFt - opt.BandPairSeparationFt} ft), '{nameB}' (+{opt.HeaderBandFt} ft)"
            + (dwg != null ? $", '{nameD}' (DWG '{dwg.Category?.Name}')" : " (no level DWG found)"));
        return (nameA, nameA2, nameB, viewD);
    }

    // The architect's per-level plan background: a linked, model-space DWG whose geometry is FLAT
    // and sits at the level elevation. Z + flatness + XY overlap identify it without relying on
    // file naming conventions.
    private static ImportInstance? FindLevelDwg(Document doc, Level level, BoundingBoxXYZ crop)
    {
        ImportInstance? best = null;
        double bestOverlap = 0;
        foreach (var imp in new FilteredElementCollector(doc).OfClass(typeof(ImportInstance)).Cast<ImportInstance>())
        {
            if (!imp.IsLinked || imp.ViewSpecific) continue;
            var bb = imp.get_BoundingBox(null);
            if (bb == null) continue;
            if (bb.Max.Z - bb.Min.Z > 1.0) continue;                                 // flat plan, not 3D
            if (Math.Abs(bb.Min.Z - level.ProjectElevation) > 3.0) continue;         // at this level
            double ox = Math.Min(bb.Max.X, crop.Max.X) - Math.Max(bb.Min.X, crop.Min.X);
            double oy = Math.Min(bb.Max.Y, crop.Max.Y) - Math.Max(bb.Min.Y, crop.Min.Y);
            if (ox <= 0 || oy <= 0) continue;                                        // covers the building
            double overlap = ox * oy;
            if (overlap > bestOverlap) { bestOverlap = overlap; best = imp; }
        }
        return best;
    }

    private static void MakeDwgView(
        Document doc, Level level, BoundingBoxXYZ crop, ImportInstance dwg, string name)
    {
        var vft = new FilteredElementCollector(doc).OfClass(typeof(ViewFamilyType)).Cast<ViewFamilyType>()
            .First(t => t.ViewFamily == ViewFamily.FloorPlan);
        var v = ViewPlan.Create(doc, vft.Id, level.Id);
        v.Name = name;
        try { v.ViewTemplateId = ElementId.InvalidElementId; } catch { }
        try { v.Discipline = ViewDiscipline.Coordination; } catch { }
        try { v.DetailLevel = ViewDetailLevel.Fine; } catch { }
        try { v.Scale = 96; } catch { }
        // hide everything, then bring back only the DWG's category (import categories enumerate
        // through Settings.Categories, so the blanket hide catches them too)
        foreach (Category cat in doc.Settings.Categories)
        {
            if (cat.CategoryType != CategoryType.Model && cat.CategoryType != CategoryType.Annotation) continue;
            try { if (v.CanCategoryBeHidden(cat.Id)) v.SetCategoryHidden(cat.Id, true); } catch { }
        }
        v.SetCategoryHidden(dwg.Category.Id, false);
        // boundary layers only: walls and glazing (glass lines seal window openings in the
        // envelope). Furniture, millwork, fixtures, roof plans, hatches, stairs, balconies, and
        // site linework are room-fragmenting or room-inventing noise. When the file has no
        // recognizable wall layer, keep everything and let the physics gates cope.
        var layers = dwg.Category.SubCategories.Cast<Category>().ToList();
        bool hasWallLayer = layers.Any(layer => layer.Name.IndexOf("WALL", StringComparison.OrdinalIgnoreCase) >= 0);
        if (hasWallLayer)
            foreach (var layer in layers)
            {
                bool keep = layer.Name.IndexOf("WALL", StringComparison.OrdinalIgnoreCase) >= 0
                            || layer.Name.IndexOf("GLAZ", StringComparison.OrdinalIgnoreCase) >= 0;
                try { v.SetCategoryHidden(layer.Id, !keep); } catch { }
            }
        var cb = v.CropBox;
        cb.Min = new XYZ(crop.Min.X, crop.Min.Y, cb.Min.Z);
        cb.Max = new XYZ(crop.Max.X, crop.Max.Y, cb.Max.Z);
        v.CropBox = cb;
        v.CropBoxActive = true;
        v.CropBoxVisible = false;
        doc.Regenerate();
        // other imports sharing the category-visible state (rare) get element-hidden
        var others = new FilteredElementCollector(doc, v.Id).OfClass(typeof(ImportInstance))
            .Where(e => e.Id.Value() != dwg.Id.Value()).Select(e => e.Id).ToList();
        if (others.Count > 0) v.HideElements(others);
    }

    private static void MakeBandView(
        Document doc, Level level, BoundingBoxXYZ crop, double cutFt, string name, TakeoffOptions opt)
    {
        var vft = new FilteredElementCollector(doc).OfClass(typeof(ViewFamilyType)).Cast<ViewFamilyType>()
            .First(t => t.ViewFamily == ViewFamily.ThreeDimensional);
        var v = View3D.CreateIsometric(doc, vft.Id);
        v.Name = name;
        try { v.DisplayStyle = DisplayStyle.HLR; } catch { }
        try { v.DetailLevel = ViewDetailLevel.Medium; } catch { }
        try { v.Scale = 96; } catch { }
        double z = level.ProjectElevation + cutFt;
        double cx = (crop.Min.X + crop.Max.X) / 2, cy = (crop.Min.Y + crop.Max.Y) / 2;
        v.SetOrientation(new ViewOrientation3D(new XYZ(cx, cy, z + 200), XYZ.BasisY, -XYZ.BasisZ));

        var slab = new BoundingBoxXYZ {
            Min = new XYZ(crop.Min.X, crop.Min.Y, z - 0.5),
            Max = new XYZ(crop.Max.X, crop.Max.Y, z + 0.5),
        };
        v.SetSectionBox(slab);

        // View3D.CropBox is view-local. Preserve its transform and project the model crop into it;
        // assigning model XY directly produces a correctly-sized but blank export.
        var viewCrop = v.CropBox;
        var toView = viewCrop.Transform.Inverse;
        var corners = from x in new[] { slab.Min.X, slab.Max.X }
                      from y in new[] { slab.Min.Y, slab.Max.Y }
                      from zz in new[] { slab.Min.Z, slab.Max.Z }
                      select toView.OfPoint(new XYZ(x, y, zz));
        viewCrop.Min = new XYZ(corners.Min(p => p.X), corners.Min(p => p.Y), corners.Min(p => p.Z));
        viewCrop.Max = new XYZ(corners.Max(p => p.X), corners.Max(p => p.Y), corners.Max(p => p.Z));
        v.CropBox = viewCrop;
        v.CropBoxActive = true;
        v.CropBoxVisible = false;

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

    // ReadOnly step: export the band views and compose the ink grid:
    //
    //   knee  = A1 AND A2      vertical-consistency: walls extrude vertically, so they draw the
    //                          same footprint at both knee cuts; rafters/joists/battens/gutters/
    //                          stair flights/raked railings/flat labels shift or vanish
    //   ink   = knee OR (B AND near(knee | floorEdge, HeaderNearFt))
    //                          header ink seals door openings, but only counts within reach of
    //                          knee ink or the floor-slab edge — a "wall" in the header cut far
    //                          from both is a mid-room roof plane or high framing, not a room
    //                          boundary. The slab edge matters for eave walls under a roof slope:
    //                          their only header-band evidence IS the roof plane, and the building
    //                          envelope always coincides with the slab edge (Chadds NE bedrooms).
    //
    // kneeBandInk = the AND'd knee band. Band B cannot distinguish a wall from a sealed opening;
    // the knee band can — doors are open at +4 ft. Boundary-evidence needs that distinction.
    // Pixel->model mapping is exact: the export fills the crop box edge-to-edge (verified 0.02%
    // aspect agreement at 6000 px on Chadds); ftPerPx = cropWidth / pixelWidth.
    public static bool[] CaptureInk(
        Document doc, string viewA, string viewA2, string viewB, string? viewD, BoundingBoxXYZ crop,
        int gridW, int gridH, double cellFt, string workDir, TakeoffOptions opt, Action<string> log,
        bool[]? floorEdge, out bool[] kneeBandInk)
    {
        int n = gridW * gridH;
        bool[] knee;
        if (viewD != null)
        {
            // the architect's own plan linework: finished walls, one story — no vertical-
            // consistency AND needed, and the framing bands' knee cuts add only noise beside it
            knee = ExportAndStamp(doc, viewD, crop, gridW, gridH, cellFt, workDir, opt, log);
        }
        else
        {
            var a1 = ExportAndStamp(doc, viewA, crop, gridW, gridH, cellFt, workDir, opt, log);
            var a2 = ExportAndStamp(doc, viewA2, crop, gridW, gridH, cellFt, workDir, opt, log);
            knee = new bool[n];
            for (int i = 0; i < n; i++) knee[i] = a1[i] && a2[i];
        }
        var b = ExportAndStamp(doc, viewB, crop, gridW, gridH, cellFt, workDir, opt, log);
        var anchor = knee;
        if (floorEdge != null)
        {
            anchor = (bool[])knee.Clone();
            for (int i = 0; i < n; i++) anchor[i] |= floorEdge[i];
        }
        var near = Dilate(anchor, gridW, gridH, Math.Max(1, (int)Math.Round(opt.HeaderNearFt / cellFt)));
        var ink = new bool[n];
        int bTotal = 0, bGatedOut = 0;
        for (int i = 0; i < n; i++)
        {
            if (b[i]) bTotal++;
            if (b[i] && !near[i]) bGatedOut++;
            ink[i] = knee[i] || b[i] && near[i];
        }
        kneeBandInk = knee;
        log($"[seed] ink cells: {(viewD != null ? "dwg" : "knee(AND)")}={Count(knee)} " +
            $"b={bTotal} bGatedOut={bGatedOut} final={Count(ink)}");
        return ink;
    }

    private static int Count(bool[] mask) => mask.Count(v => v);

    // separable box dilation by r cells
    private static bool[] Dilate(bool[] mask, int w, int h, int r)
    {
        var pass = new bool[w * h];
        for (int y = 0; y < h; y++)
        {
            int run = -1;
            for (int x = 0; x < w; x++) { if (mask[y * w + x]) run = r; pass[y * w + x] = run >= 0; if (run >= 0) run--; }
            run = -1;
            for (int x = w - 1; x >= 0; x--) { if (mask[y * w + x]) run = r; if (run >= 0) { pass[y * w + x] = true; run--; } }
        }
        var outMask = new bool[w * h];
        for (int x = 0; x < w; x++)
        {
            int run = -1;
            for (int y = 0; y < h; y++) { if (pass[y * w + x]) run = r; outMask[y * w + x] = run >= 0; if (run >= 0) run--; }
            run = -1;
            for (int y = h - 1; y >= 0; y--) { if (pass[y * w + x]) run = r; if (run >= 0) { outMask[y * w + x] = true; run--; } }
        }
        return outMask;
    }

    private static bool[] ExportAndStamp(
        Document doc, string name, BoundingBoxXYZ crop, int gridW, int gridH, double cellFt,
        string workDir, TakeoffOptions opt, Action<string> log)
    {
        var v = new FilteredElementCollector(doc).OfClass(typeof(View)).Cast<View>()
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
        doc.ExportImage(eo); // Revit appends " - <view type> - <name>.png"
        var file = Directory.GetFiles(workDir, Path.GetFileName(basePath) + "*")
            .OrderByDescending(File.GetLastWriteTimeUtc).First();
        var ink = new bool[gridW * gridH];
        StampPng(file, ink, crop, gridW, gridH, cellFt);
        log($"[seed] captured {Path.GetFileName(file)}");
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
