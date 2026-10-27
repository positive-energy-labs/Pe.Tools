// What reading this model would cost, measured before any product read is designed around it (MINED M2, M3, M6, M7, M15).
// NoTransaction on purpose: the ReadOnly rollback guard opens a transaction group whose allocation lands in the very
// private-bytes deltas this census measures, and it refuses read-only documents. The boundary that still holds: this
// script starts no transaction and stops if IsModified changes. Every row says measured, sampled or projected.
public sealed class ReadCostCensus : PeScriptContainer
{
    private static readonly BuiltInCategory[] CenterLines = Enum.GetValues(typeof(BuiltInCategory)).Cast<BuiltInCategory>()
        .Where(b => b.ToString().EndsWith("CenterLine", StringComparison.Ordinal)).Distinct().ToArray();
    private static readonly BuiltInCategory[] InsulationLining =
        { BuiltInCategory.OST_DuctInsulations, BuiltInCategory.OST_PipeInsulations, BuiltInCategory.OST_DuctLinings };
    private static readonly Options Medium = new Options { DetailLevel = ViewDetailLevel.Medium, ComputeReferences = false };

    private readonly List<object> sections = new List<object>();
    private readonly List<string> headlines = new List<string>();
    private readonly List<string> diagnostics = new List<string>();
    private ProfilerBudget budget;
    private bool modifiedBefore;

    public override void Execute()
    {
        if (doc == null) { Result(new { refused = "No active document." }); return; }
        if (doc.IsModifiable) throw new ArgumentException("Runs outside any transaction; request NoTransaction.");
        if (ProfilerSettings.CensusFirstTouchSample < 1 || ProfilerSettings.CensusFirstTouchSample > 20000 ||
            ProfilerSettings.CensusChunk < 1 || ProfilerSettings.CensusCategoryWalk < 1 || ProfilerSettings.CensusCategoryWalk > 20000 || ProfilerSettings.CensusOrientationSample < 1 || ProfilerSettings.CensusOrientationSample > 20000 ||
            ProfilerSettings.CensusObbSample < 0 || ProfilerSettings.CensusObbSample > 1000 ||
            ProfilerSettings.CensusFidelitySample < 1 || ProfilerSettings.CensusFidelitySample > 20000 ||
            ProfilerSettings.CensusBudgetSeconds < 10 || ProfilerSettings.CensusBudgetSeconds > 1800)
            throw new ArgumentException("Bounds: samples and category walk 1..20000 (OBB 0..1000), chunk >= 1, 10..1800 seconds.");
        budget = new ProfilerBudget(ct, ProfilerSettings.CensusBudgetSeconds);
        modifiedBefore = doc.IsModified;
        // Baseline after compile: the Pod compile and load happened before Execute, so deltas exclude it.
        var memoryBefore = Profiler.Memory();
        var stamp = Stamp();
        var partitions = Partitions();
        var status = "completed";
        try {
            Section("links", () => Links(partitions));
            Section("first-touch", () => partitions.Select(FirstTouch).ToArray());
            Section("context-candidates", () => partitions.Select(ContextCandidates).ToArray());
            Section("orientation", () => partitions.Select(Orientation).ToArray());
            Section("extents", () => partitions.Select(Extents).ToArray());
            Section("revit-holds", () => Holds(partitions[0]));
            Section("fidelity", Fidelity);
            Section("cache-freshness", () => partitions.Select(Freshness).ToArray());
        } catch (TimeoutException e) { status = "budget-exhausted"; diagnostics.Add(e.Message); }
        catch (System.OperationCanceledException e) { status = "cancelled"; diagnostics.Add(e.Message); }
        var evidence = new {
            schemaVersion = 1, status, stamp, seconds = budget.Elapsed,
            settings = new { ProfilerSettings.CensusBudgetSeconds, ProfilerSettings.CensusFirstTouchSample, ProfilerSettings.CensusChunk, ProfilerSettings.CensusCategoryWalk,
                ProfilerSettings.CensusOrientationSample, ProfilerSettings.CensusObbSample, ProfilerSettings.CensusFidelitySample, ProfilerSettings.CensusSeed },
            sections, diagnostics, memoryBefore, memoryAfter = Profiler.Memory(),
            isModifiedBefore = modifiedBefore, isModifiedAfter = doc.IsModified, limits = Limits
        };
        var artifact = Artifacts.WriteJson("read-cost-census.json", evidence);
        var summary = string.Join("\n", new[] { "Read cost census: " + status + " in " + budget.Elapsed.ToString("0.0") + " s. See read-cost-census.json." }
            .Concat(headlines).Concat(Limits.Take(3)));
        var text = Artifacts.WriteText("read-cost-census.txt", summary);
        WriteLine(summary);
        Result(new { status, artifact = artifact.FullPath, summary = text.FullPath, diagnostics });
    }

    private void Section(string name, Func<object> body)
    {
        budget.Check();
        var before = PrivateBytes(); var managed = GC.GetTotalMemory(false); var clock = Stopwatch.StartNew();
        object result = null; string error = null;
        try { result = body(); }
        catch (Exception e) when (!(e is TimeoutException || e is System.OperationCanceledException)) { error = e.GetType().Name + ": " + e.Message; }
        finally {
            var seconds = clock.Elapsed.TotalSeconds; var delta = PrivateBytes() - before;
            sections.Add(new { name, basis = "measured", seconds, privateBytesDelta = delta,
                managedBytesDelta = GC.GetTotalMemory(false) - managed, error, result });
            headlines.Add(name + ": " + seconds.ToString("0.0") + " s, " + Mib(delta) + " private" + (error == null ? "" : ", error " + error));
            Artifacts.WriteJson("read-cost-census.checkpoint.json", new { phase = name, sections });
        }
        if (doc.IsModified != modifiedBefore) throw new InvalidOperationException("Section " + name + " changed IsModified; stop and inspect the document.");
    }

