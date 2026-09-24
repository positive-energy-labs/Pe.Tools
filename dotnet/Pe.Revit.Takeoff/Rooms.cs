using System.Security.Cryptography;
using Pe.Revit.Space;
using PartitionVerbs = Pe.Revit.Partition.Verbs;

namespace Pe.Revit.Takeoff;

/// <summary>What a /rooms rerun does to the regions already on the level scope.</summary>
public sealed record RoomsPlan(
    IReadOnlyList<ExistingRegion> Locked,
    IReadOnlyList<(RoomResult Room, ExistingRegion Region)> Keep,
    IReadOnlyList<ExistingRegion> Delete,
    IReadOnlyList<RoomResult> Create,
    IReadOnlyList<ResidueResult> CreateHeld);

/// <summary>
///     The rerun rule (docs/features/rooms/LEDGER.md), pure. Locked regions are kept and never
///     created again; untouched machine regions rebind by geometry and are kept or deleted; new
///     rooms are created; untouched held residues are deleted and redrawn.
/// </summary>
public static class RoomsRerun
{
    public const string LockedPrefix = "locked|";

    public static bool IsLocked(Pe.Revit.Partition.Room? room) =>
        room?.Proposal?.SourceKey.StartsWith(LockedPrefix, StringComparison.Ordinal) == true;

    public static RoomsPlan Plan(
        IReadOnlyList<ExistingRegion> existing,
        IReadOnlyList<ExistingRegion> existingHeld,
        IReadOnlyList<ExistingRegion> locked,
        IReadOnlyList<RoomResult> accepted,
        IReadOnlyList<ResidueResult> held)
    {
        var lockedIds = locked.Select(r => r.ElementId).ToHashSet();
        if (existing.Concat(existingHeld).Any(r => lockedIds.Contains(r.ElementId)))
            throw new InvalidOperationException("a locked region is also a rerun candidate");
        var rebind = ZoneMaterializer.Rebind(accepted.Where(r => !IsLocked(r.Partition)).ToList(), existing);
        return new RoomsPlan(
            locked,
            rebind.Matched,
            [.. rebind.Orphaned, .. existingHeld],
            rebind.Unmatched,
            held.Where(r => !IsLocked(r.Partition)).ToList());
    }
}

/// <summary>Bodies of the rooms.* ops. Callers own the transaction.</summary>
public static class Rooms
{
    public const string RunDrawn = "drawn";
    public const string FlagStale = "stale";
    public const string FlagAuthored = "authored";

    // FOOTGUN: contract constant, the wall evidence window around a region's bbox.
    private const double WallWindowFt = 1.0;

    public static RoomsSnapshotData Snapshot(Document doc)
    {
        var views = new FilteredElementCollector(doc).OfClass(typeof(ViewPlan)).Cast<ViewPlan>()
            .Where(v => !v.IsTemplate && v.GenLevel != null).ToList();
        var levels = views.GroupBy(v => v.GenLevel.Name)
            .Select(g => new RoomsLevel(g.Key, g.First().GenLevel.ProjectElevation,
                g.Select(v => v.Name).OrderBy(n => n, StringComparer.Ordinal).ToList()))
            .OrderBy(l => l.Elevation).ThenBy(l => l.Name, StringComparer.Ordinal).ToList();
        var byId = views.ToDictionary(v => v.Id.Value());
        var regions = new List<RoomsRegion>();
        foreach (var fr in new FilteredElementCollector(doc).OfClass(typeof(FilledRegion)).Cast<FilledRegion>()
                     .OrderBy(fr => fr.Id.Value()))
        {
            if (!byId.TryGetValue(fr.OwnerViewId.Value(), out var view)) continue;
            var (role, guid) = TakeoffCarriers.ReadIdentity(fr);
            if (guid == null || role is not (TakeoffCarriers.RoleRoomRegion or TakeoffCarriers.RoleHeldResidue))
                continue;
            var provenance = ReadProvenance(fr);
            var loops = TakeoffAtlas.Boundaries(fr);
            if (loops.Count == 0) continue;
            var outer = loops.OrderByDescending(loop => Math.Abs(Kernel.Shoelace(loop))).First();
            bool touched = Touched(provenance, loops);
            var fields = TakeoffCarriers.ReadRoomFields(fr);
            regions.Add(new RoomsRegion(
                fr.Id.Value(), guid.Value, view.Name, view.GenLevel.Name,
                role == TakeoffCarriers.RoleRoomRegion ? "room" : "held",
                fields.Name ?? "", fields.Type ?? "hall",
                fields.CeilingFt, fields.People, fields.LightingW,
                fields.EquipSensible, fields.EquipLatent, fields.VentilationCfm,
                Sqft(fr, loops), outer, loops.Where(loop => !ReferenceEquals(loop, outer)).ToList(),
                !touched && provenance.Partition is { } p ? [p.LabelX, p.LabelY] : Interior(loops),
                provenance.RunId, provenance.Partition?.Reason,
                touched, touched || provenance.RunId == RunDrawn || provenance.Flags.Contains(FlagAuthored),
                provenance.Flags.Contains(FlagStale)));
        }
        return new RoomsSnapshotData(levels, regions);
    }

