namespace Pe.Revit.Takeoff;

internal sealed record ZoneDomainLossComponent(
    double AreaSqft,
    IReadOnlyList<List<double[]>> Polygons);

internal sealed record ZoneDomainHeldCandidate(
    string Id,
    double AreaSqft,
    IReadOnlyList<List<double[]>> Polygons);

internal sealed record ZoneDomainDiagnostics(
    double PreparedDomainSqft,
    double CropRecomputedDomainSqft,
    IReadOnlyList<ZoneDomainLossComponent> LostComponents,
    IReadOnlyList<ZoneDomainHeldCandidate> HeldCandidates,
    string? ExclusionProvenance);

internal sealed class PreparedTakeoffDetection
{
    private readonly Heightfield field;
    private readonly bool[] obstruction;
    private readonly bool[] footprint;
    private readonly float[] evidence;
    private readonly string levelName;
    private readonly double levelElevation;
    private readonly TakeoffOptions options;

    internal PreparedTakeoffDetection(
        Heightfield field, bool[] obstruction, bool[] footprint, float[] evidence,
        string levelName, double levelElevation, TakeoffOptions options)
    {
        this.field = field;
        this.obstruction = obstruction;
        this.footprint = footprint;
        this.evidence = evidence;
        this.levelName = levelName;
        this.levelElevation = levelElevation;
        this.options = options;
    }

    internal TakeoffResult Detect(bool[]? zoneMask, Action<string> log) =>
        PartitionFormulation.Run(
            this.field, this.obstruction, this.levelName, this.levelElevation, this.options,
            log, zoneMask, this.footprint, this.evidence);

    internal TakeoffResult Detect(ZoneScope zone, Action<string> log) =>
        this.Detect(zone, log, out _);

    /// <summary>
    /// Detects inside one declared zone. <c>whiteoutCells</c> reports the ink cells the per-zone
    /// hygiene pass removed — zero unless <see cref="TakeoffOptions.InkClusterWhiteoutCells"/> is
    /// on, so the artifact can say how much raster the run deleted before solving.
    /// </summary>
    internal TakeoffResult Detect(ZoneScope zone, Action<string> log, out int whiteoutCells)
    {
        return this.DetectCore(zone, log, out whiteoutCells, out _, collectDiagnostics: false);
    }

    internal TakeoffResult Detect(
        ZoneScope zone,
        Action<string> log,
        out int whiteoutCells,
        out ZoneDomainDiagnostics diagnostics)
    {
        return this.DetectCore(
            zone, log, out whiteoutCells, out diagnostics, collectDiagnostics: true);
    }

