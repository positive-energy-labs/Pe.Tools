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
    IReadOnlyList<ResidueResult> CreateHeld,
    RoomResult? Redesignate = null);

/// <summary>
///     The rerun rule (docs/features/rooms/LEDGER.md), pure. Locked regions are kept and never
///     created again; untouched machine regions rebind by geometry and are kept or deleted; new
///     rooms are created; untouched held residues are deleted and redrawn. A zone that solves to one
///     face is redesignated a room itself: every machine child is deleted and nothing is created.
/// </summary>
public static class RoomsRerun
{
    public const string LockedPrefix = Pe.Revit.Partition.RoomProposal.LockedPrefix;

    // FOOTGUN: brief constant (rails W4, 2026-09-25), not measured: one accepted face this share of the zone is the zone.
    public const double SoleFaceShare = 0.99;

    private static RoomResult? SoleFace(IReadOnlyList<RoomResult> accepted, IReadOnlyList<ResidueResult> held) =>
        (accepted, held) switch
        {
            ([var room], _) => room,
            ([], [var residue]) => new RoomResult {
                Partition = residue.Partition, Id = residue.Id, RawSqft = residue.RawSqft, LabelX = residue.LabelX,
                LabelY = residue.LabelY, MeanCeilingFt = residue.MeanCeilingFt, Polygon = residue.Polygon, Holes = residue.Holes,
            },
            _ => null,
        };

    /// <summary>
    ///     The provenance a zone takes when it flips to a room: it is its own zone (a region is both zone and
    ///     room for Manual J), its sole face is a room, not a held residue, and the run id stays drawn so the
    ///     next run keeps the person's edge as a locked room.
    /// </summary>
    public static RegionProvenance Redesignated(RegionProvenance zone, Guid zoneGuid, RoomResult sole, string geometryHash) =>
        zone with
        {
            ZoneGuid = zoneGuid,
            Partition = sole.Partition is { } p ? p with { Disposition = Pe.Revit.Partition.Disposition.Accepted, Reason = null } : null,
            GeometryHash = zone.GeometryHash ?? geometryHash,
        };

    /// <summary>The zone a room reads under: a live zone on its view, or itself when it was a zone that flipped.</summary>
    public static Guid? ZoneOf(Guid guid, RegionProvenance provenance, Func<Guid, bool> isLiveZone) =>
        provenance.ZoneGuid == guid || isLiveZone(provenance.ZoneGuid) ? provenance.ZoneGuid : null;

    public static bool IsLocked(Pe.Revit.Partition.Room? room) =>
        room?.Proposal?.IsLocked == true;

    public static RoomsPlan Plan(
        IReadOnlyList<ExistingRegion> existing,
        IReadOnlyList<ExistingRegion> existingHeld,
        IReadOnlyList<ExistingRegion> locked,
        IReadOnlyList<RoomResult> accepted,
        IReadOnlyList<ResidueResult> held,
        double? zoneSqft)
    {
        var lockedIds = locked.Select(r => r.ElementId).ToHashSet();
        if (existing.Concat(existingHeld).Any(r => lockedIds.Contains(r.ElementId)))
            throw new InvalidOperationException("a locked region is also a rerun candidate");
        // zoneSqft is null when a person declared the zone: the declaration wins and it never becomes a room.
        // The sole face may be held (Duryee's garage is held zone-edge-only): the zone is the room either way.
        if (locked.Count == 0 && SoleFace(accepted, held) is { } only && only.RawSqft >= SoleFaceShare * zoneSqft)
            return new RoomsPlan([], [], [.. existing, .. existingHeld], [], [], only);
        var rebind = ZoneMaterializer.Rebind(accepted.Where(r => !IsLocked(r.Partition)).ToList(), existing);
        return new RoomsPlan(
            locked,
            rebind.Matched,
            [.. rebind.Orphaned, .. existingHeld],
            rebind.Unmatched,
            held.Where(r => !IsLocked(r.Partition)).ToList());
    }
}

/// <summary>One region a person asked to merge, as read off Revit. Zone is its zone by RoomsRerun.ZoneOf.</summary>
public sealed record MergeMember(
    Guid Guid, long View, string Role, Guid? Zone, double Sqft, List<List<double[]>> Loops, TakeoffRhvacLink? Rhvac);

public sealed record MergePlan(
    List<double[]> Outer, List<List<double[]>> Holes, Guid Zone, MergeMember Largest, TakeoffRhvacLink? Rhvac);

/// <summary>
///     rooms.merge (docs/features/rooms/LEDGER.md, 2026-09-25), pure: rooms and held regions of one zone on one
///     view, at most one RHVAC link among them, whose union is one polygon.
/// </summary>
public static class RoomsMerge
{
    // FOOTGUN: contract constant (Kernel.WeldFt): two regions Revit stored along one edge meet within it, so the
    // union closes a seam this wide. A wall's width between two rooms stays open and the merge is refused.
    private const double SeamFt = Kernel.WeldFt;