    public static RoomsPartitionResult Partition(Document doc, RoomsPartitionRequest request)
    {
        var sw = System.Diagnostics.Stopwatch.StartNew();
        TakeoffCarriers.Require(doc, TakeoffCarrierStage.Rooms);
        var view = LevelView(doc, request.View);
        var level = view.GenLevel;
        var runId = string.IsNullOrWhiteSpace(request.RunId) ? Guid.NewGuid().ToString("N") : request.RunId!;
        if (runId == RunDrawn) throw new InvalidOperationException($"runId '{RunDrawn}' is reserved");
        var scope = ScopeGuid(level);
        var domain = request.Bounds switch
        {
            { Count: >= 3 } bounds => bounds,
            { } => throw new InvalidOperationException("bounds need three or more points"),
            null when view.CropBoxActive => CropRectangle(view),
            null => throw new InvalidOperationException("pick bounds or crop the view"),
        };
        var domainLoops = new List<List<double[]>> { domain };
        var domainBox = Box(domainLoops, 0);

        // Classify what already lives on the view. Only this scope's untouched machine regions inside
        // the domain are rerun candidates; everything else is fixed ground the solver must fill around.
        var machine = new List<ExistingRegion>();
        var machineHeld = new List<ExistingRegion>();
        var locked = new List<ExistingRegion>();
        var adopt = new List<(FilledRegion Fr, ExistingRegion Region)>();
        var proposals = new List<Pe.Revit.Partition.RoomProposal>();
        foreach (var fr in new FilteredElementCollector(doc, view.Id).OfClass(typeof(FilledRegion))
                     .Cast<FilledRegion>().OrderBy(fr => fr.Id.Value()))
        {
            var loops = TakeoffAtlas.Boundaries(fr);
            if (loops.Count == 0) continue;
            var (role, guid) = TakeoffCarriers.ReadIdentity(fr);
            if (role == null)
            {
                if (!Intersects(Box(loops, 0), domainBox)) continue;
                var drawn = new ExistingRegion(fr.Id.Value(), guid ?? Guid.NewGuid(), loops, Sqft(fr, loops));
                adopt.Add((fr, drawn));
                locked.Add(drawn);
                proposals.Add(LockedProposal(drawn, ""));
                continue;
            }
            if (guid == null || role is not (TakeoffCarriers.RoleRoomRegion or TakeoffCarriers.RoleHeldResidue))
                continue;
            var provenance = ReadProvenance(fr);
            var region = new ExistingRegion(fr.Id.Value(), guid.Value, loops, Sqft(fr, loops));
            var at = Interior(loops);
            var inside = ZoneScope.ContainsEvenOdd(domainLoops, at[0], at[1]);
            if (Touched(provenance, loops) || provenance.RunId == RunDrawn || provenance.Flags.Contains(FlagAuthored)
                || provenance.ZoneGuid != scope || !inside)
            {
                locked.Add(region);
                proposals.Add(LockedProposal(region, TakeoffCarriers.ReadRoomFields(fr).Name ?? ""));
            }
            else if (role == TakeoffCarriers.RoleRoomRegion) machine.Add(region);
            else machineHeld.Add(region);
        }

        SpaceWorld.Prepare(doc);
        var input = PartitionVerbs.Capture(doc, new Pe.Revit.Partition.PartitionRequest(
            0, Loops: [Flat(domain)], View: view.Id.Value()));
        input = input with { Proposals = [.. input.Proposals, .. proposals] };
        var answer = PartitionVerbs.Run(doc, input);
        var knee = input.Knee.Elements.SelectMany(e => e.Pieces).ToList();

        var (rooms, residues) = Results(answer);
        var plan = RoomsRerun.Plan(machine, machineHeld, locked, rooms, residues);

        double elevation = level.ProjectElevation;
        var failures = new List<string>();
        var frType = new FilteredElementCollector(doc).OfClass(typeof(FilledRegionType))
            .Cast<FilledRegionType>().First();

        foreach (var (fr, drawn) in adopt)
        {
            TakeoffCarriers.WriteIdentity(fr, TakeoffCarriers.RoleRoomRegion, drawn.Guid);
            TakeoffCarriers.WriteProvenance(fr, new RegionProvenance(1, scope, RunDrawn, "", drawn.Sqft)
                { GeometryHash = GeometryHash(drawn.Loops) }.ToJson());
        }

        // Kept regions: geometry stays; the run id moves for machine regions, and the wall evidence
        // under every region this scope owns decides the stale flag.
        var kept = plan.Keep.Select(k => (k.Region, Machine: true))
            .Concat(plan.Locked.Select(r => (Region: r, Machine: false)));
        foreach (var (region, isMachine) in kept)
        {
            var fr = (FilledRegion)doc.GetElement(region.ElementId.ToElementId());
            var provenance = ReadProvenance(fr);
            if (provenance.ZoneGuid != scope) continue;   // another scope's region: fixed ground, never written
            var wall = WallHash(knee, region.Loops);
            var flags = provenance.Flags.Where(f => f != FlagStale).ToList();
            if (provenance.WallHash != null && provenance.WallHash != wall) flags.Add(FlagStale);
            TakeoffCarriers.WriteProvenance(fr, (provenance with
            {
                RunId = isMachine ? runId : provenance.RunId,
                GeometryHash = provenance.GeometryHash ?? GeometryHash(region.Loops),
                WallHash = provenance.WallHash ?? wall,
                Flags = flags,
            }).ToJson());
        }

        if (plan.Delete.Count > 0)
            doc.Delete(plan.Delete.Select(r => r.ElementId.ToElementId()).ToList());

        var created = new List<(FilledRegion Fr, RegionProvenance Provenance, bool Room)>();
        int createdRooms = 0, createdHeld = 0;
        foreach (var room in plan.Create)
        {
            try
            {
                var fr = Create(doc, frType, view, elevation, room.Polygon, room.Holes);
                TakeoffCarriers.WriteIdentity(fr, TakeoffCarriers.RoleRoomRegion, Guid.NewGuid());
                TakeoffCarriers.WriteRoomType(fr, "hall");
                if (room.Partition?.Proposal is { Name.Length: > 0 } proposal)
                    TakeoffCarriers.WriteRoomFields(fr, new RoomFields(Name: proposal.Name));
                created.Add((fr, new RegionProvenance(1, scope, runId, room.Id, room.RawSqft)
                    { Flags = room.Flags.ToList(), Partition = room.Partition }, true));
                createdRooms++;
            }
            catch (Exception ex)
            {
                // Drop, don't mangle: a room Revit rejects stays visible as a failure, never bent.
                failures.Add($"{room.Id}: {ex.Message}");
            }
        }
        foreach (var residue in plan.CreateHeld)
        {
            try
            {
                var fr = Create(doc, frType, view, elevation, residue.Polygon, residue.Holes);
                TakeoffCarriers.WriteIdentity(fr, TakeoffCarriers.RoleHeldResidue, Guid.NewGuid());
                created.Add((fr, new RegionProvenance(1, scope, runId, residue.Id, residue.RawSqft)
                    { Partition = residue.Partition }, false));
                createdHeld++;
            }
            catch (Exception ex)
            {
                failures.Add($"{residue.Id}: {ex.Message}");
            }
        }

        // Hash what Revit stored, not what was asked for: a later snapshot compares against the readback.
        doc.Regenerate();
        foreach (var (fr, provenance, isRoom) in created)
        {
            var loops = TakeoffAtlas.Boundaries(fr);
            List<string> flags = failures.Count > 0 && isRoom
                ? [.. provenance.Flags, "materialization-failure"]
                : provenance.Flags;
            TakeoffCarriers.WriteProvenance(fr, (provenance with
                { GeometryHash = GeometryHash(loops), WallHash = WallHash(knee, loops), Flags = flags }).ToJson());
        }

        return new RoomsPartitionResult(level.Name, runId, createdRooms, plan.Keep.Count, plan.Locked.Count,
            plan.Delete.Count, createdHeld, failures, answer.Hold, Math.Round(sw.Elapsed.TotalMilliseconds, 3));
    }