    private TakeoffResult DetectCore(
        ZoneScope zone,
        Action<string> log,
        out int whiteoutCells,
        out ZoneDomainDiagnostics diagnostics,
        bool collectDiagnostics)
    {
        whiteoutCells = 0;
        diagnostics = collectDiagnostics
            ? new ZoneDomainDiagnostics(0, 0, [], [], null)
            : null!;
        if (zone == null) throw new ArgumentNullException(nameof(zone));
        const int paddingCells = 2;
        var points = zone.Loops.SelectMany(loop => loop).ToList();
        int x0 = Math.Max(0, (int)Math.Floor(
            (points.Min(point => point[0]) - this.field.MinX) / this.field.CellFt) - paddingCells);
        int y0 = Math.Max(0, (int)Math.Floor(
            (points.Min(point => point[1]) - this.field.MinY) / this.field.CellFt) - paddingCells);
        int x1 = Math.Min(this.field.W, (int)Math.Ceiling(
            (points.Max(point => point[0]) - this.field.MinX) / this.field.CellFt) + paddingCells);
        int y1 = Math.Min(this.field.H, (int)Math.Ceiling(
            (points.Max(point => point[1]) - this.field.MinY) / this.field.CellFt) + paddingCells);
        if (x1 <= x0 || y1 <= y0)
            return new TakeoffResult {
                LevelName = this.levelName,
                LevelElevation = this.levelElevation,
            };

        int width = x1 - x0, height = y1 - y0;
        var croppedField = new Heightfield {
            W = width,
            H = height,
            MinX = this.field.MinX + x0 * this.field.CellFt,
            MinY = this.field.MinY + y0 * this.field.CellFt,
            CellFt = this.field.CellFt,
            FloorZ = Crop(this.field.FloorZ),
            CeilZ = Crop(this.field.CeilZ),
        };
        var croppedObstruction = Crop(this.obstruction);
        var preparedFootprint = Crop(this.footprint);
        bool[]? croppedFootprint = preparedFootprint;
        float[]? croppedEvidence = Crop(this.evidence);
        var croppedMask = zone.CellMask(croppedField);
        log($"[partition] zone crop {this.field.W}x{this.field.H} -> {width}x{height}");
        // Pre-solve hygiene. The obstruction raster is built once per LEVEL by Prepare, so the zone
        // crop is the only per-zone seam there is; whiting out here also means the clusters have
        // already been gap-sealed, which is the honest thing to test for "floats free of the wall
        // network". A removal invalidates the level-derived footprint and evidence rasters, so both
        // are recomputed from the cleaned obstruction — otherwise the whited clutter would leave a
        // hole in the domain instead of joining the room around it.
        if (this.options.InkClusterWhiteoutCells > 0)
        {
            var hygiene = InkHygiene.RemoveFloatingClusters(
                croppedObstruction, croppedMask, width, height,
                this.options.InkClusterWhiteoutCells);
            whiteoutCells = hygiene.RemovedCells;
            if (hygiene.RemovedCells > 0)
            {
                croppedObstruction = hygiene.Ink;
                if (collectDiagnostics)
                {
                    var recomputedFootprint = Detector.InkBoundedFloor(
                        croppedField, croppedObstruction, this.levelElevation, this.options.FloorTolFt);
                    diagnostics = CompareDomains(
                        croppedField, croppedMask, preparedFootprint, recomputedFootprint);
                }
                croppedFootprint = null;
                croppedEvidence = null;
                log($"[partition] ink hygiene whited out {hygiene.RemovedCells} floating cell(s) " +
                    $"= {hygiene.RemovedCells * this.field.CellFt * this.field.CellFt:F0}sf");
            }
        }
        if (collectDiagnostics && whiteoutCells == 0)
            diagnostics = CompareDomains(
                croppedField, croppedMask, preparedFootprint, preparedFootprint);
        return PartitionFormulation.Run(
            croppedField, croppedObstruction, this.levelName, this.levelElevation, this.options,
            log, croppedMask, croppedFootprint, croppedEvidence);

        T[] Crop<T>(T[] source)
        {
            var cropped = new T[width * height];
            for (int y = 0; y < height; y++)
                Array.Copy(source, (y0 + y) * this.field.W + x0,
                    cropped, y * width, width);
            return cropped;
        }

        ZoneDomainDiagnostics CompareDomains(
            Heightfield domainField,
            bool[] zoneDomainMask,
            bool[] prepared,
            bool[] recomputed)
        {
            var preparedDomain = PartitionFormulation.BuildDomain(
                domainField, this.levelElevation, this.options, prepared);
            var recomputedDomain = PartitionFormulation.BuildDomain(
                domainField, this.levelElevation, this.options, recomputed);
            for (int i = 0; i < preparedDomain.Length; i++)
            {
                preparedDomain[i] &= zoneDomainMask[i];
                recomputedDomain[i] &= zoneDomainMask[i];
            }

            double cellArea = domainField.CellFt * domainField.CellFt;
            var lost = new bool[preparedDomain.Length];
            for (int i = 0; i < lost.Length; i++)
                lost[i] = preparedDomain[i] && !recomputedDomain[i];
            var labels = new int[lost.Length];
            var components = new List<(int Start, ZoneDomainLossComponent Component)>();
            var queue = new Queue<int>();
            int id = 0;
            for (int start = 0; start < lost.Length; start++)
            {
                if (!lost[start] || labels[start] != 0) continue;
                id++;
                labels[start] = id;
                queue.Enqueue(start);
                var cells = new List<int>();
                while (queue.Count > 0)
                {
                    int cell = queue.Dequeue();
                    cells.Add(cell);
                    int x = cell % domainField.W, y = cell / domainField.W;
                    Add(x - 1, y);
                    Add(x + 1, y);
                    Add(x, y - 1);
                    Add(x, y + 1);
                }
                var polygons = Detector.TraceLoops(
                        cells, labels, id, domainField.W, domainField.H)
                    .Select(loop => Detector.CollapseCollinear(loop.Select(point => new[] {
                        domainField.MinX + point.x * domainField.CellFt,
                        domainField.MinY + point.y * domainField.CellFt,
                    }).ToList()))
                    .Where(polygon => polygon.Count >= 3)
                    .ToList();
                components.Add((start,
                    new ZoneDomainLossComponent(cells.Count * cellArea, polygons)));

                void Add(int x, int y)
                {
                    if (x < 0 || x >= domainField.W || y < 0 || y >= domainField.H) return;
                    int neighbor = y * domainField.W + x;
                    if (!lost[neighbor] || labels[neighbor] != 0) return;
                    labels[neighbor] = id;
                    queue.Enqueue(neighbor);
                }
            }
            var ordered = components
                .OrderByDescending(item => item.Component.AreaSqft)
                .ThenBy(item => item.Start)
                .Select(item => item.Component)
                .ToList();
            var heldCandidates = DomainRefloodHeldCandidates(
                ordered, this.levelName, this.levelElevation, this.options,
                zone.ExactGeometry());
            return new ZoneDomainDiagnostics(
                preparedDomain.Count(value => value) * cellArea,
                recomputedDomain.Count(value => value) * cellArea,
                ordered,
                heldCandidates,
                ordered.Count == 0 ? null : "crop-reflood");
        }
    }