    private object Stamp()
    {
        using (var p = Process.GetCurrentProcess()) {
            var version = Document.GetDocumentVersion(doc);
            return new {
                custodyHint = "Not observable in-process. Name it from `pe-revit session list` for processId " + p.Id + ": controlled or observed.",
                processId = p.Id, processStartUtc = p.StartTime.ToUniversalTime().ToString("o"),
                processUptimeSeconds = (DateTime.Now - p.StartTime).TotalSeconds,
                revitVersion = doc.Application.VersionNumber, revitBuild = doc.Application.VersionBuild,
                document = new { doc.Title, doc.PathName, versionGuid = version?.VersionGUID.ToString(), numberOfSaves = version?.NumberOfSaves,
                    location = doc.IsModelInCloud ? "cloud" : "local", doc.IsWorkshared, doc.IsReadOnly, isModified = doc.IsModified },
                coldWarm = "Not a cold read: the model is open and anything earlier in this process touched stays warm. First touch is measured once per element per process; a second run reads warm.",
                compileConfound = "Baseline private bytes was read after the Pod compiled and loaded. Deltas exclude compile; absolute process totals include it (about 0.5 GB on Chadds, 2026-10-27).",
                sectionOrder = "Sections run in order and later sections reuse elements earlier ones expanded; read each delta as cost given the sections before it."
            };
        }
    }

    private List<CensusPartition> Partitions()
    {
        var parts = new List<CensusPartition> { new CensusPartition { Key = "host", Doc = doc } };
        using (var c = new FilteredElementCollector(doc).OfClass(typeof(RevitLinkInstance)))
        foreach (RevitLinkInstance li in c) {
            var ld = li.GetLinkDocument();
            if (ld == null) continue;
            var p = parts.FirstOrDefault(x => x.Doc.Equals(ld));
            if (p == null) parts.Add(p = new CensusPartition { Key = "link:" + ld.Title, Doc = ld });
            p.LinkInstanceIds.Add(li.Id.Value);
        }
        return parts;
    }

    // M2: link state plus per-category counts from quick-filter ids. No GetElement on members.
    private object Links(List<CensusPartition> partitions)
    {
        var rows = new List<object>();
        using (var c = new FilteredElementCollector(doc).OfClass(typeof(RevitLinkInstance)))
        foreach (RevitLinkInstance li in c) {
            budget.Check();
            var type = doc.GetElement(li.GetTypeId()) as RevitLinkType;
            var ld = li.GetLinkDocument();
            rows.Add(new { basis = "measured", instanceId = li.Id.Value, li.Name, typeId = type?.Id.Value,
                loaded = type != null && RevitLinkType.IsLoaded(doc, type.Id), nested = type?.IsNestedLink,
                status = Try(() => type?.GetLinkedFileStatus().ToString()),
                location = ld != null ? (ld.IsModelInCloud ? "cloud" : "local") : Try(() => PathKind(type)),
                yawDegrees = Math.Round(Yaw(li.GetTotalTransform().BasisX), 3),
                partition = partitions.FirstOrDefault(p => p.LinkInstanceIds.Contains(li.Id.Value))?.Key });
        }
        var counts = partitions.Select(p => {
            var cats = Categories(p);
            headlines.Add(p.Key + ": " + cats.Sum(x => x.Count) + " categorized non-type elements; id-count step " + Mib(p.CountBytes) + " private in " + p.CountSeconds.ToString("0.0") + " s");
            return new { partition = p.Key, basis = "measured", countStepSeconds = p.CountSeconds, countStepPrivateBytesDelta = p.CountBytes,
                categories = cats.OrderByDescending(x => x.Count).ToArray() };
        }).ToArray();
        return new { instances = rows, partitions = counts,
            question = "Does a quick-filter ToElementIds count avoid element expansion? Read countStepPrivateBytesDelta here against first-touch KB per element: near zero here plus a positive first-touch slope means the id walk did not expand elements." };
    }

    private static string PathKind(RevitLinkType type)
    {
        var r = type?.GetExternalFileReference();
        if (r != null) return r.GetAbsolutePath().CloudPath ? "cloud" : "local";
        return type != null && type.GetExternalResourceReferences().Count > 0 ? "external-resource (cloud or server)" : "unknown";
    }

    private CensusCategoryCount[] Categories(CensusPartition p)
    {
        if (p.Categories != null) return p.Categories;
        var before = PrivateBytes(); var clock = Stopwatch.StartNew();
        var rows = new List<CensusCategoryCount>(); var seen = new HashSet<long>();
        // Centre-line helpers may not be top-level; ask for them by name so they are never folded into the residual.
        var cats = p.Doc.Settings.Categories.Cast<Category>().Concat(CenterLines.Select(b => Try(() => Category.GetCategory(p.Doc, b))).Where(x => x != null));
        foreach (var c in cats) {
            budget.Check();
            if (!seen.Add(c.Id.Value)) continue;
            int n;
            using (var col = new FilteredElementCollector(p.Doc).OfCategoryId(c.Id).WhereElementIsNotElementType()) n = col.ToElementIds().Count;
            if (n > 0) rows.Add(new CensusCategoryCount { Category = c.Name, CategoryId = c.Id.Value, BuiltIn = c.BuiltInCategory.ToString(),
                CategoryType = c.CategoryType.ToString(), Parent = c.Parent?.Name, Count = n });
        }
        p.CountSeconds = clock.Elapsed.TotalSeconds; p.CountBytes = PrivateBytes() - before;
        return p.Categories = rows.ToArray();
    }