    public static RoomsDrawResult Draw(Document doc, RoomsDrawRequest request)
    {
        TakeoffCarriers.Require(doc, TakeoffCarrierStage.Rooms);
        var view = LevelView(doc, request.View);
        if (request.Loops is not { Count: > 0 } || request.Loops.Any(loop => loop is not { Count: >= 3 }))
            throw new InvalidOperationException("draw needs one or more loops of three or more points");
        var outer = request.Loops.OrderByDescending(loop => Math.Abs(Kernel.Shoelace(loop))).First();
        var frType = new FilteredElementCollector(doc).OfClass(typeof(FilledRegionType))
            .Cast<FilledRegionType>().First();
        var fr = Create(doc, frType, view, view.GenLevel.ProjectElevation, outer,
            request.Loops.Where(loop => !ReferenceEquals(loop, outer)).ToList());
        var guid = Guid.NewGuid();
        TakeoffCarriers.WriteIdentity(fr, TakeoffCarriers.RoleRoomRegion, guid);
        if (request.Name != null) TakeoffCarriers.WriteRoomFields(fr, new RoomFields(Name: request.Name));
        doc.Regenerate();
        var loops = TakeoffAtlas.Boundaries(fr);
        // WallHash stays null: no Space build here; the next partition records it.
        TakeoffCarriers.WriteProvenance(fr, new RegionProvenance(1, ScopeGuid(view.GenLevel), RunDrawn, "", Sqft(fr, loops))
            { GeometryHash = GeometryHash(loops) }.ToJson());
        return new RoomsDrawResult(fr.Id.Value(), guid);
    }