    internal static IReadOnlyList<ZoneDomainHeldCandidate> DomainRefloodHeldCandidates(
        IReadOnlyList<ZoneDomainLossComponent> components,
        string levelName,
        double levelElevation,
        TakeoffOptions options,
        NetTopologySuite.Geometries.Geometry? declaredZone = null)
    {
        var candidates = new List<ZoneDomainHeldCandidate>();
        for (int index = 0; index < components.Count; index++)
        {
            var component = components[index];
            if (component.AreaSqft < options.MinimumPromotedRoomSqft
                || component.Polygons.Count != 1)
                continue;
            var room = new RoomResult {
                Id = $"CROP-REFLOOD-HELD:{index + 1}",
                RawSqft = component.AreaSqft,
                Polygon = component.Polygons[0].Select(point => (double[])point.Clone()).ToList(),
            };
            try
            {
                var polygon = TakeoffGeometry.ToPolygon(room);
                if (!polygon.IsValid || polygon.IsEmpty) continue;
                room.PerimeterFt = polygon.Length;
                room.LabelX = polygon.InteriorPoint.X;
                room.LabelY = polygon.InteriorPoint.Y;
                var source = new TakeoffResult {
                    LevelName = levelName,
                    LevelElevation = levelElevation,
                    DomainSqft = component.AreaSqft,
                    TotalSqft = component.AreaSqft,
                    Rooms = { room },
                };
                var projected = FrameLocalProjector.Project(
                    source, FrameLocalKnobs.From(options), declaredZone);
                if (projected.Accepted.Rooms.Count != 1) continue;
                var accepted = projected.Accepted.Rooms[0];
                var acceptedPolygon = TakeoffGeometry.ToPolygon(accepted);
                // This is a conservative crop-reflood review admission, not a claim that rooms
                // are generally convex. Concavity here has no surviving ownership evidence.
                if (acceptedPolygon.ConvexHull().Area - acceptedPolygon.Area
                    > 1d / TakeoffGeometry.CoverageScale)
                    continue;
                candidates.Add(new ZoneDomainHeldCandidate(
                    room.Id, accepted.RawSqft,
                    new[] { accepted.Polygon }.Concat(accepted.Holes).ToList()));
            }
            catch (InvalidOperationException)
            {
                // Malformed diagnostic geometry is not reviewable room geometry.
            }
        }
        return candidates;
    }
}