    // M3: expand a bounded sample; slope times count is a projection, never a measurement.
    // FOOTGUN: on Chadds' IFC link (2026-10-27, probe-25) a full non-type collector walk cost ~13 KB/element, linear at ~64 MiB
    // per 5,000 elements, while 1000 random GetElement or id-set-collector touches read ~0.3 to 0.5 KB/element. Random touches
    // do not reproduce a walk's cost, mechanism unknown. So the projection takes the larger of the id-set slope and a bounded
    // walk of the partition's largest model category, and it is labelled a floor.
    private object FirstTouch(CensusPartition p)
    {
        var before = PrivateBytes();
        List<ElementId> ids;
        using (var c = new FilteredElementCollector(p.Doc).WhereElementIsNotElementType()) ids = c.ToElementIds().ToList();
        var idListBytes = PrivateBytes() - before;
        p.NonTypeCount = ids.Count;
        // One shuffle, two disjoint slices: the first chunk is the GetElement control, the rest is the id-set collector sample.
        var drawn = Sample(ids, ProfilerSettings.CensusFirstTouchSample + ProfilerSettings.CensusChunk);
        var control = Touch(p.Doc, drawn.Take(ProfilerSettings.CensusChunk).ToList(), false);
        p.Sample = drawn.Skip(ProfilerSettings.CensusChunk).ToList();
        var sample = Touch(p.Doc, p.Sample, true);
        var top = Categories(p).Where(x => x.CategoryType == "Model").OrderByDescending(x => x.Count).FirstOrDefault();
        var walkClock = Stopwatch.StartNew(); var walkBefore = PrivateBytes(); var walked = 0;
        if (top != null)
            using (var c = new FilteredElementCollector(p.Doc).OfCategoryId(new ElementId(top.CategoryId)).WhereElementIsNotElementType())
            foreach (var e in c) { budget.Check(); _ = e.Category; if (++walked == ProfilerSettings.CensusCategoryWalk) break; }
        var walkKb = (PrivateBytes() - walkBefore) / 1024.0 / Math.Max(1, walked);
        var kb = Math.Max(walkKb, sample.Kb);
        var projected = kb > 0 ? (long?)(kb * 1024 * ids.Count) : null;
        var disagree = kb > 1 && kb > 3 * Math.Max(0.1, Math.Min(walkKb, sample.Kb));
        headlines.Add(p.Key + ": first touch " + kb.ToString("0.0") + " KB/element (category walk " + walkKb.ToString("0.0") + " over " + walked + " " + top?.Category +
            ", id-set " + sample.Kb.ToString("0.0") + " over " + p.Sample.Count + ", GetElement " + control.Kb.ToString("0.0") + "); full walk of " + ids.Count + " projected at least " +
            (projected == null ? "n/a (slope not positive: noise or already warm)" : Mib(projected.Value)) + (disagree ? "; routes disagree by >3x" : ""));
        return new { partition = p.Key, nonTypeElements = new { basis = "measured", count = ids.Count, idListPrivateBytesDelta = idListBytes },
            categoryWalk = new { basis = "sampled", route = "OfCategoryId(largest model category) collector walk, stopped at the cap", category = top?.Category, elements = walked,
                seconds = walkClock.Elapsed.TotalSeconds, kbPerElement = walkKb },
            sample = new { basis = "sampled", route = "FilteredElementCollector(doc, chunk ids) iteration + Category", elements = p.Sample.Count, seed = ProfilerSettings.CensusSeed,
                seconds = sample.Seconds, privateBytesDelta = sample.Bytes, kbPerElement = sample.Kb, msPerElement = sample.Seconds * 1000 / Math.Max(1, p.Sample.Count), chunks = sample.Chunks },
            control = new { basis = "sampled", route = "doc.GetElement + Category (did not reproduce a walk on Chadds; never projected from)", elements = control.Elements,
                privateBytesDelta = control.Bytes, kbPerElement = control.Kb },
            fullWalk = new { basis = "projected-floor", privateBytes = projected, kbPerElement = kb, routesDisagree = disagree, seconds = walkClock.Elapsed.TotalSeconds / Math.Max(1, walked) * ids.Count,
                note = "Larger slope times count; null when not positive. A floor: on Chadds random touches read ~30x under a full walk. Elements touched earlier in this process read as zero." } };
    }

    private (int Elements, long Bytes, double Kb, double Seconds, List<object> Chunks) Touch(Document d, List<ElementId> ids, bool collector)
    {
        var chunks = new List<object>(); long total = 0; var clock = Stopwatch.StartNew();
        for (var i = 0; i < ids.Count; i += ProfilerSettings.CensusChunk) {
            budget.Check();
            var chunk = ids.Skip(i).Take(ProfilerSettings.CensusChunk).ToList();
            var b = PrivateBytes(); var touched = 0;
            // Revit refuses to iterate an id-set collector with no filter applied.
            if (collector) { using (var c = new FilteredElementCollector(d, chunk).WhereElementIsNotElementType()) foreach (var e in c) if (e.Category != null) touched++; }
            else foreach (var id in chunk) if (d.GetElement(id)?.Category != null) touched++;
            var delta = PrivateBytes() - b; total += delta;
            chunks.Add(new { elements = chunk.Count, withCategory = touched, privateBytesDelta = delta });
        }
        return (ids.Count, total, total / 1024.0 / Math.Max(1, ids.Count), clock.Elapsed.TotalSeconds, chunks);
    }