    public static MergePlan Plan(long view, IReadOnlyList<MergeMember> members)
    {
        if (members.Count < 2) throw new InvalidOperationException("rooms.merge needs two or more regions");
        if (members.Select(m => m.Guid).Distinct().Count() != members.Count)
            throw new InvalidOperationException("rooms.merge names a region twice");
        if (members.FirstOrDefault(m => m.View != view) is { } off)
            throw new InvalidOperationException($"region {off.Guid:D} is not on the merge view");
        if (members.FirstOrDefault(m => m.Role is not (TakeoffCarriers.RoleRoomRegion or TakeoffCarriers.RoleHeldResidue)) is { } zone)
            throw new InvalidOperationException($"region {zone.Guid:D} is a zone; rooms.merge takes rooms and held regions");
        if (members.FirstOrDefault(m => m.Zone == null) is { } loose)
            throw new InvalidOperationException($"region {loose.Guid:D} is in no zone");
        if (members.Select(m => m.Zone).Distinct().Count() != 1)
            throw new InvalidOperationException("rooms.merge takes regions of one zone");
        var links = members.Where(m => m.Rhvac != null).GroupBy(m => (m.Rhvac!.Identifier, m.Rhvac.FileIdentity)).ToList();
        if (links.Count > 1)
            throw new InvalidOperationException("the regions carry different RHVAC links; unlink all but one first");
        var (outer, holes) = Union(members.Select(m => m.Loops));
        var largest = members.OrderByDescending(m => m.Sqft).First();
        // The largest member's link, else the one link a smaller member carries: a merge never drops a link.
        return new MergePlan(outer, holes, members[0].Zone!.Value, largest, largest.Rhvac ?? links.SingleOrDefault()?.First().Rhvac);
    }

    /// <summary>Drawn and a person's, so every rerun reads it locked; it keeps the one link and names what it replaced.</summary>
    public static RegionProvenance Provenance(MergePlan plan, IReadOnlyList<Guid> merged, double sqft, string geometryHash) =>
        new(1, plan.Zone, Rooms.RunDrawn, "", sqft)
        {
            GeometryHash = geometryHash, Flags = [Rooms.FlagPerson, Rooms.FlagMerged], MergedFrom = [.. merged], Rhvac = plan.Rhvac,
        };

    /// <summary>The one polygon the regions make, outer CCW and holes CW; throws when they do not touch.</summary>
    public static (List<double[]> Outer, List<List<double[]>> Holes) Union(IEnumerable<List<List<double[]>>> members)
    {
        var parts = members.Select(loops => new ZoneScope { Loops = loops }.ExactGeometry()).ToList();
        var union = NetTopologySuite.Operation.OverlayNG.OverlayNGRobust.Union(parts[0].Factory.BuildGeometry(parts));
        var mitre = new NetTopologySuite.Operation.Buffer.BufferParameters { JoinStyle = NetTopologySuite.Operation.Buffer.JoinStyle.Mitre };
        var closed = union.Buffer(SeamFt, mitre).Buffer(-SeamFt, mitre);
        if (closed is not NetTopologySuite.Geometries.Polygon polygon)
            throw new InvalidOperationException($"the regions do not make one polygon ({closed.NumGeometries} pieces); merge rooms that touch");
        return (Ring(polygon.Shell, ccw: true), polygon.Holes.Select(hole => Ring(hole, ccw: false)).ToList());
    }

    private static List<double[]> Ring(NetTopologySuite.Geometries.LinearRing ring, bool ccw)
    {
        var points = ring.Coordinates.Take(ring.Coordinates.Length - 1).Select(c => new[] { c.X, c.Y }).ToList();
        if (NetTopologySuite.Algorithm.Orientation.IsCCW(ring.CoordinateSequence) != ccw) points.Reverse();
        return points;
    }
}

/// <summary>Bodies of the rooms.* ops. Callers own the transaction.</summary>
public static class Rooms
{
    public const string RunDrawn = "drawn";
    public const string FlagStale = "stale";
    public const string FlagAuthored = "authored";
    public const string FlagPerson = "person";
    public const string FlagMerged = "merged";

    // FOOTGUN: contract constant, the wall evidence window around a region's bbox.
    private const double WallWindowFt = 1.0;