// Detection core. INK DEFINES BOUNDARY EVIDENCE; PHYSICS DEFINES THE PARTITION DOMAIN.
// Everything here is pure computation over the heightfield + ink rasters. DetectSnapshot persists
// exactly these inputs so partition changes iterate offline against real captured state.
public static class Detector
{
    internal static PreparedTakeoffDetection Prepare(
        Heightfield hf, bool[] seedInk, string levelName, double levelElevation,
        TakeoffOptions opt, Action<string> log)
    {
        var obstruction = BuildObstruction(hf, seedInk, levelElevation, opt, log);
        var footprint = InkBoundedFloor(hf, obstruction, levelElevation, opt.FloorTolFt);
        var evidence = PartitionFormulation.BuildEvidence(hf, obstruction, opt);
        return new PreparedTakeoffDetection(
            hf, obstruction, footprint, evidence, levelName, levelElevation, opt);
    }

    public static TakeoffResult Detect(
        Heightfield hf, bool[] seedInk, string levelName, double levelElevation,
        TakeoffOptions opt, Action<string> log, bool[]? zoneMask = null)
    {
        var obst = BuildObstruction(hf, seedInk, levelElevation, opt, log);
        return PartitionFormulation.Run(hf, obst, levelName, levelElevation, opt, log, zoneMask);
    }

    // Per-cell attribution of the sealing passes in BuildObstruction. A cell carries exactly one
    // class: the passes run in order and each only ever claims cells no earlier pass sealed.
    public const byte SealNone = 0;

    /// <summary>Cell became obstruction from the <see cref="TakeoffOptions.GapSealFt"/> morphological close.</summary>
    public const byte SealGapClose = 1;

    /// <summary>Cell became obstruction from the door-head lintel sealer (<see cref="TakeoffOptions.SealDoorHeads"/>).</summary>
    public const byte SealDoorHead = 2;

    /// <summary>Cell became obstruction from the headerless wall-run gap sealer (<see cref="TakeoffOptions.SealWallRunGaps"/>).</summary>
    public const byte SealWallRunGap = 3;

    /// <summary>
    /// Cell sealed by the door-head pass but belonging to a connected lintel component wider than
    /// a plausible door (<see cref="TakeoffOptions.DoorHeadMaxComponentFt"/>): a duct soffit, low
    /// slab, or ceiling step, not a doorway. Only the wall-adjacent fringe of such a component
    /// seals (closure the partition may use); it is NOT model-door evidence and must not back a
    /// room boundary the way <see cref="SealDoorHead"/> does.
    /// </summary>
    public const byte SealDoorHeadOversize = 4;

    /// <summary>
    /// The sealing decisions BuildObstruction makes, as a reviewable raster: one class byte per
    /// cell, zero everywhere the obstruction mask is just raw seed ink. Closures are otherwise
    /// invisible in review — a sealed doorway looks exactly like a drawn wall downstream.
    /// </summary>
    public static byte[] SealClasses(
        Heightfield hf, bool[] seedInk, double levelElevation, TakeoffOptions opt)
    {
        BuildObstruction(hf, seedInk, levelElevation, opt, _ => { }, out var classes);
        return classes;
    }

    // Shared by detection, level-profile inference, and diagnostics: composed seed ink -> sealed
    // obstruction mask (stud-gap close + geometric door sealers).
    internal static bool[] BuildObstruction(
        Heightfield hf, bool[] seedInk, double lvlZ, TakeoffOptions opt, Action<string> log) =>
        BuildObstruction(hf, seedInk, lvlZ, opt, log, out _);