    // M6: what would enter a scene as context, by ids and categories; only ImportInstances are expanded.
    private object ContextCandidates(CensusPartition p)
    {
        var cats = Categories(p);
        var classes = new[] { typeof(FamilyInstance), typeof(MEPCurve), typeof(Wall), typeof(CurveElement), typeof(DirectShape), typeof(ImportInstance),
            typeof(SpatialElement), typeof(DuctInsulation), typeof(PipeInsulation), typeof(DuctLining) }
            .Select(t => new { basis = "measured", @class = t.Name, count = Try(() => { using (var c = new FilteredElementCollector(p.Doc).OfClass(t)) return (int?)c.ToElementIds().Count; }) }).ToArray();
        int viewSpecific;
        using (var filter = new ElementOwnerViewFilter(ElementId.InvalidElementId, true))
        using (var c = new FilteredElementCollector(p.Doc).WhereElementIsNotElementType().WherePasses(filter)) viewSpecific = c.ToElementIds().Count;
        var imports = new List<object>();
        using (var c = new FilteredElementCollector(p.Doc).OfClass(typeof(ImportInstance)))
        foreach (ImportInstance ii in c) {
            budget.Check();
            if (imports.Count == 500) break;
            imports.Add(new { id = ii.Id.Value, category = ii.Category?.Name, ii.IsLinked, viewSpecific = ii.ViewSpecific, ownerViewId = ii.OwnerViewId.Value });
        }
        var flagged = cats.Where(x => CenterLines.Any(b => b.ToString() == x.BuiltIn)).Select(x => new { basis = "measured", reason = "MEP centre-line helper, not geometry", x.Category, x.Count })
            .Concat(cats.Where(x => InsulationLining.Any(b => b.ToString() == x.BuiltIn)).Select(x => new { basis = "measured", reason = "insulation/lining: a shell over a host, not its own object", x.Category, x.Count }))
            .Concat(new[] { new { basis = imports.Count == 500 ? "sampled" : "measured", reason = "CAD import/link: lines and faces, not model elements", Category = "ImportInstance", Count = imports.Count } }.Where(x => x.Count > 0))
            .ToArray();
        var categorized = cats.Sum(x => x.Count);
        headlines.Add(p.Key + ": context flags " + string.Join(", ", flagged.Select(f => f.Category + " " + f.Count)));
        return new { partition = p.Key, classes, viewSpecific = new { basis = "measured", count = viewSpecific },
            byCategoryType = cats.GroupBy(x => x.CategoryType).Select(g => new { basis = "measured", categoryType = g.Key, count = g.Sum(x => x.Count) }).ToArray(),
            byParent = cats.Where(x => x.Parent != null).GroupBy(x => x.Parent).Select(g => new { basis = "measured", parent = g.Key, count = g.Sum(x => x.Count) }).ToArray(),
            uncategorizedOrSubcategoryResidual = new { basis = "measured", count = p.NonTypeCount - categorized,
                note = "Non-type elements minus top-level and centre-line category counts; negative if a category was counted twice." },
            imports, flagged };
    }

    // M7: per-element orientation on a sample; route (a) oriented boxes on rotated instances, cost recorded per element.
    private object Orientation(CensusPartition p)
    {
        List<ElementId> ids;
        using (var filter = new LogicalOrFilter(new List<ElementFilter> { new ElementClassFilter(typeof(MEPCurve)), new ElementClassFilter(typeof(Wall)), new ElementClassFilter(typeof(FamilyInstance)),
            // DirectShape and Location-less framing (IFC links) have no cheap frame; count them so the gap is visible, not absent.
            new ElementClassFilter(typeof(DirectShape)), new ElementCategoryFilter(BuiltInCategory.OST_StructuralFraming) }))
        using (var c = new FilteredElementCollector(p.Doc).WhereElementIsNotElementType().WherePasses(filter)) ids = c.ToElementIds().ToList();
        var sample = Sample(ids, ProfilerSettings.CensusOrientationSample);
        // Report yaw in the host frame: a link's own frame hid Chadds' 45-degree link placement. Several placements have no one host frame.
        var placements = p.LinkInstanceIds.Select(id => doc.GetElement(new ElementId(id)) as RevitLinkInstance).Where(li => li != null)
            .Select(li => Math.Round(Yaw(li.GetTotalTransform().BasisX), 6)).Distinct().ToList();
        var offset = placements.Count == 1 ? placements[0] : 0;
        var frameBasis = p.LinkInstanceIds.Count == 0 ? "host" : placements.Count == 1 ? "host (link yaw " + offset.ToString("0.#") + " deg added)" : "link-local (" + placements.Count + " placements)";
        var angles = new List<double>(); var rotated = new List<FamilyInstance>(); int vertical = 0; var noFrame = new Dictionary<string, int>();
        foreach (var id in sample) {
            budget.Check();
            var e = p.Doc.GetElement(id);
            XYZ x = null;
            if (e?.Location is LocationCurve lc) { try { var cv = lc.Curve; x = cv.GetEndPoint(1) - cv.GetEndPoint(0); } catch (Autodesk.Revit.Exceptions.ApplicationException) { } }
            else if (e is FamilyInstance fi) x = fi.GetTotalTransform().BasisX;
            if (x == null) { var k = (e?.GetType().Name ?? "missing") + "/" + (e?.Category?.Name ?? "-"); noFrame[k] = noFrame.TryGetValue(k, out var n) ? n + 1 : 1; continue; }
            if (Math.Abs(x.X) + Math.Abs(x.Y) < 1e-6) { vertical++; continue; }
            var a = Mod90(Yaw(x) + offset); angles.Add(a);
            // Oriented boxes compare against the world box of the element's own document, so select on its own-document yaw.
            var own = Mod90(Yaw(x));
            if (e is FamilyInstance r && !(e.Location is LocationCurve) && Math.Min(own, 90 - own) > 2 && rotated.Count < ProfilerSettings.CensusObbSample) rotated.Add(r);
        }
        var bins = new int[18]; foreach (var a in angles) bins[(int)(a / 5) % 18]++;
        var frames = Frames(angles);
        headlines.Add(p.Key + ": frames " + string.Join(", ", frames.Select(f => f.AngleDegrees.ToString("0.#") + " deg " + (100 * f.Share).ToString("0") + "%")) +
            " of " + angles.Count + " with a frame (" + (sample.Count - angles.Count - vertical) + " of " + sample.Count + " sampled have none), " + frameBasis);
        return new { partition = p.Key, candidates = new { basis = "measured", count = ids.Count },
            sample = new { basis = "sampled", elements = sample.Count, frameBasis, withYaw = angles.Count, vertical, noFrame,
                offAxisShare = angles.Count == 0 ? (double?)null : angles.Count(a => Math.Min(a, 90 - a) > 2) / (double)angles.Count,
                histogramMod90 = bins.Select((n, i) => new { fromDegrees = i * 5, count = n }).ToArray(), frames },
            orientedBoxes = OrientedBoxes(rotated) };
    }