    // FOOTGUN: measured on Duryee `Mechanical Zoning Plan - Level 1` (Astra r0 capture, 22551 knee pieces). Summed
    // knee length inside the region inset by 1 / 2 ft: the five hand fills 807/661, 213/95, 1004/750, 94/30, 17/15;
    // the Pantry (x -36..-26, y 250..260) 97/0, because its hand edge overshoots the IFC wall layers at x -27.2..-27.9
    // by 0.5 to 1.5 ft. A 1 ft inset calls the Pantry a zone; 2 ft separates all six.
    private const double DesignationInsetFt = 2.0;

    // FOOTGUN: measured on the same six at the 2 ft inset: the weakest zone has 15 ft of interior knee ink, the Pantry 0.
    private const double ZoneInteriorWallFt = 4.0;

    // FOOTGUN: kaitpw tie-break (rooms LEDGER 2026-09-24), used only when no knee piece is near the region at all.
    private const double ZoneTieBreakSqft = 300.0;

    public static RoomsSnapshotData Snapshot(Document doc)
    {
        var views = new FilteredElementCollector(doc).OfClass(typeof(ViewPlan)).Cast<ViewPlan>()
            .Where(v => !v.IsTemplate && v.GenLevel != null).ToList();
        var levels = views.GroupBy(v => v.GenLevel.Name)
            .Select(g => new RoomsLevel(g.Key, g.First().GenLevel.ProjectElevation,
                g.Select(v => v.Name).OrderBy(n => n, StringComparer.Ordinal).ToList()))
            .OrderBy(l => l.Elevation).ThenBy(l => l.Name, StringComparer.Ordinal).ToList();
        var byId = views.ToDictionary(v => v.Id.Value());
        var ours = new List<(FilledRegion Fr, ViewPlan View, string Role, Guid Guid)>();
        foreach (var fr in new FilteredElementCollector(doc).OfClass(typeof(FilledRegion)).Cast<FilledRegion>()
                     .OrderBy(fr => fr.Id.Value()))
        {
            if (!byId.TryGetValue(fr.OwnerViewId.Value(), out var view)) continue;
            var (role, guid) = TakeoffCarriers.ReadIdentity(fr);
            if (guid != null && role is TakeoffCarriers.RoleZoningRegion or TakeoffCarriers.RoleRoomRegion
                    or TakeoffCarriers.RoleHeldResidue)
                ours.Add((fr, view, role, guid.Value));
        }
        var zones = ours.Where(r => r.Role == TakeoffCarriers.RoleZoningRegion)
            .Select(r => (r.View.Id.Value(), r.Guid)).ToHashSet();
        var regions = new List<RoomsRegion>();
        foreach (var (fr, view, role, guid) in ours)
        {
            var provenance = ReadProvenance(fr, role);
            var loops = TakeoffAtlas.Boundaries(fr);
            if (loops.Count == 0) continue;
            var outer = loops.OrderByDescending(loop => Math.Abs(Kernel.Shoelace(loop))).First();
            bool touched = Touched(provenance, loops);
            var fields = TakeoffCarriers.ReadRoomFields(fr);
            regions.Add(new RoomsRegion(
                fr.Id.Value(), guid, view.Name, view.GenLevel.Name,
                role switch
                {
                    TakeoffCarriers.RoleZoningRegion => "zone",
                    TakeoffCarriers.RoleRoomRegion => "room",
                    _ => "held",
                },
                RoomsRerun.ZoneOf(guid, provenance, zone => zones.Contains((view.Id.Value(), zone))),
                provenance.Flags.Contains(FlagPerson) ? "person" : provenance.RunId == RunDrawn ? "inferred" : null,
                fields.Name ?? "", fields.Type ?? "hall",
                fields.CeilingFt, fields.People, fields.LightingW,
                fields.EquipSensible, fields.EquipLatent, fields.VentilationCfm,
                Sqft(fr, loops), outer, loops.Where(loop => !ReferenceEquals(loop, outer)).ToList(),
                !touched && provenance.Partition is { } p ? [p.LabelX, p.LabelY] : Interior(loops),
                provenance.RunId, provenance.Partition?.Reason,
                touched, role != TakeoffCarriers.RoleZoningRegion && Locked(provenance, loops),   // an authored held row reads locked too (Astra ad180f8f)
                provenance.Flags.Contains(FlagStale)));
        }
        return new RoomsSnapshotData(levels, regions);
    }