    internal static bool[] BuildObstruction(
        Heightfield hf, bool[] seedInk, double lvlZ, TakeoffOptions opt, Action<string> log,
        out byte[] sealClass)
    {
        int W = hf.W, H = hf.H, n = W * H;
        var obst = (bool[])seedInk.Clone();
        Close(obst, W, H, (float)(opt.GapSealFt / 2.0 / opt.CellFt));
        sealClass = new byte[n];
        for (int i = 0; i < n; i++)
            if (obst[i] && !seedInk[i]) sealClass[i] = SealGapClose;

        if (opt.SealDoorHeads)
        {
            // Lintel cells: low covered headroom with a markedly taller covered cell nearby. The
            // "nearby" dilation covers the doorway strip depth (wall thickness) at CellFt scale.
            var tallCore = new bool[n];
            for (int i = 0; i < n; i++)
                tallCore[i] = !float.IsNaN(hf.FloorZ[i]) && !float.IsNaN(hf.CeilZ[i])
                              && hf.CeilZ[i] - hf.FloorZ[i] > opt.DoorHeadMaxFt + opt.DoorHeadContrastFt;
            var dist = Chamfer(tallCore, W, H, false);
            var cand = new bool[n];
            for (int i = 0; i < n; i++)
            {
                if (obst[i] || dist[i] > 3f + 1e-4f) continue;
                if (float.IsNaN(hf.FloorZ[i]) || float.IsNaN(hf.CeilZ[i])) continue;
                double head = hf.CeilZ[i] - hf.FloorZ[i];
                cand[i] = head >= opt.MinHeadroomFt && head <= opt.DoorHeadMaxFt;
            }
            // Door-width bound: the lintel predicate alone cannot tell a doorway from a duct
            // soffit or a low basement slab — both are "low covered headroom near taller cover".
            // A doorway lintel is a compact component; sealing an oversized component wholesale
            // turns a soffit crossing a room into a wall (LL08: one 255 sf component, ~34x54 ft
            // bbox). Oversized components keep only their wall-adjacent fringe (within GapSealFt
            // of pre-existing obstruction) so doorways *under* a soffit still close, and carry a
            // distinct class so they can be excluded from backing evidence.
            var wallDist = Chamfer(obst, W, H, false);
            float fringeCells = (float)(opt.GapSealFt / opt.CellFt) + 1e-4f;
            var comp = new int[n];
            int sealedDoor = 0, sealedFringe = 0, droppedCells = 0, oversizeComponents = 0;
            var stack = new Stack<int>();
            var members = new List<int>();
            for (int i = 0; i < n; i++)
            {
                if (!cand[i] || comp[i] != 0) continue;
                members.Clear();
                int minX = int.MaxValue, minY = int.MaxValue, maxX = -1, maxY = -1;
                stack.Push(i);
                comp[i] = 1;
                while (stack.Count > 0)
                {
                    int c = stack.Pop();
                    int cx = c % W, cy = c / W;
                    members.Add(c);
                    minX = Math.Min(minX, cx); minY = Math.Min(minY, cy);
                    maxX = Math.Max(maxX, cx); maxY = Math.Max(maxY, cy);
                    for (int dy = -1; dy <= 1; dy++)
                    for (int dx = -1; dx <= 1; dx++)
                    {
                        if (dx == 0 && dy == 0) continue;
                        int nx = cx + dx, ny = cy + dy;
                        if (nx < 0 || nx >= W || ny < 0 || ny >= H) continue;
                        int ni = ny * W + nx;
                        if (cand[ni] && comp[ni] == 0) { comp[ni] = 1; stack.Push(ni); }
                    }
                }
                double maxDimFt = Math.Max(maxX - minX + 1, maxY - minY + 1) * opt.CellFt;
                if (maxDimFt <= opt.DoorHeadMaxComponentFt)
                {
                    foreach (int c in members) { obst[c] = true; sealClass[c] = SealDoorHead; }
                    sealedDoor += members.Count;
                }
                else
                {
                    oversizeComponents++;
                    foreach (int c in members)
                    {
                        if (wallDist[c] <= fringeCells)
                        {
                            obst[c] = true;
                            sealClass[c] = SealDoorHeadOversize;
                            sealedFringe++;
                        }
                        else droppedCells++;
                    }
                }
            }
            double cellSf = opt.CellFt * opt.CellFt;
            log($"[detect] door-head seal: {sealedDoor * cellSf:F0} sf of lintel cells became obstruction; " +
                $"{oversizeComponents} oversize components (> {opt.DoorHeadMaxComponentFt:F1} ft) kept " +
                $"{sealedFringe * cellSf:F0} sf wall fringe, dropped {droppedCells * cellSf:F0} sf");
        }

        if (opt.SealWallRunGaps)
        {
            // Headerless doorways (framing models): a gap counts as a door only when it is a short
            // colinear break between two solid ink runs. Scanning H, V and both diagonals covers
            // rotated wings; diagonal walls >= 2 cells thick stay contiguous along 45-degree lines.
            var filled = new bool[n];
            void Scan(int sx, int sy, int dx, int dy)
            {
                // Thresholds are declared in FEET along the scan line. A diagonal step spans
                // cell*sqrt(2), so cell-count thresholds must shrink accordingly or diagonal
                // scans bridge DoorGapMaxFt*sqrt(2) where DoorGapMaxFt was declared.
                double stepFt = opt.CellFt * (dx != 0 && dy != 0 ? Math.Sqrt(2.0) : 1.0);
                int maxGap = (int)Math.Round(opt.DoorGapMaxFt / stepFt);
                int minRun = (int)Math.Round(opt.DoorJambMinFt / stepFt);
                int x = sx, y = sy;
                var line = new List<int>();
                while (x >= 0 && x < W && y >= 0 && y < H) { line.Add(y * W + x); x += dx; y += dy; }
                int i0 = 0;
                var segs = new List<(bool Ink, int Start, int Len)>();
                while (i0 < line.Count)
                {
                    bool ink = obst[line[i0]];
                    int j = i0;
                    while (j < line.Count && obst[line[j]] == ink) j++;
                    segs.Add((ink, i0, j - i0));
                    i0 = j;
                }
                for (int s = 1; s + 1 < segs.Count; s++)
                {
                    var (ink, start, len) = segs[s];
                    if (ink || len > maxGap) continue;
                    if (segs[s - 1].Len >= minRun && segs[s + 1].Len >= minRun)
                        for (int k = start; k < start + len; k++) filled[line[k]] = true;
                }
            }
            for (int y = 0; y < H; y++) Scan(0, y, 1, 0);
            for (int x = 0; x < W; x++) Scan(x, 0, 0, 1);
            for (int x = 0; x < W; x++) Scan(x, 0, 1, 1);
            for (int y = 1; y < H; y++) Scan(0, y, 1, 1);
            for (int x = 0; x < W; x++) Scan(x, 0, -1, 1);
            for (int y = 1; y < H; y++) Scan(W - 1, y, -1, 1);
            int nFilled = 0;
            for (int i = 0; i < n; i++)
                if (filled[i] && !obst[i]) { obst[i] = true; sealClass[i] = SealWallRunGap; nFilled++; }
            log($"[detect] wall-run gap seal: {nFilled * opt.CellFt * opt.CellFt:F0} sf of doorway gaps became obstruction");
        }
        return obst;
    }