    public static RoomsWriteResult Write(Document doc, RoomsWriteRequest request)
    {
        TakeoffCarriers.Require(doc, TakeoffCarrierStage.Rooms);
        if (request.Regions is not { Count: > 0 }) throw new InvalidOperationException("rooms.write needs regions");
        if (request.Regions.Select(r => r.Guid).Distinct().Count() != request.Regions.Count)
            throw new InvalidOperationException("rooms.write names a region twice");
        var byGuid = new Dictionary<Guid, FilledRegion>();
        foreach (var fr in new FilteredElementCollector(doc).OfClass(typeof(FilledRegion)).Cast<FilledRegion>())
        {
            var (role, guid) = TakeoffCarriers.ReadIdentity(fr);
            if (guid != null && role is TakeoffCarriers.RoleRoomRegion or TakeoffCarriers.RoleHeldResidue)
                byGuid[guid.Value] = fr;
        }
        var unknown = request.Regions.FirstOrDefault(r => !byGuid.ContainsKey(r.Guid));
        if (unknown != null) throw new InvalidOperationException($"no Room Region with guid {unknown.Guid:D}");
        foreach (var r in request.Regions)
        {
            var fr = byGuid[r.Guid];
            var held = TakeoffCarriers.ReadIdentity(fr).Role == TakeoffCarriers.RoleHeldResidue;
            var before = held ? TakeoffCarriers.ReadRoomFields(fr) : null;
            TakeoffCarriers.WriteRoomFields(fr, new RoomFields(
                r.Name, r.Type, r.CeilingFt, r.People, r.LightingW, r.EquipSensible, r.EquipLatent, r.VentilationCfm));
            if (!held) continue;
            var provenance = ReadProvenance(fr);
            var authored = AuthorHeldIfEdited(provenance, before!, TakeoffCarriers.ReadRoomFields(fr));
            if (!ReferenceEquals(authored, provenance)) TakeoffCarriers.WriteProvenance(fr, authored.ToJson());
        }
        return new RoomsWriteResult(request.Regions.Count);
    }

