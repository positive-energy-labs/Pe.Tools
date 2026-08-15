using System.Windows.Media.Imaging;

namespace Pe.Revit.Takeoff;

// Room-seed layer: use Revit's plan renderer instead of slicing geometry ourselves. On a
// framing-stage IFC (many DirectShapes, zero Wall elements) LocationCurve/native-room approaches
// are dead on arrival, but the renderer still draws correct wall ink. We export a surgically
// stripped view to PNG at a known crop->pixel mapping and read the ink back as an occupancy grid.
//
// Constraints:
// - FRESH top-down orthographic View3D; never mutate user views.
// - PHYSICAL one-foot section box around each cut: plan view ranges are insufficient for IFC
//   DirectShapes (Revit projects geometry from other stories even with all range planes bound).
// - TWO bands OR'd downstream: KneeBand (~4 ft) catches knee walls / under-window studs; HeaderBand
//   (~8.5 ft, ABOVE door/window heads) seals doorways — headers draw continuous through openings,
//   which morphological closing cannot reproduce for collinear gaps. Cut height is a per-model knob.
// - Hide EVERYTHING except wall-ink categories, but OST_RvtLinks itself MUST stay visible — hiding
//   it blanks the entire linked IFC. Host-view visibility/overrides flow into IFC links directly.
// - NO surface patterns (solid fill lets projected roof planes flood the plan); cut+projection
//   lines black, heavy weight so 1-cell walls survive the grid downsample.
// - Open-to-sky spaces (courtyards, terraces) look enclosed in plan ink; the Heightfield ceiling
//   test is the corrective — never ship projection-seed detection without it.
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
    // Band A is cut TWICE (vertical-consistency pair, see CaptureBands). Framing is captured in its
    // own knee/low pair (seed F / F0): the knee AND kills sloped members whose footprint shifts, but
    // is blind to HORIZONTAL members riding through both knee cuts (joists, blocking, collar ties) —
    // those are vetoed raster-side because they have no footprint near the floor, where every
    // wall-former does. Element-hiding cannot do this: the framing lives in linked documents.
    // When the model carries a flat linked DWG plan at the level elevation, a "seed D" view isolates
    // it — finished walls, one story, beats any cut through framing. Idempotent: same-named views
    // deleted first.
    public static (string viewA, string viewA2, string viewB, string viewBF, string viewF, string viewF0, string? viewD) PrepareSeedViews(
        Document doc, Level level, BoundingBoxXYZ crop, TakeoffOptions opt, Action<string> log)
    {
        string nameA = $"{opt.Marker} seed A {level.Name}";
        string nameA2 = $"{opt.Marker} seed A2 {level.Name}";
        string nameB = $"{opt.Marker} seed B {level.Name}";
        string nameBF = $"{opt.Marker} seed BF {level.Name}";
        string nameF = $"{opt.Marker} seed F {level.Name}";
        string nameF0 = $"{opt.Marker} seed F0 {level.Name}";
        string nameD = $"{opt.Marker} seed D {level.Name}";
        // doc.Delete(singleId) on a VIEW silently rolls back the host-owned transaction with
        // success-looking logs. Always delete views via the ICollection overload.
        var names = new HashSet<string> { nameA, nameA2, nameB, nameBF, nameF, nameF0, nameD };
        var stale = new FilteredElementCollector(doc).OfClass(typeof(View)).Cast<View>()
            .Where(v => names.Contains(v.Name))
            .Select(v => v.Id).ToList();
        if (stale.Count > 0) doc.Delete(stale);

        // OST_GenericModel is a fallback wall source, not a peer: on an IFC where walls arrive as
        // DirectShapes it is the only ink there is, but wherever recognized wall categories are
        // plentiful it contributes equipment proxies, piers, and duct bodies — pure noise (projectA,
        // measured: 'Undefined' IFC generic models drew the LL06/LL08 blob clusters). So it is
        // admitted only when the band would otherwise be starved of walls.
        bool genericModelInk = CountRecognizedWallElements(doc, level, crop) < 50;
        log($"[seed] genericModelInk={genericModelInk} (recognized wall elements "
            + $"{(genericModelInk ? "<" : ">=")} 50 in band)");
        // Framing (and GenericModel, when admitted as fallback wall ink — an IFC's studs and
        // sheathing land there) is the only ink source that mixes wall-formers with horizontal
        // structure, so it alone gets the low-support veto; every other category cuts clean.
        var framingCats = genericModelInk
            ? new[] { BuiltInCategory.OST_StructuralFraming, BuiltInCategory.OST_GenericModel }
            : new[] { BuiltInCategory.OST_StructuralFraming };
        var steadyCats = InkCategories.Except(new[] {
            BuiltInCategory.OST_StructuralFraming, BuiltInCategory.OST_GenericModel }).ToArray();
        var allInk = steadyCats.Concat(framingCats).ToArray();
        var dwg = FindLevelDwg(doc, level, crop);
        if (dwg == null)
        {
            MakeBandView(doc, level, crop, opt.KneeBandFt, nameA, opt, steadyCats);
            MakeBandView(doc, level, crop, opt.KneeBandFt - opt.BandPairSeparationFt, nameA2, opt, allInk);
            MakeBandView(doc, level, crop, opt.KneeBandFt, nameF, opt, framingCats);
        }
        MakeBandView(doc, level, crop, opt.HeaderBandFt, nameB, opt, steadyCats);
        MakeBandView(doc, level, crop, opt.HeaderBandFt, nameBF, opt, framingCats);
        MakeBandView(doc, level, crop, opt.FramingLowBandFt, nameF0, opt, framingCats);
        string? viewD = null;
        if (dwg != null)
        {
            MakeDwgView(doc, level, crop, dwg, nameD);
            viewD = nameD;
        }
        log(dwg != null
            ? $"[seed] views '{nameD}' (DWG '{dwg.Category?.Name}'), '{nameB}', '{nameBF}', '{nameF0}'"
            : $"[seed] views '{nameA}', '{nameA2}', '{nameB}', '{nameBF}', '{nameF}', '{nameF0}' (no level DWG found)");
        return (nameA, nameA2, nameB, nameBF, nameF, nameF0, viewD);
    }

    // The per-level plan background: a linked model-space DWG that is FLAT and sits at the level
    // elevation. Z + flatness + XY overlap identify it without relying on file naming.
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
        // boundary layers only: walls + glazing (glass lines seal window openings). Other layers are
        // room-fragmenting/inventing noise. No recognizable wall layer = keep everything, let physics cope.
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

    /// <summary>
    /// Count of elements in recognized wall categories (walls, columns, framing, curtain) whose box
    /// crosses the knee band inside the crop, across the host document and every loaded link. This
    /// is what decides whether OST_GenericModel is needed as fallback wall ink.
    /// </summary>
    private static int CountRecognizedWallElements(Document doc, Level level, BoundingBoxXYZ crop)
    {
        double z0 = level.ProjectElevation + 1.0, z1 = level.ProjectElevation + 9.0;
        var wallCategories = new HashSet<long> {
            (long)BuiltInCategory.OST_Walls, (long)BuiltInCategory.OST_Columns,
            (long)BuiltInCategory.OST_StructuralColumns, (long)BuiltInCategory.OST_StructuralFraming,
            (long)BuiltInCategory.OST_CurtainWallPanels,
        };
        int count = 0;
        void Tally(Document d, Transform tf)
        {
            foreach (Element el in new FilteredElementCollector(d).WhereElementIsNotElementType())
            {
                if (el.Category == null || !wallCategories.Contains(el.Category.Id.Value())) continue;
                var bb = el.get_BoundingBox(null);
                if (bb == null) continue;
                var lo = tf.OfPoint(bb.Min);
                var hi = tf.OfPoint(bb.Max);
                if (Math.Max(lo.X, hi.X) < crop.Min.X || Math.Min(lo.X, hi.X) > crop.Max.X) continue;
                if (Math.Max(lo.Y, hi.Y) < crop.Min.Y || Math.Min(lo.Y, hi.Y) > crop.Max.Y) continue;
                if (Math.Max(lo.Z, hi.Z) < z0 || Math.Min(lo.Z, hi.Z) > z1) continue;
                count++;
            }
        }
        Tally(doc, Transform.Identity);
        foreach (var link in new FilteredElementCollector(doc)
                     .OfClass(typeof(RevitLinkInstance)).Cast<RevitLinkInstance>())
        {
            var linkDoc = link.GetLinkDocument();
            if (linkDoc != null) Tally(linkDoc, link.GetTotalTransform());
        }
        return count;
    }

    private static void MakeBandView(
        Document doc, Level level, BoundingBoxXYZ crop, double cutFt, string name, TakeoffOptions opt,
        BuiltInCategory[] categories)
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

        var keep = new HashSet<ElementId>(categories.Select(c => ((long)c).ToElementId()));
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
        foreach (var bic in categories)
        {
            try { v.SetCategoryOverrides(((long)bic).ToElementId(), ogs); } catch { }
        }
    }

    // ReadOnly step: export the band views and compose the ink grid:
    //   knee = (A1 OR (F AND near(F0, FramingLowSupportNearFt))) AND A2
    //     A1 is steady categories (walls, columns, curtain) — they cut clean at any height.
    //     F is framing at the knee cut; it only counts near the low-cut framing footprint F0,
    //     because a wall-former (stud) runs down to its plate while joists, blocking, and collar
    //     ties riding at knee height have nothing below (project-a attic: 4,200 of 6,145 band framing
    //     members were horizontal structure, drawn as phantom wall ink before this veto).
    //     The A2 AND still kills SLOPED members: their footprint shifts between the knee cuts.
    //   ink  = knee OR (B AND near(knee | floorEdge, HeaderNearFt)) — header ink seals door openings
    //                       but only counts within reach of knee ink or the slab edge; a "wall" in
    //                       the header cut far from both is a mid-room roof plane, not a boundary.
    //                       Slab edge matters for eave walls whose only header evidence is the roof.
    //   header = B OR (BF AND near(F0)) — same low-support veto as the knee, because the header cut
    //                       runs straight through roof structure (the attic B export is a forest of
    //                       rafter ladders, all within HeaderNearFt of the wing's walls). Door
    //                       headers keep their ink: jack studs and under-sill cripples run to the
    //                       floor, so real openings always have low-cut framing within reach.
    // Band B cannot distinguish a wall from a sealed opening; the knee band can (doors open at +4 ft).
    // Pixel->model mapping is exact: the export fills the crop box edge-to-edge; ftPerPx = cropW/pixelW.
    internal static (bool[] Plan, bool[] Header) CaptureBands(
        Document doc, string viewA, string viewA2, string viewB, string viewBF, string viewF, string viewF0,
        string? viewD, BoundingBoxXYZ crop,
        int gridW, int gridH, double cellFt, string workDir, TakeoffOptions opt, Action<string> log)
    {
        int n = gridW * gridH;
        var f0 = ExportAndStamp(doc, viewF0, crop, gridW, gridH, cellFt, workDir, opt, log);
        var support = Dilate(f0, gridW, gridH,
            Math.Max(1, (int)Math.Round(opt.FramingLowSupportNearFt / cellFt)));
        bool[] knee;
        if (viewD != null)
        {
            // DWG plan linework: finished walls, one story — no vertical-consistency AND needed
            knee = ExportAndStamp(doc, viewD, crop, gridW, gridH, cellFt, workDir, opt, log);
        }
        else
        {
            var a1 = ExportAndStamp(doc, viewA, crop, gridW, gridH, cellFt, workDir, opt, log);
            var a2 = ExportAndStamp(doc, viewA2, crop, gridW, gridH, cellFt, workDir, opt, log);
            var f1 = ExportAndStamp(doc, viewF, crop, gridW, gridH, cellFt, workDir, opt, log);
            knee = new bool[n];
            int vetoed = 0;
            for (int i = 0; i < n; i++)
            {
                if (f1[i] && !support[i] && !a1[i] && a2[i]) vetoed++;
                knee[i] = (a1[i] || f1[i] && support[i]) && a2[i];
            }
            log($"[seed] framing low-support veto dropped {vetoed} knee cells");
        }
        var b = ExportAndStamp(doc, viewB, crop, gridW, gridH, cellFt, workDir, opt, log);
        var bf = ExportAndStamp(doc, viewBF, crop, gridW, gridH, cellFt, workDir, opt, log);
        int headerVetoed = 0;
        for (int i = 0; i < n; i++)
        {
            if (bf[i] && !support[i] && !b[i]) headerVetoed++;
            b[i] = b[i] || bf[i] && support[i];
        }
        log($"[seed] framing low-support veto dropped {headerVetoed} header cells");
        return (knee, b);
    }

    internal static bool[] ComposeInk(
        bool[] plan, bool[] header, int gridW, int gridH, double cellFt,
        TakeoffOptions opt, bool[]? floorEdge, Action<string>? log = null)
    {
        int n = gridW * gridH;
        if (plan.Length != n || header.Length != n || floorEdge != null && floorEdge.Length != n)
            throw new ArgumentException($"seed arrays disagree with {gridW}x{gridH}");
        var anchor = plan;
        if (floorEdge != null)
        {
            anchor = (bool[])plan.Clone();
            for (int i = 0; i < n; i++) anchor[i] |= floorEdge[i];
        }
        var near = Dilate(anchor, gridW, gridH, Math.Max(1, (int)Math.Round(opt.HeaderNearFt / cellFt)));
        var ink = new bool[n];
        int bTotal = 0, bGatedOut = 0;
        for (int i = 0; i < n; i++)
        {
            if (header[i]) bTotal++;
            if (header[i] && !near[i]) bGatedOut++;
            ink[i] = plan[i] || header[i] && near[i];
        }
        log?.Invoke($"[seed] plan={Count(plan)} header={bTotal} " +
                    $"headerGatedOut={bGatedOut} final={Count(ink)}");
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