    // The plan-sealed, same-level floor footprint. Flooding from the raster boundary identifies
    // everything architecturally outside; floor surfaces cannot establish existence by themselves.
    internal static bool[] InkBoundedFloor(
        Heightfield hf, bool[] obstruction, double levelElevation, double floorTolFt)
    {
        int W = hf.W, H = hf.H, n = W * H;
        if (obstruction.Length != n)
            throw new ArgumentException($"obstruction disagrees with {W}x{H}");
        var outside = new bool[n];
        var queue = new Queue<int>();
        void Add(int i)
        {
            if (obstruction[i] || outside[i]) return;
            outside[i] = true;
            queue.Enqueue(i);
        }
        for (int x = 0; x < W; x++) { Add(x); Add((H - 1) * W + x); }
        for (int y = 1; y + 1 < H; y++) { Add(y * W); Add(y * W + W - 1); }
        while (queue.Count > 0)
        {
            int i = queue.Dequeue(), x = i % W, y = i / W;
            if (x > 0) Add(i - 1);
            if (x + 1 < W) Add(i + 1);
            if (y > 0) Add(i - W);
            if (y + 1 < H) Add(i + W);
        }

        var footprint = new bool[n];
        for (int i = 0; i < n; i++)
            footprint[i] = !outside[i] && !float.IsNaN(hf.FloorZ[i])
                           && Math.Abs(hf.FloorZ[i] - levelElevation) <= floorTolFt;
        return footprint;
    }