    // Route (a): symbol geometry GetBoundingBox through GeometryInstance, no Triangulate. Still generates geometry.
    private object OrientedBoxes(List<FamilyInstance> rotated)
    {
        var ratios = new List<double>(); var before = PrivateBytes(); var clock = Stopwatch.StartNew();
        foreach (var fi in rotated) {
            budget.Check();
            var inv = fi.GetTotalTransform().Inverse;
            double[] local = Empty(); var world = fi.get_BoundingBox(null);
            var ge = fi.get_Geometry(Medium);
            if (ge == null || world == null) continue;
            foreach (var go in ge) {
                if (go is GeometryInstance gi) { var bb = gi.GetSymbolGeometry()?.GetBoundingBox(); if (bb != null) Grow(local, bb, inv.Multiply(gi.Transform)); }
                else if (go is Solid s && s.Faces.Size > 0) Grow(local, s.GetBoundingBox(), inv);
            }
            var v = Volume(local); var w = (world.Max.X - world.Min.X) * (world.Max.Y - world.Min.Y) * (world.Max.Z - world.Min.Z);
            if (v > 1e-9) ratios.Add(w / v);
        }
        var n = rotated.Count; var bytes = PrivateBytes() - before;
        ratios.Sort();
        return new { basis = "sampled", route = "a: symbol geometry GetBoundingBox via GeometryInstance, Medium, no Triangulate",
            elements = rotated.Count, withRatio = ratios.Count,
            worldAabbOverOrientedMedian = ratios.Count == 0 ? (double?)null : ratios[ratios.Count / 2],
            worldAabbOverOrientedP90 = ratios.Count == 0 ? (double?)null : ratios[(int)(ratios.Count * 0.9)],
            seconds = clock.Elapsed.TotalSeconds, msPerElement = n == 0 ? (double?)null : clock.Elapsed.TotalMilliseconds / n,
            privateBytesDelta = bytes, kbPerElement = n == 0 ? (double?)null : bytes / 1024.0 / n,
            note = "Per-element cost is geometry generation; elements expanded by first-touch or orientation are warm. Reference volume is the route (a) box, not a mesh." };
    }

