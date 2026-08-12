namespace Pe.Revit.Takeoff;

using System.Security.Cryptography;
using System.Text;

internal sealed record MaterializationResolutionResult(
    TakeoffResult Takeoff,
    int Applied,
    int Remapped,
    int Orphaned
);

public sealed record NativeReadbackResult(
    int SpacesRead,
    int SkippedUnplaced,
    int SkippedUnenclosed,
    string PathWritten
);

public sealed record NativeEditabilityGateResult(
    int Reviewed,
    int Retained,
    int Rejected,
    IReadOnlyDictionary<string, IReadOnlyList<EditabilityViolationKind>> RejectionReasons
);

public sealed record PendingNativeTakeoffRun(
    string DocumentIdentity,
    long LevelId,
    long PhaseId,
    string OwnershipToken,
    string RunId,
    string SourceSha256,
    IReadOnlyList<long> ExpectedElementIds,
    IReadOnlyList<string> ExpectedRoomIds
);

public sealed record AuditedNativeTakeoffRun(
    PendingNativeTakeoffRun Pending,
    NativeEditabilityGateResult Audit,
    IReadOnlyList<long> RetainedElementIds
);

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
// Method choice (why projection seed + heightfield, decided 2026-07-06 on projectA):
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
        var (va, va2, vb, vd) = ProjectionSeed.PrepareSeedViews(doc, level, crop, opt, log);
        SaveState(opt, level, crop, va, va2, vb, vd);
        log($"[prepare] level='{level.Name}' crop=({crop.Min.X:F0},{crop.Min.Y:F0})..({crop.Max.X:F0},{crop.Max.Y:F0})");
    }

    public static TakeoffResult Detect(Document doc, string levelNameContains, Action<string> log, TakeoffOptions? optOverride = null)
    {
        var opt = optOverride ?? new TakeoffOptions();
        opt.LevelNameContains = levelNameContains;
        var level = ResolveLevel(doc, levelNameContains);
        var (crop, va, va2, vb, vd) = LoadState(opt, level);
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
            doc, va, va2, vb, vd, crop, hf.W, hf.H, opt.CellFt, workDir, opt, log);
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
            // header for the honesty boundary). Detection changes then replay in NoDocumentRuntime
            // tests in seconds — never tune detection through repeated bridge runs.
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

    public static PendingNativeTakeoffRun MaterializeSpaces(
        Document doc, string levelNameContains, Phase phase, Action<string> log, TakeoffOptions? optOverride = null)
    {
        var opt = optOverride ?? new TakeoffOptions();
        opt.LevelNameContains = levelNameContains;
        var level = ResolveLevel(doc, levelNameContains);
        string token = SpaceMaterializer.Token(opt, level, phase);
        if (SpaceMaterializer.HasPendingRun(doc, token))
            throw new InvalidOperationException(
                "this level/phase already has a pending native takeoff; finalize or explicitly clean it up first");
        var inkNear = InkSupport.LoadOracle(InkPath(opt, level), 3 * opt.CellFt);
        var distanceToInk = InkSupport.LoadDistanceOracle(InkPath(opt, level));
        if (inkNear == null) log("[spaces] no ink raster found — arcs run on geometry alone");
        var takeoffDir = ArtifactDir(opt);
        var sidecar = TakeoffResolutions.ResolutionPath(takeoffDir);
        var resolved = File.Exists(sidecar)
            ? LoadMaterializationResult(takeoffDir, level.Name, sidecar)
            : new MaterializationResolutionResult(LoadResult(opt, level), 0, 0, 0);
        var resolutionSummary =
            $"applied={resolved.Applied} remapped={resolved.Remapped} orphaned={resolved.Orphaned}";
        log(resolved.Orphaned > 0
            ? $"[spaces] WARNING orphaned resolution decisions; {resolutionSummary}; unresolved rooms remain materialized"
            : $"[spaces] resolutions {resolutionSummary}");
        var takeoff = resolved.Takeoff;
        SpaceBoundaryNetwork.Regularize(takeoff.Rooms, opt.BoundarySimplifyFt, log);
        var alignmentPartition = takeoff.Rooms.ToList();
        TakeoffPromotion.ApplyFrameLocal(takeoff, FrameLocalProjector.Project(takeoff), log);
        TakeoffPromotion.MergeOrHoldTinyRooms(takeoff, opt.MinimumPromotedRoomSqft, log);
        TakeoffPromotion.RejectMisalignedExposedRails(
            takeoff, alignmentPartition, distanceToInk, log);
        string runId = Guid.NewGuid().ToString("N");
        string sourceSha256 = Sha256(takeoff.ToTsv());
        var materialized = SpaceMaterializer.Replace(
            doc, level, phase, takeoff, opt, log, inkNear,
            new NativeRunStamp(runId, sourceSha256, "pending"));
        return new PendingNativeTakeoffRun(
            DocumentIdentity(doc), level.Id.Value(), phase.Id.Value(),
            token, runId, sourceSha256,
            materialized.Spaces.Select(id => id.Value()).OrderBy(id => id).ToList(),
            takeoff.Rooms.Select(room => room.Id).OrderBy(id => id, StringComparer.Ordinal).ToList());
    }

    /// <summary>
    /// Completes a pending native run after its materialization transaction has committed and
    /// Revit has recomputed Space boundaries. This method requires a second write transaction.
    /// </summary>
    public static AuditedNativeTakeoffRun AuditAndFinalize(
        Document doc, PendingNativeTakeoffRun pending, Action<string> log, TakeoffOptions? optOverride = null)
    {
        if (!doc.IsModifiable)
            throw new InvalidOperationException("Native takeoff finalization requires an open transaction");
        if (DocumentIdentity(doc) != pending.DocumentIdentity)
            throw new InvalidOperationException("pending native takeoff belongs to a different document");
        var level = doc.GetElement(pending.LevelId.ToElementId()) as Level
            ?? throw new InvalidOperationException("pending native takeoff level no longer exists");
        var phase = doc.GetElement(pending.PhaseId.ToElementId()) as Phase
            ?? throw new InvalidOperationException("pending native takeoff phase no longer exists");
        var opt = optOverride ?? new TakeoffOptions();
        if (SpaceMaterializer.Token(opt, level, phase) != pending.OwnershipToken)
            throw new InvalidOperationException("pending native takeoff ownership token does not match options");

        var owned = new FilteredElementCollector(doc).OfClass(typeof(SpatialElement))
            .OfCategory(BuiltInCategory.OST_MEPSpaces).Cast<Space>()
            .Where(space => SpaceMaterializer.Owned(space, pending.OwnershipToken))
            .OrderBy(space => space.Id.Value()).ToList();
        if (!owned.Select(space => space.Id.Value()).SequenceEqual(pending.ExpectedElementIds)
            || !owned.Select(space => space.Number).OrderBy(id => id, StringComparer.Ordinal)
                .SequenceEqual(pending.ExpectedRoomIds))
            throw new InvalidOperationException("pending native takeoff elements no longer match its receipt");
        if (owned.Any(space => !SpaceMaterializer.HasRunStamp(
                space, pending.RunId, pending.SourceSha256, "pending")))
            throw new InvalidOperationException("pending native takeoff stamp is missing or stale");

        var audit = PruneUneditableNative(doc, level, phase, opt, log);
        SpaceMaterializer.SetRunAuditState(
            doc, opt, level, phase, pending.RunId, pending.SourceSha256, "passed");
        var retained = new FilteredElementCollector(doc).OfClass(typeof(SpatialElement))
            .OfCategory(BuiltInCategory.OST_MEPSpaces).Cast<Space>()
            .Where(space => SpaceMaterializer.Owned(space, pending.OwnershipToken))
            .Select(space => space.Id.Value()).OrderBy(id => id).ToList();
        return new AuditedNativeTakeoffRun(pending, audit, retained);
    }

    public static NativeReadbackResult ReadbackNative(
        Document doc,
        Level level,
        Phase phase,
        string takeoffDirectory,
        TakeoffOptions opt,
        Action<string> log)
    {
        if (doc.GetElement(level.Id) is not Level || doc.GetElement(phase.Id) is not Phase)
            throw new InvalidOperationException("level and phase must belong to the target document");

        var rooms = new List<RoomResult>();
        int skippedUnplaced = 0, skippedUnenclosed = 0;
        var spaces = new FilteredElementCollector(doc).OfClass(typeof(SpatialElement))
            .OfCategory(BuiltInCategory.OST_MEPSpaces).Cast<Space>()
            .Where(space => space.LevelId.Value() == level.Id.Value()
                            && space.get_Parameter(BuiltInParameter.ROOM_PHASE_ID)
                                ?.AsElementId().Value() == phase.Id.Value())
            .OrderBy(space => space.Number, StringComparer.Ordinal)
            .ToList();

        foreach (var space in spaces)
        {
            if (space.Location is not LocationPoint location)
            {
                skippedUnplaced++;
                continue;
            }

            var boundaries = space.GetBoundarySegments(new SpatialElementBoundaryOptions());
            if (space.Area <= 0 || boundaries is not { Count: > 0 })
            {
                skippedUnenclosed++;
                continue;
            }

            var loops = boundaries.Select(segments => new {
                    Segments = segments,
                    Points = BoundaryPoints(segments),
                })
                .Where(loop => loop.Points.Count >= 3)
                .OrderByDescending(loop => Math.Abs(TakeoffTsv.SignedArea(loop.Points)))
                .ToList();
            if (loops.Count == 0)
            {
                skippedUnenclosed++;
                continue;
            }

            var outer = loops[0].Points;
            if (TakeoffTsv.SignedArea(outer) < 0) outer.Reverse();
            var holes = loops.Skip(1).Select(loop => loop.Points).ToList();
            foreach (var hole in holes)
                if (TakeoffTsv.SignedArea(hole) > 0) hole.Reverse();

            var meanCeilingFt = space.LimitOffset;
            if (meanCeilingFt <= 0 || double.IsNaN(meanCeilingFt) || double.IsInfinity(meanCeilingFt))
            {
                meanCeilingFt = space.UnboundedHeight;
                if (meanCeilingFt <= 0 || double.IsNaN(meanCeilingFt) || double.IsInfinity(meanCeilingFt))
                    meanCeilingFt = opt.StoryCapFt;
                log($"[native-readback] Space '{space.Number}' has no usable LimitOffset; " +
                    $"using {meanCeilingFt:F2} ft");
            }

            rooms.Add(new RoomResult {
                Id = space.Number,
                RawSqft = space.Area,
                PerimeterFt = loops[0].Segments.Sum(segment => segment.GetCurve().Length),
                LabelX = location.Point.X,
                LabelY = location.Point.Y,
                MeanCeilingFt = meanCeilingFt,
                Polygon = outer,
                Holes = holes,
            });
        }

        if (rooms.Select(room => room.Id).Distinct(StringComparer.Ordinal).Count() != rooms.Count)
            throw new InvalidOperationException("native Space numbers must be unique");

        var result = new TakeoffResult {
            LevelName = level.Name,
            LevelElevation = level.ProjectElevation,
            Source = TakeoffSource.Native,
            Rooms = rooms,
            TotalSqft = rooms.Sum(room => room.RawSqft),
        };
        var directory = Path.GetFullPath(takeoffDirectory);
        Directory.CreateDirectory(directory);
        var path = Path.Combine(directory, $"rooms_{Sanitize(level.Name)}.native.tsv");
        var temp = Path.Combine(directory, $".{Path.GetFileName(path)}.{Guid.NewGuid():N}.tmp");
        try
        {
            File.WriteAllText(temp, result.ToTsv());
            if (File.Exists(path)) File.Replace(temp, path, null);
            else File.Move(temp, path);
        }
        finally
        {
            if (File.Exists(temp)) File.Delete(temp);
        }

        log($"[native-readback] level='{level.Name}' phase='{phase.Name}' spaces={rooms.Count} " +
            $"skippedUnplaced={skippedUnplaced} skippedUnenclosed={skippedUnenclosed} -> {path}");
        return new NativeReadbackResult(rooms.Count, skippedUnplaced, skippedUnenclosed, path);
    }

    /// <summary>
    /// Runs after the materialization transaction commits, when Revit has recomputed the native
    /// Space boundaries. Deletes only owned Spaces that fail the canonical editability audit.
    /// </summary>
    public static NativeEditabilityGateResult PruneUneditableNative(
        Document doc, Level level, Phase phase, TakeoffOptions opt, Action<string> log)
    {
        string token = SpaceMaterializer.Token(opt, level, phase);
        var spaces = new FilteredElementCollector(doc).OfClass(typeof(SpatialElement))
            .OfCategory(BuiltInCategory.OST_MEPSpaces).Cast<Space>()
            .Where(space => space.LevelId.Value() == level.Id.Value()
                            && space.get_Parameter(BuiltInParameter.ROOM_PHASE_ID)
                                ?.AsElementId().Value() == phase.Id.Value()
                            && SpaceMaterializer.Owned(space, token))
            .OrderBy(space => space.Number, StringComparer.Ordinal)
            .ToList();
        if (spaces.Select(space => space.Number).Distinct(StringComparer.Ordinal).Count() != spaces.Count)
            throw new InvalidOperationException("owned native Space numbers must be unique");

        var malformed = new Dictionary<string, IReadOnlyList<EditabilityViolationKind>>(StringComparer.Ordinal);
        var shapes = new List<TakeoffRoomShape>();
        foreach (var space in spaces)
        {
            var loops = space.GetBoundarySegments(new SpatialElementBoundaryOptions());
            var points = loops?.Select(BoundaryPoints)
                .Where(loop => loop.Count >= 3)
                .OrderByDescending(loop => Math.Abs(TakeoffTsv.SignedArea(loop)))
                .ToList();
            if (space.Area <= 0 || points is not { Count: > 0 })
            {
                malformed[space.Number] = [EditabilityViolationKind.InvalidLoop];
                continue;
            }
            shapes.Add(new TakeoffRoomShape(
                space.Number, space.Area,
                loops!.SelectMany(segments => segments).Sum(segment => segment.GetCurve().Length),
                space.LimitOffset, points[0], points.Skip(1).ToList()));
        }

        var audit = TakeoffEditability.Evaluate(new LevelTakeoff(level.Name, level.ProjectElevation, shapes));
        var rejected = audit.Rooms.Where(room => !room.IsStrictlyEditable)
            .ToDictionary(
                room => room.RoomId,
                room => (IReadOnlyList<EditabilityViolationKind>)room.Violations
                    .Select(violation => violation.Kind).Distinct().OrderBy(kind => kind).ToList(),
                StringComparer.Ordinal);
        foreach (var item in malformed) rejected[item.Key] = item.Value;
        if (rejected.Count > 0)
        {
            doc.Delete(spaces.Where(space => rejected.ContainsKey(space.Number))
                .Select(space => space.Id).ToList());
            doc.Regenerate();
        }
        log($"[native-gate] level='{level.Name}' phase='{phase.Name}' reviewed={spaces.Count} " +
            $"retained={spaces.Count - rejected.Count} rejected={rejected.Count}" +
            (rejected.Count == 0 ? "" : " " + string.Join(" ", rejected.Select(item =>
                $"{item.Key}:{string.Join("+", item.Value)}"))));
        return new NativeEditabilityGateResult(
            spaces.Count, spaces.Count - rejected.Count, rejected.Count, rejected);
    }

    internal static List<double[]> BoundaryPoints(IEnumerable<BoundarySegment> segments)
    {
        var points = new List<double[]>();
        foreach (var segment in segments)
        {
            var tessellation = segment.GetCurve().Tessellate();
            for (int i = 0; i < tessellation.Count - 1; i++)
                points.Add(new[] { tessellation[i].X, tessellation[i].Y });
        }
        return points;
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

    public static int Cleanup(Document doc, Action<string> log, TakeoffOptions? optOverride = null)
    {
        var opt = optOverride ?? new TakeoffOptions();
        return SpaceMaterializer.Cleanup(doc, opt, log) + Takeoff.Annotate.Cleanup(doc, opt, log);
    }

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

    private static void SaveState(TakeoffOptions opt, Level level, BoundingBoxXYZ crop, string va, string va2, string vb, string? vd)
    {
        var ic = CultureInfo.InvariantCulture;
        var lines = new List<string> {
            $"minx={crop.Min.X.ToString("F6", ic)}", $"miny={crop.Min.Y.ToString("F6", ic)}",
            $"maxx={crop.Max.X.ToString("F6", ic)}", $"maxy={crop.Max.Y.ToString("F6", ic)}",
            $"minz={crop.Min.Z.ToString("F6", ic)}", $"maxz={crop.Max.Z.ToString("F6", ic)}",
            $"viewA={va}", $"viewA2={va2}", $"viewB={vb}",
        };
        if (vd != null) lines.Add($"viewD={vd}");
        File.WriteAllLines(StatePath(opt, level), lines);
    }

    private static (BoundingBoxXYZ crop, string va, string va2, string vb, string? vd) LoadState(TakeoffOptions opt, Level level)
    {
        var path = StatePath(opt, level);
        if (!File.Exists(path)) throw new InvalidOperationException($"no takeoff state at {path} — run Prepare first");
        var kv = File.ReadAllLines(path).Select(l => l.Split(new[] { '=' }, 2))
            .Where(p => p.Length == 2).ToDictionary(p => p[0], p => p[1]);
        if (!kv.ContainsKey("viewA2"))
            throw new InvalidOperationException("takeoff state predates the band-pair seed — run Prepare again");
        double G(string k) => double.Parse(kv[k], CultureInfo.InvariantCulture);
        var crop = new BoundingBoxXYZ { Min = new XYZ(G("minx"), G("miny"), G("minz")), Max = new XYZ(G("maxx"), G("maxy"), G("maxz")) };
        return (crop, kv["viewA"], kv["viewA2"], kv["viewB"], kv.GetValueOrDefault("viewD"));
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

    internal static MaterializationResolutionResult LoadMaterializationResult(
        string takeoffDirectory,
        string levelName,
        string? resolutionsPath = null
    )
    {
        var resolved = TakeoffTsv.ParseTsvDirectory(takeoffDirectory, resolutionsPath);
        var level = resolved.Levels.Single(item => item.LevelName == levelName);
        var takeoff = new TakeoffResult {
            LevelName = level.LevelName,
            LevelElevation = level.Elevation,
            Rooms = level.Rooms.Select(room => new RoomResult {
                Id = room.Id,
                RawSqft = room.RawSqft,
                PerimeterFt = room.PerimeterFt,
                MeanCeilingFt = room.MeanCeilingFt,
                Polygon = room.Outer,
                Holes = room.Holes,
                Flags = room.Flags,
                LabelX = room.Label[0],
                LabelY = room.Label[1],
                SplitFrom = room.SplitFrom,
                MergedFrom = room.MergedFrom,
            }).ToList(),
            Residues = level.Residues.Select(residue => new ResidueResult {
                Id = residue.Id,
                Reason = residue.Reason,
                RawSqft = residue.RawSqft,
                MeanCeilingFt = residue.MeanCeilingFt,
                LabelX = residue.Label[0],
                LabelY = residue.Label[1],
                Polygon = residue.Outer,
                Holes = residue.Holes,
            }).ToList(),
        };
        takeoff.TotalSqft = takeoff.Rooms.Sum(room => room.RawSqft);
        return new MaterializationResolutionResult(
            takeoff, resolved.Applied, resolved.Remapped, resolved.Orphaned);
    }
}