    // ---- morphology: two-pass chamfer close (dilate r then erode r) ----
    private static void Close(bool[] mask, int W, int H, float rCells)
    {
        var d1 = Chamfer(mask, W, H, false);
        var dil = new bool[W * H];
        for (int i = 0; i < W * H; i++) dil[i] = d1[i] <= rCells + 1e-4f;
        var d2 = Chamfer(dil, W, H, true);
        for (int i = 0; i < W * H; i++) mask[i] = d2[i] > rCells - 1e-4f;
    }

    internal static float[] Chamfer(bool[] mask, int W, int H, bool invert)
    {
        const float INF = 1e9f, DIAG = 1.4142f;
        var d = new float[W * H];
        for (int i = 0; i < W * H; i++) d[i] = mask[i] != invert ? 0f : INF;
        for (int y = 0; y < H; y++)
            for (int x = 0; x < W; x++)
            {
                int i = y * W + x; float v = d[i];
                if (x > 0) v = Math.Min(v, d[i - 1] + 1);
                if (y > 0) v = Math.Min(v, d[i - W] + 1);
                if (x > 0 && y > 0) v = Math.Min(v, d[i - W - 1] + DIAG);
                if (x < W - 1 && y > 0) v = Math.Min(v, d[i - W + 1] + DIAG);
                d[i] = v;
            }
        for (int y = H - 1; y >= 0; y--)
            for (int x = W - 1; x >= 0; x--)
            {
                int i = y * W + x; float v = d[i];
                if (x < W - 1) v = Math.Min(v, d[i + 1] + 1);
                if (y < H - 1) v = Math.Min(v, d[i + W] + 1);
                if (x < W - 1 && y < H - 1) v = Math.Min(v, d[i + W + 1] + DIAG);
                if (x > 0 && y < H - 1) v = Math.Min(v, d[i + W - 1] + DIAG);
                d[i] = v;
            }
        return d;
    }

    // ---- exact cell-boundary loop tracing (region on the left: outer CCW, holes CW) ----
    internal static List<List<(int x, int y)>> TraceLoops(List<int> cells, int[] label, int id, int W, int H)
    {
        var edges = new Dictionary<long, List<long>>();
        void Add(int ax, int ay, int bx, int by)
        {
            long k = (long)ax << 24 | (uint)ay, e = (long)bx << 24 | (uint)by;
            if (!edges.TryGetValue(k, out var lst)) { lst = new List<long>(); edges[k] = lst; }
            lst.Add(e);
        }
        foreach (int c in cells)
        {
            int x = c % W, y = c / W;
            if (y == 0 || label[c - W] != id) Add(x, y, x + 1, y);
            if (x == W - 1 || label[c + 1] != id) Add(x + 1, y, x + 1, y + 1);
            if (y == H - 1 || label[c + W] != id) Add(x + 1, y + 1, x, y + 1);
            if (x == 0 || label[c - 1] != id) Add(x, y + 1, x, y);
        }
        var loops = new List<List<(int, int)>>();
        while (edges.Count > 0)
        {
            long start = edges.Keys.First(), cur = start;
            var loop = new List<(int, int)>();
            int pdx = 0, pdy = 0;
            while (true)
            {
                if (!edges.TryGetValue(cur, out var outs) || outs.Count == 0) break;
                long next = outs[0];
                if (outs.Count > 1)
                {
                    int bestScore = -9;
                    foreach (var cand in outs)
                    {
                        int cx = (int)(cand >> 24), cy = (int)(cand & 0xFFFFFF);
                        int sx = (int)(cur >> 24), sy = (int)(cur & 0xFFFFFF);
                        int dx = Math.Sign(cx - sx), dy = Math.Sign(cy - sy);
                        int cross = pdx * dy - pdy * dx, dot = pdx * dx + pdy * dy;
                        int score = cross > 0 ? 3 : cross == 0 && dot > 0 ? 2 : cross < 0 ? 1 : 0;
                        if (score > bestScore) { bestScore = score; next = cand; }
                    }
                }
                outs.Remove(next);
                if (outs.Count == 0) edges.Remove(cur);
                int nx = (int)(next >> 24), ny = (int)(next & 0xFFFFFF);
                int px = (int)(cur >> 24), py = (int)(cur & 0xFFFFFF);
                pdx = Math.Sign(nx - px); pdy = Math.Sign(ny - py);
                loop.Add((nx, ny));
                cur = next;
                if (cur == start) break;
            }
            if (loop.Count >= 4) loops.Add(loop);
        }
        return loops;
    }