    // Levels and base points that poison extents, plus sampled elements far outside robust extents.
    private object Extents(CensusPartition p)
    {
        var levels = new FilteredElementCollector(p.Doc).OfClass(typeof(Level)).Cast<Level>().Select(l => new { l.Name, id = l.Id.Value, l.Elevation }).OrderBy(l => l.Elevation).ToList();
        var elev = levels.Select(l => l.Elevation).ToList();
        var median = elev.Count == 0 ? 0 : Profiler.Median(elev);
        var mad = elev.Count == 0 ? 0 : Profiler.Median(elev.Select(e => Math.Abs(e - median)));
        var limit = Math.Max(10 * mad, 100);
        var points = new[] { ("project-base-point", (Func<XYZ>)(() => BasePoint.GetProjectBasePoint(p.Doc).Position)), ("survey-point", () => BasePoint.GetSurveyPoint(p.Doc).Position) }
            .Select(x => { var pos = Try(x.Item2); return new { basis = "measured", point = x.Item1, x = pos?.X, y = pos?.Y, z = pos?.Z, distanceFromInternalOriginFt = pos?.GetLength() }; }).ToArray();
        var centers = new List<(ElementId id, XYZ c)>(); var clock = Stopwatch.StartNew(); var before = PrivateBytes();
        foreach (var id in p.Sample ?? new List<ElementId>()) {
            budget.Check();
            var bb = p.Doc.GetElement(id)?.get_BoundingBox(null);
            if (bb != null) centers.Add((id, (bb.Min + bb.Max) / 2));
        }
        var bboxSeconds = clock.Elapsed.TotalSeconds; var bboxBytes = PrivateBytes() - before;
        object outliers = null;
        if (centers.Count >= 20) {
            double Q(Func<XYZ, double> f, double q) { var s = centers.Select(c => f(c.c)).OrderBy(v => v).ToList(); return s[(int)((s.Count - 1) * q)]; }
            var lo = new XYZ(Q(c => c.X, .01), Q(c => c.Y, .01), Q(c => c.Z, .01)); var hi = new XYZ(Q(c => c.X, .99), Q(c => c.Y, .99), Q(c => c.Z, .99));
            var reach = Math.Max(hi.DistanceTo(lo), 1000);
            double Outside(XYZ c) => new XYZ(Math.Max(0, Math.Max(lo.X - c.X, c.X - hi.X)), Math.Max(0, Math.Max(lo.Y - c.Y, c.Y - hi.Y)), Math.Max(0, Math.Max(lo.Z - c.Z, c.Z - hi.Z))).GetLength();
            var far = centers.Select(c => new { c.id, d = Outside(c.c) }).Where(x => x.d > reach).OrderByDescending(x => x.d).ToList();
            outliers = new { basis = "sampled", sampled = centers.Count, robustMin = new[] { lo.X, lo.Y, lo.Z }, robustMax = new[] { hi.X, hi.Y, hi.Z },
                thresholdFt = reach, farCount = far.Count, projectedFarInPartition = (long)((double)far.Count / centers.Count * p.NonTypeCount),
                worst = far.Take(10).Select(x => { var e = p.Doc.GetElement(x.id); return new { id = x.id.Value, e?.UniqueId, category = e?.Category?.Name, distanceFt = x.d }; }).ToArray() };
        }
        return new { partition = p.Key,
            levels = new { basis = "measured", count = levels.Count, medianFt = median, madFt = mad, outlierLimitFt = limit,
                outliers = levels.Where(l => Math.Abs(l.Elevation - median) > limit).ToArray(), all = levels.Take(200).ToArray() },
            points, boundingBoxRead = new { basis = "sampled", elements = centers.Count, seconds = bboxSeconds, privateBytesDelta = bboxBytes }, outliers };
    }

    private object Holds(CensusPartition host)
    {
        var views = uidoc?.GetOpenUIViews().Select(u => doc.GetElement(u.ViewId) as View).Where(v => v != null)
            .Select(v => new { id = v.Id.Value, v.Name, viewType = v.ViewType.ToString(), is3D = v is View3D, detailLevel = v.DetailLevel.ToString(), displayStyle = v.DisplayStyle.ToString() }).ToArray();
        var documents = doc.Application.Documents.Cast<Document>().Select(d => new { d.Title, d.IsLinked, d.IsFamilyDocument }).ToArray();
        object worksharing = new { doc.IsWorkshared };
        if (doc.IsWorkshared) {
            var worksets = new FilteredWorksetCollector(doc).OfKind(WorksetKind.UserWorkset).ToWorksets();
            var statuses = new Dictionary<string, int>(); var clock = Stopwatch.StartNew();
            foreach (var id in host.Sample ?? new List<ElementId>()) { budget.Check(); var s = WorksharingUtils.GetCheckoutStatus(doc, id).ToString(); statuses[s] = statuses.TryGetValue(s, out var n) ? n + 1 : 1; }
            var sampled = Math.Max(1, host.Sample?.Count ?? 0);
            worksharing = new { doc.IsWorkshared, userWorksets = new { basis = "measured", count = worksets.Count, open = worksets.Count(w => w.IsOpen) },
                checkoutStatus = new { basis = "sampled", elements = host.Sample?.Count ?? 0, msPerElement = clock.Elapsed.TotalMilliseconds / sampled, statuses },
                ownedByCurrentUserProjected = new { basis = "projected", count = (long)((statuses.TryGetValue(nameof(CheckoutStatus.OwnedByCurrentUser), out var mine) ? mine : 0) / (double)sampled * host.NonTypeCount) } };
        }
        if (views != null) headlines.Add("open views: " + views.Length + " (" + views.Count(v => v.is3D) + " 3D)");
        return new { basis = "measured", openViews = views, openViewsNote = uidoc == null ? "No UIDocument: open views unobservable." : null, documents, memory = Profiler.Memory(), worksharing };
    }