    // ---------------------------------------------------------------- hashes (pure)

    /// <summary>SHA256 hex over the loops, coordinates rounded to 1e-6 ft, in Revit's loop order.</summary>
    public static string GeometryHash(IEnumerable<IEnumerable<double[]>> loops) =>
        Sha256(string.Join("|", loops.Select(Ring)));

    /// <summary>SHA256 hex over the knee pieces whose bbox meets the region bbox grown by 1 ft, order-free.</summary>
    public static string WallHash(IEnumerable<double[]> kneePieces, List<List<double[]>> loops)
    {
        var box = Box(loops, WallWindowFt);
        return Sha256(string.Join("|", kneePieces
            .Where(piece => Intersects(FlatBox(piece), box))
            .Select(piece => Ring(Pairs(piece)))
            .OrderBy(s => s, StringComparer.Ordinal)));
    }

    public static Guid ScopeGuid(Level level)
    {
        using var md5 = MD5.Create();
        return new Guid(md5.ComputeHash(Encoding.UTF8.GetBytes(level.UniqueId)));
    }

    private static string Ring(IEnumerable<double[]> loop) =>
        string.Join(";", loop.Select(p => $"{Round(p[0])},{Round(p[1])}"));

    // + 0.0 folds -0 into 0 so a coordinate that rounds to zero hashes one way.
    private static string Round(double v) => (Math.Round(v, 6) + 0.0).ToString("F6", CultureInfo.InvariantCulture);

    private static string Sha256(string text)
    {
        using var sha = SHA256.Create();
        return BitConverter.ToString(sha.ComputeHash(Encoding.UTF8.GetBytes(text))).Replace("-", "").ToLowerInvariant();
    }

    // ---------------------------------------------------------------- helpers

    private static bool Touched(RegionProvenance provenance, List<List<double[]>> loops) =>
        provenance.GeometryHash is { } stored && stored != GeometryHash(loops);

    internal static RegionProvenance AuthorHeldIfEdited(RegionProvenance provenance, RoomFields before, RoomFields after) =>
        before == after || provenance.Flags.Contains(FlagAuthored)
            ? provenance
            : provenance with { Flags = [.. provenance.Flags, FlagAuthored] };

    private static RegionProvenance ReadProvenance(FilledRegion fr) =>
        RegionProvenance.FromJson(TakeoffCarriers.ReadProvenance(fr)
                                  ?? throw new InvalidOperationException($"region {fr.Id} has no provenance blob"));

    private static ViewPlan LevelView(Document doc, string name)
    {
        var view = TakeoffAtlas.FindView(doc, name);
        return view.GenLevel != null ? view : throw new InvalidOperationException($"view '{name}' has no level");
    }

    private static Pe.Revit.Partition.RoomProposal LockedProposal(ExistingRegion region, string name) =>
        new(RoomsRerun.LockedPrefix + region.Guid.ToString("D"), name, "", region.Loops.Select(Flat).ToArray());

    private static double[] Flat(List<double[]> loop) => loop.SelectMany(p => new[] { p[0], p[1] }).ToArray();

    private static List<double[]> Pairs(double[] flat)
    {
        var pts = new List<double[]>(flat.Length / 2);
        for (int i = 0; i + 1 < flat.Length; i += 2) pts.Add([flat[i], flat[i + 1]]);
        return pts;
    }