    /// <summary>
    ///     Zone or room for a hand-drawn region: no knee ink near it at all falls back to area; knee ink
    ///     crossing its inset interior says walls divide it (zone); anything else is a room.
    /// </summary>
    public static string Designate(IEnumerable<double[]> kneePieces, List<List<double[]>> loops, double sqft)
    {
        var box = Box(loops, WallWindowFt);
        var near = kneePieces.Where(piece => Intersects(FlatBox(piece), box)).ToList();
        if (near.Count == 0)
            return sqft > ZoneTieBreakSqft ? TakeoffCarriers.RoleZoningRegion : TakeoffCarriers.RoleRoomRegion;
        var core = new ZoneScope { Loops = loops }.ExactGeometry().Buffer(-DesignationInsetFt);
        if (!core.IsEmpty)
        {
            var interior = near.Select(Pairs).Where(pts => pts.Count >= 2)
                .Sum(pts => core.Factory.CreateLineString(
                        pts.Select(pt => new NetTopologySuite.Geometries.Coordinate(pt[0], pt[1])).ToArray())
                    .Intersection(core).Length);
            if (interior >= ZoneInteriorWallFt) return TakeoffCarriers.RoleZoningRegion;
        }
        return TakeoffCarriers.RoleRoomRegion;
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
        var onView = new FilteredElementCollector(doc, view.Id).OfClass(typeof(FilledRegion)).Cast<FilledRegion>()
            .OrderBy(fr => fr.Id.Value())
            .Select(fr => (Fr: fr, Loops: TakeoffAtlas.Boundaries(fr), Identity: TakeoffCarriers.ReadIdentity(fr)))
            .Where(r => r.Loops.Count > 0).ToList();
        var mayZone = onView.Where(r => r.Identity.Role is null or TakeoffCarriers.RoleZoningRegion).ToList();
        if (mayZone.Count == 0) throw new InvalidOperationException($"draw a zone on '{view.Name}' first");

        // ponytail: one capture over the rectangle enclosing every zone and every role-less fill, because a
        // role-less fill needs knee evidence before it is known to be a zone. Ceiling: a far-off role-less room
        // widens the capture.
        SpaceWorld.Prepare(doc);
        var rect = Box(mayZone.SelectMany(r => r.Loops), 0);
        var captured = PartitionVerbs.Capture(doc, new Pe.Revit.Partition.PartitionRequest(0,
            Loops: [[rect.MinX, rect.MinY, rect.MaxX, rect.MinY, rect.MaxX, rect.MaxY, rect.MinX, rect.MaxY]],
            View: view.Id.Value()));
        var knee = captured.Knee.Elements.SelectMany(e => e.Pieces).ToList();

        // Designate and classify in memory; nothing is written until every zone is solved.
        var zones = new List<(FilledRegion Fr, Guid Guid, List<List<double[]>> Loops, string Label, bool Declared)>();
        var rooms = new List<(FilledRegion Fr, bool Held, ExistingRegion Region, RegionProvenance Provenance)>();
        var adopt = new List<(FilledRegion Fr, string Role, ExistingRegion Region)>();
        foreach (var (fr, loops, (role, guid)) in onView)
        {
            if (role == null)
            {
                var drawn = new ExistingRegion(fr.Id.Value(), guid ?? Guid.NewGuid(), loops, Sqft(fr, loops));
                string designated;
                try { designated = Designate(knee, loops, drawn.Sqft); }
                catch (Exception ex) { throw new InvalidOperationException($"designate {fr.Id}: {ex.GetType().Name} {ex.Message}", ex); }
                adopt.Add((fr, designated, drawn));
                if (designated == TakeoffCarriers.RoleZoningRegion)
                    zones.Add((fr, drawn.Guid, loops, drawn.Guid.ToString("N").Substring(0, 8), false));
                else
                    rooms.Add((fr, false, drawn, new RegionProvenance(1, scope, RunDrawn, "", drawn.Sqft)));
                continue;
            }
            if (guid == null) continue;
            if (role == TakeoffCarriers.RoleZoningRegion)
                zones.Add((fr, guid.Value, loops, TakeoffCarriers.ReadRoomFields(fr).Name is { Length: > 0 } name
                    ? name
                    : guid.Value.ToString("N").Substring(0, 8),
                    ReadProvenance(fr, role).Flags.Contains(FlagPerson)));
            else if (role is TakeoffCarriers.RoleRoomRegion or TakeoffCarriers.RoleHeldResidue)
                rooms.Add((fr, role == TakeoffCarriers.RoleHeldResidue,
                    new ExistingRegion(fr.Id.Value(), guid.Value, loops, Sqft(fr, loops)), ReadProvenance(fr, role)));
        }
        if (zones.Count == 0) throw new InvalidOperationException($"draw a zone on '{view.Name}' first");

        var zoneGuids = zones.Select(z => z.Guid).ToHashSet();
        var locked = rooms.Where(r => Locked(r.Provenance, r.Region.Loops)).ToList();
        var machine = rooms.Where(r => !Locked(r.Provenance, r.Region.Loops)).ToList();
        // A machine region whose zone is no longer a zone (flipped to a room, or deleted) rebinds against nothing:
        // delete it. A machine region still on the level scope predates zones: unassigned, never touched.
        var orphans = machine.Where(r => r.Provenance.ZoneGuid != scope && !zoneGuids.Contains(r.Provenance.ZoneGuid))
            .Select(r => r.Region).ToList();

        var solved = new List<(FilledRegion Zone, Guid Guid, string Label, RoomsPlan Plan)>();
        var holds = new List<string>();
        var failures = new List<string>();
        foreach (var zone in zones.OrderBy(z => z.Fr.Id.Value()))
        {
            var lockedIn = locked.Where(r =>
            {
                var at = Interior(r.Region.Loops);
                return ZoneScope.ContainsEvenOdd(zone.Loops, at[0], at[1]);
            }).ToList();
            var input = captured with
            {
                ZoneLoops = zone.Loops.Select(Flat).ToArray(),
                Proposals =
                [
                    .. captured.Proposals,
                    .. lockedIn.Select(r => LockedProposal(r.Region, TakeoffCarriers.ReadRoomFields(r.Fr).Name ?? "")),
                ],
            };
            Pe.Revit.Partition.PartitionAnswer answer;
            try { answer = PartitionVerbs.Run(doc, input); }
            catch (Exception ex) when (ex is not Pe.Revit.Partition.PartitionException)
            {
                // One zone's topology failure names itself and leaves the other zones solved.
                var frame = new System.Diagnostics.StackTrace(ex).GetFrames()?.Select(f => f.GetMethod()?.DeclaringType?.Name + "." + f.GetMethod()?.Name)
                    .FirstOrDefault(m => m.StartsWith("Solve.") || m.StartsWith("Rooms."));
                // Diagnostic dump: the exact solver inputs of the failed zone, replayable without Revit.
                var dump = Path.Combine(Path.GetTempPath(), $"pe-rooms-{zone.Label}.json");
                File.WriteAllText(dump, Newtonsoft.Json.JsonConvert.SerializeObject(new { input.ZoneLoops, input.Proposals }));
                failures.Add($"{zone.Label}: {ex.GetType().Name} {ex.Message} at {frame ?? "?"} (inputs {dump})");
                continue;
            }
            if (answer.Hold != null) holds.Add($"{zone.Label}: {answer.Hold}");
            var (accepted, residues) = Results(answer);
            var mine = machine.Where(r => r.Provenance.ZoneGuid == zone.Guid).ToList();
            solved.Add((zone.Fr, zone.Guid, zone.Label, RoomsRerun.Plan(
                mine.Where(r => !r.Held).Select(r => r.Region).ToList(),
                mine.Where(r => r.Held).Select(r => r.Region).ToList(),
                lockedIn.Select(r => r.Region).ToList(), accepted, residues,
                zone.Declared ? null : answer.Accounting.ZoneSqft)));
        }

        double elevation = level.ProjectElevation;
        var frType = RegionType(doc);

        foreach (var (fr, role, drawn) in adopt)
        {
            TakeoffCarriers.WriteIdentity(fr, role, drawn.Guid);
            TakeoffCarriers.WriteProvenance(fr, new RegionProvenance(1, scope, RunDrawn, "", drawn.Sqft)
                { GeometryHash = GeometryHash(drawn.Loops) }.ToJson());
        }

        // ponytail: orphans count in Deleted, not itemized. Ceiling: the log row cannot tell a flipped zone's
        // children from rebind deletions.
        if (orphans.Count > 0)
            doc.Delete(orphans.Select(r => r.ElementId.ToElementId()).ToList());

        var created = new List<(FilledRegion Fr, RegionProvenance Provenance, bool Room)>();
        int createdRooms = 0, createdHeld = 0;
        foreach (var (zoneFr, zoneGuid, label, plan) in solved)
        {
            // Kept regions: geometry stays; the run id moves for machine regions, a locked room inside the zone
            // joins it, and the wall evidence under every region decides the stale flag.
            var kept = plan.Keep.Select(k => (k.Region, Room: (RoomResult?)k.Room))
                .Concat(plan.Locked.Select(r => (Region: r, Room: (RoomResult?)null)));
            foreach (var (region, room) in kept)
            {
                var fr = (FilledRegion)doc.GetElement(region.ElementId.ToElementId());
                var isMachine = room != null;
                if (isMachine && fr.GetTypeId() != frType.Id) fr.ChangeTypeId(frType.Id);
                if (room != null && ProposedName(room, TakeoffCarriers.ReadRoomFields(fr).Name!) is { } name)
                    TakeoffCarriers.WriteRoomFields(fr, new RoomFields(Name: name));
                var provenance = ReadProvenance(fr, TakeoffCarriers.ReadIdentity(fr).Role);
                var wall = WallHash(knee, region.Loops);
                var flags = provenance.Flags.Where(f => f != FlagStale).ToList();
                if (provenance.WallHash != null && provenance.WallHash != wall) flags.Add(FlagStale);
                TakeoffCarriers.WriteProvenance(fr, (provenance with
                {
                    ZoneGuid = zoneGuid,
                    RunId = isMachine ? runId : provenance.RunId,
                    GeometryHash = provenance.GeometryHash ?? GeometryHash(region.Loops),
                    WallHash = provenance.WallHash ?? wall,
                    Flags = flags,
                }).ToJson());
            }

            if (plan.Delete.Count > 0)
                doc.Delete(plan.Delete.Select(r => r.ElementId.ToElementId()).ToList());

            // ponytail: a redesignated zone is not itemized in the result (Created stays 0). Ceiling: the log
            // row reads it as deletions only.
            if (plan.Redesignate is { } sole)
            {
                var zoneProvenance = ReadProvenance(zoneFr, TakeoffCarriers.RoleZoningRegion);
                TakeoffCarriers.WriteIdentity(zoneFr, TakeoffCarriers.RoleRoomRegion, zoneGuid);
                if (zoneFr.GetTypeId() != frType.Id) zoneFr.ChangeTypeId(frType.Id);
                if (ProposedName(sole, TakeoffCarriers.ReadRoomFields(zoneFr).Name!) is { } name)
                    TakeoffCarriers.WriteRoomFields(zoneFr, new RoomFields(Name: name));
                // The person flag is already absent, since a declared zone never gets here.
                TakeoffCarriers.WriteProvenance(zoneFr, RoomsRerun.Redesignated(
                    zoneProvenance, zoneGuid, sole, GeometryHash(TakeoffAtlas.Boundaries(zoneFr))).ToJson());
            }

            foreach (var room in plan.Create)
            {
                try
                {
                    var fr = Create(doc, frType, view, elevation, room.Polygon, room.Holes);
                    TakeoffCarriers.WriteIdentity(fr, TakeoffCarriers.RoleRoomRegion, Guid.NewGuid());
                    TakeoffCarriers.WriteRoomType(fr, "hall");
                    if (ProposedName(room, "") is { } name)
                        TakeoffCarriers.WriteRoomFields(fr, new RoomFields(Name: name));
                    created.Add((fr, new RegionProvenance(1, zoneGuid, runId, room.Id, room.RawSqft)
                        { Flags = room.Flags.ToList(), Partition = room.Partition }, true));
                    createdRooms++;
                }
                catch (Exception ex)
                {
                    // Drop, don't mangle: a room Revit rejects stays visible as a failure, never bent.
                    failures.Add($"{label} {room.Id}: {ex.Message}");
                }
            }
            foreach (var residue in plan.CreateHeld)
            {
                try
                {
                    var fr = Create(doc, frType, view, elevation, residue.Polygon, residue.Holes);
                    TakeoffCarriers.WriteIdentity(fr, TakeoffCarriers.RoleHeldResidue, Guid.NewGuid());
                    created.Add((fr, new RegionProvenance(1, zoneGuid, runId, residue.Id, residue.RawSqft)
                        { Partition = residue.Partition }, false));
                    createdHeld++;
                }
                catch (Exception ex)
                {
                    failures.Add($"{label} {residue.Id}: {ex.Message}");
                }
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

        return new RoomsPartitionResult(level.Name, runId, zones.Count, createdRooms,
            solved.Sum(s => s.Plan.Keep.Count), solved.Sum(s => s.Plan.Locked.Count),
            orphans.Count + solved.Sum(s => s.Plan.Delete.Count), createdHeld, failures,
            holds.Count > 0 ? string.Join("; ", holds) : null, Math.Round(sw.Elapsed.TotalMilliseconds, 3));
    }

    public static RoomsDrawResult Draw(Document doc, RoomsDrawRequest request)
    {
        TakeoffCarriers.Require(doc, TakeoffCarrierStage.Rooms);
        var view = LevelView(doc, request.View);
        var role = RoleOf(request.Role ?? "room");
        if (request.Loops is not { Count: > 0 } || request.Loops.Any(loop => loop is not { Count: >= 3 }))
            throw new InvalidOperationException("draw needs one or more loops of three or more points");
        var outer = request.Loops.OrderByDescending(loop => Math.Abs(Kernel.Shoelace(loop))).First();
        var fr = Create(doc, RegionType(doc), view, view.GenLevel.ProjectElevation, outer,
            request.Loops.Where(loop => !ReferenceEquals(loop, outer)).ToList());
        var guid = Guid.NewGuid();
        TakeoffCarriers.WriteIdentity(fr, role, guid);
        if (request.Name != null) TakeoffCarriers.WriteRoomFields(fr, new RoomFields(Name: request.Name));
        doc.Regenerate();
        var loops = TakeoffAtlas.Boundaries(fr);
        // WallHash stays null: no Space build here; the next partition records it.
        TakeoffCarriers.WriteProvenance(fr, new RegionProvenance(1, ScopeGuid(view.GenLevel), RunDrawn, "", Sqft(fr, loops))
            { GeometryHash = GeometryHash(loops), Flags = [FlagPerson] }.ToJson());
        return new RoomsDrawResult(fr.Id.Value(), guid);
    }

    public static RoomsWriteResult Write(Document doc, RoomsWriteRequest request)
    {
        TakeoffCarriers.Require(doc, TakeoffCarrierStage.Rooms);
        if (request.Regions is not { Count: > 0 }) throw new InvalidOperationException("rooms.write needs regions");
        if (request.Regions.Select(r => r.Guid).Distinct().Count() != request.Regions.Count)
            throw new InvalidOperationException("rooms.write names a region twice");
        var byGuid = Resolve(doc, request.Regions.Select(r => r.Guid));
        foreach (var r in request.Regions)
        {
            var (fr, current) = byGuid[r.Guid];
            var held = current == TakeoffCarriers.RoleHeldResidue;
            if (r.Role != null && held)
                throw new InvalidOperationException($"held residue {r.Guid:D} takes no room or zone designation");
            var before = held ? TakeoffCarriers.ReadRoomFields(fr) : null;
            TakeoffCarriers.WriteRoomFields(fr, new RoomFields(
                r.Name, r.Type, r.CeilingFt, r.People, r.LightingW, r.EquipSensible, r.EquipLatent, r.VentilationCfm));
            if (r.Role != null)
            {
                // The same role still marks it a person's: they confirmed it.
                var role = RoleOf(r.Role);
                var provenance = ReadProvenance(fr, current);
                if (role != current) TakeoffCarriers.WriteIdentity(fr, role, r.Guid);
                if (!provenance.Flags.Contains(FlagPerson))
                    TakeoffCarriers.WriteProvenance(fr, (provenance with { Flags = [.. provenance.Flags, FlagPerson] }).ToJson());
            }
            if (!held) continue;
            var heldProvenance = ReadProvenance(fr, current);
            var authored = AuthorHeldIfEdited(heldProvenance, before!, TakeoffCarriers.ReadRoomFields(fr));
            if (!ReferenceEquals(authored, heldProvenance)) TakeoffCarriers.WriteProvenance(fr, authored.ToJson());
        }
        return new RoomsWriteResult(request.Regions.Count);
    }

    /// <summary>
    ///     A person combines rooms (rooms LEDGER 2026-09-25): one drawn, person-flagged Room Region replaces them,
    ///     so every rerun keeps it locked and clips the faces under it. Fields come from the largest member.
    /// </summary>
    public static RoomsMergeResult Merge(Document doc, RoomsMergeRequest request)
    {
        TakeoffCarriers.Require(doc, TakeoffCarrierStage.Rooms);
        var view = LevelView(doc, request.View);
        var guids = request.Guids ?? [];
        var byGuid = Resolve(doc, guids);
        var zones = byGuid.Where(r => r.Value.Role == TakeoffCarriers.RoleZoningRegion)
            .Select(r => (r.Value.Fr.OwnerViewId.Value(), r.Key)).ToHashSet();
        var members = guids.Select(guid =>
        {
            var (fr, role) = byGuid[guid];
            var provenance = ReadProvenance(fr, role);
            var loops = TakeoffAtlas.Boundaries(fr);
            var owner = fr.OwnerViewId.Value();
            return new MergeMember(guid, owner, role, RoomsRerun.ZoneOf(guid, provenance, zone => zones.Contains((owner, zone))),
                Sqft(fr, loops), loops, provenance.Rhvac);
        }).ToList();
        var plan = RoomsMerge.Plan(view.Id.Value(), members);
        var fields = TakeoffCarriers.ReadRoomFields(byGuid[plan.Largest.Guid].Fr);

        var merged = Create(doc, RegionType(doc), view, view.GenLevel.ProjectElevation, plan.Outer, plan.Holes);
        var mergedGuid = Guid.NewGuid();
        TakeoffCarriers.WriteIdentity(merged, TakeoffCarriers.RoleRoomRegion, mergedGuid);
        TakeoffCarriers.WriteRoomFields(merged, fields with { Name = request.Name ?? fields.Name });
        doc.Delete(guids.Select(guid => byGuid[guid].Fr.Id).ToList());
        doc.Regenerate();
        var stored = TakeoffAtlas.Boundaries(merged);
        var sqft = Sqft(merged, stored);
        // WallHash stays null: no Space build here; the next partition records it.
        TakeoffCarriers.WriteProvenance(merged, RoomsMerge.Provenance(plan, guids, sqft, GeometryHash(stored)).ToJson());
        return new RoomsMergeResult(merged.Id.Value(), mergedGuid, guids, sqft);
    }

    /// <summary>Our zone, room, and held regions by guid, the whole document; throws naming a guid that is none of them.</summary>
    private static Dictionary<Guid, (FilledRegion Fr, string Role)> Resolve(Document doc, IEnumerable<Guid> guids)
    {
        var byGuid = new Dictionary<Guid, (FilledRegion Fr, string Role)>();
        foreach (var fr in new FilteredElementCollector(doc).OfClass(typeof(FilledRegion)).Cast<FilledRegion>())
        {
            var (role, guid) = TakeoffCarriers.ReadIdentity(fr);
            if (guid != null && role is TakeoffCarriers.RoleZoningRegion or TakeoffCarriers.RoleRoomRegion
                    or TakeoffCarriers.RoleHeldResidue)
                byGuid[guid.Value] = (fr, role!);
        }
        foreach (var guid in guids)
            if (!byGuid.ContainsKey(guid)) throw new InvalidOperationException($"no Room Region with guid {guid:D}");
        return byGuid;
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

    /// <summary>Kept as drawn and handed to the solver as a proposal: touched, drawn, or a person's.</summary>
    internal static bool Locked(RegionProvenance provenance, List<List<double[]>> loops) =>
        Touched(provenance, loops) || provenance.RunId == RunDrawn
        || provenance.Flags.Contains(FlagAuthored) || provenance.Flags.Contains(FlagPerson);

    /// <summary>The architect's name for an accepted face, when the region's name field is still empty.</summary>
    public static string? ProposedName(RoomResult room, string current) =>
        current.Length == 0 && room.Partition?.Proposal is { Name.Length: > 0 } proposal ? proposal.Name : null;

    public const string RegionTypeName = "PE Rooms";

    // Found by name, so a rerun reuses it and a person's restyle of it sticks. Solid fill that does not mask:
    // Revit draws the model's lines and edges over it, so a room's edge can be judged against its walls.
    // ponytail: renaming the type makes the next run create a fresh one; no opacity knob exists on FilledRegionType.
    private static FilledRegionType RegionType(Document doc)
    {
        var types = new FilteredElementCollector(doc).OfClass(typeof(FilledRegionType)).Cast<FilledRegionType>().ToList();
        if (types.FirstOrDefault(t => t.Name == RegionTypeName) is { } existing) return existing;
        var type = (FilledRegionType)types.First().Duplicate(RegionTypeName);
        type.ForegroundPatternId = new FilteredElementCollector(doc).OfClass(typeof(FillPatternElement))
            .Cast<FillPatternElement>()
            .First(fp => fp.GetFillPattern() is { IsSolidFill: true, Target: FillPatternTarget.Drafting }).Id;
        type.ForegroundPatternColor = new Color(200, 225, 255);
        type.BackgroundPatternId = ElementId.InvalidElementId;
        type.IsMasking = false;
        return type;
    }

    private static string RoleOf(string designation) => designation switch
    {
        "room" => TakeoffCarriers.RoleRoomRegion,
        "zone" => TakeoffCarriers.RoleZoningRegion,
        _ => throw new InvalidOperationException($"role '{designation}' is not room or zone"),
    };

    internal static RegionProvenance AuthorHeldIfEdited(RegionProvenance provenance, RoomFields before, RoomFields after) =>
        before == after || provenance.Flags.Contains(FlagAuthored)
            ? provenance
            : provenance with { Flags = [.. provenance.Flags, FlagAuthored] };

    private static RegionProvenance ReadProvenance(FilledRegion fr, string? role)
    {
        var json = TakeoffCarriers.ReadProvenance(fr);
        if (role != TakeoffCarriers.RoleZoningRegion)
            return RegionProvenance.FromJson(json ?? throw new InvalidOperationException($"region {fr.Id} has no provenance blob"));
        // A zone takeoffs adopted carries TakeoffZoneProvenance (V, View, Name, SystemTag): read it with defaults
        // (Version 0, no RunId), call it drawn, and let its keys ride in Unknown. The next write stores it as v1.
        var read = json == null ? null : Newtonsoft.Json.JsonConvert.DeserializeObject<RegionProvenance>(json);
        return (read ?? new RegionProvenance(1, Guid.Empty, RunDrawn, "", 0)) with
        {
            Version = 1,
            RunId = string.IsNullOrEmpty(read?.RunId) ? RunDrawn : read!.RunId,
        };
    }

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
        return FilledRegion.Create(doc, type.Id, view.Id, Kernel.ToLoops(outer, holes, elevation));
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