    // E3 method: duct fitting connector reconstructability, and insulation thickness parity with its host.
    private object Fidelity()
    {
        List<ElementId> fittingIds;
        using (var c = new FilteredElementCollector(doc).OfCategory(BuiltInCategory.OST_DuctFitting).OfClass(typeof(FamilyInstance))) fittingIds = c.ToElementIds().ToList();
        var fittings = Sample(fittingIds, ProfilerSettings.CensusFidelitySample).Select(id => doc.GetElement(id) as FamilyInstance).Where(f => f != null)
            .Select(f => { budget.Check(); var pt = Try(() => (f.MEPModel as MechanicalFitting)?.PartType.ToString()) ?? "?"; return new { partType = pt, kind = Classify(f, pt) }; }).ToList();
        var covered = new HashSet<string> { "arc", "arc-resize", "straight", "offset", "loft", "loft-offset", "main+branch", "stub" };
        var share = fittings.Count == 0 ? (double?)null : fittings.Count(f => covered.Contains(f.kind)) / (double)fittings.Count;
        headlines.Add("duct fittings: " + fittingIds.Count + ", connector-reconstructable " + (share == null ? "n/a" : (100 * share.Value).ToString("0") + "%") + " of " + fittings.Count + " sampled");
        return new {
            ductFittings = new { basis = "measured", count = fittingIds.Count },
            sample = new { basis = "sampled", elements = fittings.Count, connectorReconstructableShare = share,
                partTypes = fittings.GroupBy(f => f.partType).Select(g => new { partType = g.Key, count = g.Count() }).OrderByDescending(x => x.count).ToArray(),
                classes = fittings.GroupBy(f => f.kind).Select(g => new { kind = g.Key, count = g.Count() }).OrderByDescending(x => x.count).ToArray() },
            insulation = new[] { typeof(DuctInsulation), typeof(PipeInsulation) }.Select(Parity).ToArray(),
            scope = "Host document only."
        };
    }

    private object Parity(Type type)
    {
        List<ElementId> ids;
        using (var c = new FilteredElementCollector(doc).OfClass(type)) ids = c.ToElementIds().ToList();
        int exposes = 0, equal = 0, n = 0;
        foreach (var id in Sample(ids, ProfilerSettings.CensusFidelitySample)) {
            budget.Check();
            if (!(doc.GetElement(id) is InsulationLiningBase ins)) continue;
            n++;
            var hp = doc.GetElement(ins.HostElementId)?.get_Parameter(BuiltInParameter.RBS_REFERENCE_INSULATION_THICKNESS);
            if (hp == null || !hp.HasValue) continue;
            exposes++;
            if (Math.Abs(hp.AsDouble() - ins.Thickness) < 1e-6) equal++;
        }
        return new { @class = type.Name, count = new { basis = "measured", value = ids.Count },
            sample = new { basis = "sampled", elements = n, hostExposesReferenceThickness = exposes, equalsInsulationThickness = equal } };
    }

    private static string Classify(FamilyInstance f, string pt)
    {
        var ks = new List<(XYZ o, XYZ z, string size)>(); var total = 0;
        try {
            foreach (Connector k in f.MEPModel?.ConnectorManager?.Connectors ?? new ConnectorSet()) {
                if (k.ConnectorType == ConnectorType.Logical) continue;
                total++;
                try {
                    var cs = k.CoordinateSystem;
                    ks.Add((cs.Origin, cs.BasisZ, k.Shape == ConnectorProfileType.Round ? "R" + Math.Round(k.Radius, 4) : k.Shape + ":" + Math.Round(k.Width, 4) + "x" + Math.Round(k.Height, 4)));
                } catch (Autodesk.Revit.Exceptions.ApplicationException) { }
            }
        } catch (Autodesk.Revit.Exceptions.ApplicationException) { return "no-frames"; }
        if (ks.Count == 0 || ks.Count != total) return "no-frames";
        if (ks.Count == 1) return pt.StartsWith("Tap") || pt.StartsWith("Spud") || pt.StartsWith("Cap") ? "stub" : "single-other";
        if (ks.Count == 2) {
            var (a, b) = (ks[0], ks[1]);
            if (a.z.DotProduct(b.z) < -0.9999) {
                var gap = b.o - a.o;
                var collinear = gap.GetLength() < 1e-9 || Math.Abs(gap.DotProduct(a.z)) / gap.GetLength() > 0.9999;
                if (pt == "Transition" || a.size != b.size) return collinear ? "loft" : "loft-offset";
                return collinear ? "straight" : "offset";
            }
            var cp = Closest(a.o, a.z, b.o, b.z);
            if (cp == null) return "skew-parallel";
            if (cp.Value.p.DistanceTo(cp.Value.q) > 1e-3) return "skew";
            double t1 = cp.Value.p.DistanceTo(a.o), t2 = cp.Value.q.DistanceTo(b.o);
            if (Math.Abs(t1 - t2) > 0.01 * Math.Max(Math.Max(t1, t2), 1e-9)) return "corner-unequal";
            return a.size == b.size ? "arc" : "arc-resize";
        }
        for (var i = 0; i < ks.Count; i++)
        for (var j = i + 1; j < ks.Count; j++) {
            if (ks[i].z.DotProduct(ks[j].z) > -0.9999) continue;
            var main = ks[i];
            if (ks.Where((k, m) => m != i && m != j).All(k => Closest(main.o, main.z, k.o, k.z) is var c && c != null && c.Value.p.DistanceTo(c.Value.q) <= 1e-3)) return "main+branch";
        }
        return "multi-other";
    }

    private static (XYZ p, XYZ q)? Closest(XYZ o1, XYZ d1, XYZ o2, XYZ d2)
    {
        var w = o1 - o2; double a = d1.DotProduct(d1), b = d1.DotProduct(d2), c = d2.DotProduct(d2), d = d1.DotProduct(w), e = d2.DotProduct(w);
        var den = a * c - b * b;
        if (Math.Abs(den) < 1e-12) return null;
        return (o1 + d1 * ((b * e - c * d) / den), o2 + d2 * ((a * e - b * d) / den));
    }