    private static List<double[]> CropRectangle(ViewPlan view)
    {
        var crop = view.CropBox;
        var ring = new[] { (crop.Min.X, crop.Min.Y), (crop.Max.X, crop.Min.Y), (crop.Max.X, crop.Max.Y), (crop.Min.X, crop.Max.Y) }
            .Select(c => crop.Transform.OfPoint(new XYZ(c.Item1, c.Item2, 0)))
            .Select(p => new[] { p.X, p.Y }).ToList();
        if (Kernel.Shoelace(ring) < 0) ring.Reverse();
        return ring;
    }

    private static double[] Interior(List<List<double[]>> loops)
    {
        var c = new ZoneScope { Loops = loops }.ExactGeometry().InteriorPoint.Coordinate;
        return [c.X, c.Y];
    }

    private static double Sqft(FilledRegion fr, List<List<double[]>> loops) =>
        fr.get_Parameter(BuiltInParameter.HOST_AREA_COMPUTED)?.AsDouble()
        ?? new ZoneScope { Loops = loops }.ExactGeometry().Area;

    private static FilledRegion Create(Document doc, FilledRegionType type, View view, double elevation,
        List<double[]> outer, IEnumerable<List<double[]>> holes)
    {
        var loops = new List<CurveLoop> { Kernel.ToLoop(outer, elevation) };
        loops.AddRange(holes.Select(hole => Kernel.ToLoop(hole, elevation)));
        return FilledRegion.Create(doc, type.Id, view.Id, loops);
    }

    private static (List<RoomResult> Rooms, List<ResidueResult> Residues) Results(Pe.Revit.Partition.PartitionAnswer answer)
    {
        var rooms = new List<RoomResult>();
        var residues = new List<ResidueResult>();
        foreach (var r in answer.Rooms)
        {
            if (r.Disposition == Pe.Revit.Partition.Disposition.Excluded) continue;   // wall: drawn as nothing
            var id = $"R{r.Index + 1:D2}";
            var holes = (r.Holes ?? []).Select(Pairs).ToList();
            if (r.Disposition == Pe.Revit.Partition.Disposition.Accepted)
                rooms.Add(new RoomResult {
                    Partition = r, Id = id, RawSqft = r.AreaSqft, LabelX = r.LabelX, LabelY = r.LabelY,
                    Polygon = Pairs(r.Loop), Holes = holes,
                });
            else
                residues.Add(new ResidueResult {
                    Partition = r, Id = id, RawSqft = r.AreaSqft, LabelX = r.LabelX, LabelY = r.LabelY,
                    Reason = r.Disposition == Pe.Revit.Partition.Disposition.Void ? ResidueReason.Void : ResidueReason.Held,
                    Polygon = Pairs(r.Loop), Holes = holes,
                });
        }
        return (rooms, residues);
    }

    private readonly record struct Box2(double MinX, double MinY, double MaxX, double MaxY);

    private static Box2 Box(IEnumerable<List<double[]>> loops, double grow)
    {
        var pts = loops.SelectMany(l => l).ToList();
        return new Box2(pts.Min(p => p[0]) - grow, pts.Min(p => p[1]) - grow, pts.Max(p => p[0]) + grow, pts.Max(p => p[1]) + grow);
    }

    private static Box2 FlatBox(double[] flat)
    {
        double minx = double.MaxValue, miny = double.MaxValue, maxx = double.MinValue, maxy = double.MinValue;
        for (int i = 0; i + 1 < flat.Length; i += 2)
        {
            minx = Math.Min(minx, flat[i]); maxx = Math.Max(maxx, flat[i]);
            miny = Math.Min(miny, flat[i + 1]); maxy = Math.Max(maxy, flat[i + 1]);
        }
        return new Box2(minx, miny, maxx, maxy);
    }

    private static bool Intersects(Box2 a, Box2 b) =>
        a.MinX <= b.MaxX && a.MaxX >= b.MinX && a.MinY <= b.MaxY && a.MaxY >= b.MinY;
}