    internal static List<double[]> CollapseCollinear(List<double[]> pts)
    {
        var o = new List<double[]>();
        int m = pts.Count;
        for (int i = 0; i < m; i++)
        {
            var a = pts[(i + m - 1) % m]; var b = pts[i]; var c = pts[(i + 1) % m];
            double cross = (b[0] - a[0]) * (c[1] - b[1]) - (b[1] - a[1]) * (c[0] - b[0]);
            if (Math.Abs(cross) > 1e-9) o.Add(b);
        }
        return o;
    }

    internal static double Shoelace(List<double[]> p)
    {
        double s = 0; int m = p.Count;
        for (int i = 0; i < m; i++) { var a = p[i]; var b = p[(i + 1) % m]; s += a[0] * b[1] - b[0] * a[1]; }
        return s / 2;
    }

    // chamfer distance-transform argmax inside the region = pole of inaccessibility; guaranteed
    // interior even for L-shaped rooms (a centroid is not).
    internal static int PoleOfInaccessibility(List<int> cells, int[] label, int id, int W, int H)
    {
        int bx0 = W, by0 = H, bx1 = 0, by1 = 0;
        foreach (int c in cells) { int cx = c % W, cy = c / W; if (cx < bx0) bx0 = cx; if (cx > bx1) bx1 = cx; if (cy < by0) by0 = cy; if (cy > by1) by1 = cy; }
        int lw = bx1 - bx0 + 1, lh = by1 - by0 + 1;
        const float INF = 1e9f;
        var d = new float[lw * lh];
        for (int y = 0; y < lh; y++)
            for (int x = 0; x < lw; x++)
                d[y * lw + x] = label[(y + by0) * W + (x + bx0)] == id ? INF : 0f;
        for (int y = 0; y < lh; y++)
            for (int x = 0; x < lw; x++)
            {
                int i = y * lw + x; float v = d[i];
                if (v == 0) continue;
                v = Math.Min(v, x > 0 ? d[i - 1] + 1 : 0.5f);
                v = Math.Min(v, y > 0 ? d[i - lw] + 1 : 0.5f);
                if (x > 0 && y > 0) v = Math.Min(v, d[i - lw - 1] + 1.4142f);
                d[i] = v;
            }
        int bi = cells[0]; float bv = -1;
        for (int y = lh - 1; y >= 0; y--)
            for (int x = lw - 1; x >= 0; x--)
            {
                int i = y * lw + x; float v = d[i];
                if (v == 0) continue;
                v = Math.Min(v, x < lw - 1 ? d[i + 1] + 1 : 0.5f);
                v = Math.Min(v, y < lh - 1 ? d[i + lw] + 1 : 0.5f);
                if (x < lw - 1 && y < lh - 1) v = Math.Min(v, d[i + lw + 1] + 1.4142f);
                d[i] = v;
                if (v > bv) { bv = v; bi = (y + by0) * W + (x + bx0); }
            }
        return bi;
    }
}