    // M15: what a version-keyed cache could key on.
    private object Freshness(CensusPartition p)
    {
        var version = Try(() => Document.GetDocumentVersion(p.Doc));
        int readable = 0, failed = 0; var distinct = new HashSet<Guid>();
        foreach (var id in (p.Sample ?? new List<ElementId>()).Take(200)) {
            budget.Check();
            try { var g = p.Doc.GetElement(id)?.VersionGuid; if (g != null) { readable++; distinct.Add(g.Value); } }
            catch (Autodesk.Revit.Exceptions.ApplicationException) { failed++; }
        }
        return new { partition = p.Key, document = new { basis = "measured", versionGuid = version?.VersionGUID.ToString(), numberOfSaves = version?.NumberOfSaves,
                location = p.Doc.IsModelInCloud ? "cloud" : "local", p.Doc.PathName, p.Doc.IsWorkshared },
            elementVersionGuid = new { basis = "sampled", elements = Math.Min(200, p.Sample?.Count ?? 0), readable, failed, distinct = distinct.Count } };
    }

    private static List<ElementId> Sample(List<ElementId> ids, int n)
    {
        var a = ids.ToArray(); var rng = new Random(ProfilerSettings.CensusSeed); n = Math.Min(n, a.Length);
        for (var i = 0; i < n; i++) { var j = rng.Next(i, a.Length); var t = a[i]; a[i] = a[j]; a[j] = t; }
        return a.Take(n).ToList();
    }

    private static List<CensusFrame> Frames(List<double> angles)
    {
        var bins = new int[18]; foreach (var a in angles) bins[(int)(a / 5) % 18]++;
        var taken = new bool[18]; var frames = new List<CensusFrame>();
        while (angles.Count > 0) {
            var best = Enumerable.Range(0, 18).Where(i => !taken[i]).OrderByDescending(i => bins[i]).DefaultIfEmpty(-1).First();
            if (best < 0 || bins[best] < Math.Max(1, 0.05 * angles.Count)) break;
            var members = new[] { best - 1, best, best + 1 }.Select(i => (i + 18) % 18).Where(i => !taken[i]).ToList();
            foreach (var i in members) taken[i] = true;
            var inFrame = angles.Where(a => members.Contains((int)(a / 5) % 18)).ToList();
            // Circular mean on the 90-degree circle: scale by four so 89 and 1 degree average to 0.
            var mean = Math.Atan2(inFrame.Sum(a => Math.Sin(a * Math.PI / 45)), inFrame.Sum(a => Math.Cos(a * Math.PI / 45))) * 45 / Math.PI;
            frames.Add(new CensusFrame { AngleDegrees = Math.Round(mean < 0 ? mean + 90 : mean, 1), Share = inFrame.Count / (double)angles.Count, Elements = inFrame.Count });
        }
        return frames;
    }

    private static double Yaw(XYZ x) => Math.Atan2(x.Y, x.X) * 180 / Math.PI;
    private static double Mod90(double a) => ((a % 90) + 90) % 90;
    private static double[] Empty() => new[] { double.MaxValue, double.MaxValue, double.MaxValue, double.MinValue, double.MinValue, double.MinValue };
    private static double Volume(double[] b) => b[0] > b[3] ? 0 : (b[3] - b[0]) * (b[4] - b[1]) * (b[5] - b[2]);
    private static void Grow(double[] b, BoundingBoxXYZ bb, Transform toLocal)
    {
        var t = toLocal.Multiply(bb.Transform);
        foreach (var x in new[] { bb.Min.X, bb.Max.X }) foreach (var y in new[] { bb.Min.Y, bb.Max.Y }) foreach (var z in new[] { bb.Min.Z, bb.Max.Z }) {
            var p = t.OfPoint(new XYZ(x, y, z));
            b[0] = Math.Min(b[0], p.X); b[1] = Math.Min(b[1], p.Y); b[2] = Math.Min(b[2], p.Z);
            b[3] = Math.Max(b[3], p.X); b[4] = Math.Max(b[4], p.Y); b[5] = Math.Max(b[5], p.Z);
        }
    }

    private static T Try<T>(Func<T> f) { try { return f(); } catch (Autodesk.Revit.Exceptions.ApplicationException) { return default(T); } catch (InvalidOperationException) { return default(T); } }
    private static long PrivateBytes() { using (var p = Process.GetCurrentProcess()) return p.PrivateMemorySize64; }
    private static string Mib(long bytes) => (bytes / 1048576.0).ToString("+0.0;-0.0") + " MiB";

    private static readonly string[] Limits = {
        "Private bytes is whole-process: other documents, the UI, GC timing and allocator granularity land in every delta. Small deltas are noise.",
        "Projected rows are slope times count; sampled rows are a seeded random sample; only measured rows are exact for this process.",
        "First touch reads zero for elements anything in this process touched earlier, including earlier sections of this run.",
        "First-touch projections are floors: on Chadds (2026-10-27) random element touches read ~30x under a full collector walk of the same link.",
        "Oriented boxes use route (a): exact on rotated family instances proven on Chadds, unproven on nested or multi-instance families.",
        "Checkout status and element VersionGuid are sampled; worksharing borrowed counts are projected, not listed."
    };
}

public sealed class CensusPartition
{
    public string Key;
    public Document Doc;
    public List<long> LinkInstanceIds = new List<long>();
    public CensusCategoryCount[] Categories;
    public double CountSeconds;
    public long CountBytes;
    public int NonTypeCount;
    public List<ElementId> Sample;
}

public sealed class CensusCategoryCount
{
    public string Category;
    public long CategoryId;
    public string BuiltIn;
    public string CategoryType;
    public string Parent;
    public int Count;
}

public sealed class CensusFrame
{
    public double AngleDegrees;
    public double Share;
    public int Elements;
}
