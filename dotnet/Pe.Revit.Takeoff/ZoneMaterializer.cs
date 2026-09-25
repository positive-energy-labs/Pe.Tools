using Newtonsoft.Json;

namespace Pe.Revit.Takeoff;

// Pipeline step 3's write side: accepted rooms become persistent, editable Room Region FRs inside
// their Zoning Region; held residue becomes visible held-residue FRs. FR-only — Spaces are out of
// the critical path (LEDGER). Identity is geometric, never rank: reruns re-bind existing
// regions by label-point containment + area +/-20% (the proven anchor law) and NEVER touch a
// designer's existing region — propose, never overwrite.
public sealed record RegionProvenance(
    int Version,
    Guid ZoneGuid,
    string RunId,
    string SourceRoomId,
    double SourceSqft)
{
    // The solver's original answer, not a designer acceptance or current edited boundary.
    public Pe.Revit.Partition.Room? Partition { get; init; }
    public RegionMeasurement? Measurement { get; init; }

    [JsonProperty("r10")]
    public TakeoffRhvacLink? Rhvac { get; init; }

    // /rooms: SHA256 hex of the region's own loops at creation, and of the knee-slice evidence under it.
    // Older blobs read both as null (Version stays 1).
    public string? GeometryHash { get; init; }
    public string? WallHash { get; init; }

    [JsonProperty("flags")]
    public List<string> Flags { get; init; } = [];

    // Unknown carrier keys, including legacy `resolutions` (old human dismissals), survive read-modify-write untouched.
    // Nothing reads them; no migrator, no silent discard.
    [JsonExtensionData]
    public IDictionary<string, Newtonsoft.Json.Linq.JToken> Unknown { get; init; } = new Dictionary<string, Newtonsoft.Json.Linq.JToken>();

    public string ToJson() => TakeoffJson.Serialize(this);

    // Fail-closed: an unreadable or wrong-version blob throws; callers surface and stop.
    public static RegionProvenance FromJson(string json)
    {
        RegionProvenance provenance;
        try
        {
            provenance = JsonConvert.DeserializeObject<RegionProvenance>(json)
                         ?? throw new InvalidOperationException("provenance blob is empty");
        }
        catch (JsonException ex)
        {
            throw new InvalidOperationException($"provenance blob is not valid JSON: {ex.Message}");
        }
        return provenance.Version == 1
            ? provenance
            : throw new InvalidOperationException($"provenance blob is v{provenance.Version}; this build reads v1");
    }
}

public sealed record ExistingRegion(long ElementId, Guid Guid, List<List<double[]>> Loops, double Sqft);

public sealed record ZoneRebind(
    IReadOnlyList<(RoomResult Room, ExistingRegion Existing)> Matched,
    IReadOnlyList<RoomResult> Unmatched,          // new this run — candidates to create
    IReadOnlyList<ExistingRegion> Orphaned);      // existing regions no run room claims

public static class ZoneMaterializer
{
    // Pure geometric re-binding, unit-testable without Revit. A room claims an existing region
    // when its label point lies inside the region's polygon and areas agree within +/-20%.
    // Ambiguity (two rooms claiming one region) resolves to the closest area ratio; the loser
    // stays unmatched rather than guessing.
    public static ZoneRebind Rebind(
        IReadOnlyList<RoomResult> rooms, IReadOnlyList<ExistingRegion> existing)
    {
        var claims = new List<(RoomResult Room, ExistingRegion Region, double AreaError)>();
        foreach (var room in rooms)
        foreach (var region in existing)
        {
            if (region.Sqft <= 0 || room.RawSqft <= 0) continue;
            double ratio = room.RawSqft / region.Sqft;
            if (ratio < 0.8 || ratio > 1.25) continue;
            if (!ZoneScope.ContainsEvenOdd(region.Loops,
                    room.LabelX, room.LabelY)) continue;
            claims.Add((room, region, Math.Abs(1 - ratio)));
        }
        var matched = new List<(RoomResult, ExistingRegion)>();
        var takenRooms = new HashSet<RoomResult>();
        var takenRegions = new HashSet<ExistingRegion>();
        foreach (var (room, region, _) in claims.OrderBy(c => c.AreaError))
        {
            if (takenRooms.Contains(room) || takenRegions.Contains(region)) continue;
            takenRooms.Add(room);
            takenRegions.Add(region);
            matched.Add((room, region));
        }
        return new ZoneRebind(
            matched,
            rooms.Where(r => !takenRooms.Contains(r)).ToList(),
            existing.Where(e => !takenRegions.Contains(e)).ToList());
    }

    // Reads every FR on the view stamped with this zone's provenance and the given role.
    public static List<ExistingRegion> ReadExisting(Document doc, View view, Guid zoneGuid, string role)
    {
        var found = new List<ExistingRegion>();
        foreach (var region in new FilteredElementCollector(doc, view.Id)
                     .OfClass(typeof(FilledRegion)).Cast<FilledRegion>())
        {
            var (frRole, frGuid) = TakeoffCarriers.ReadIdentity(region);
            if (frRole != role || frGuid == null) continue;
            string? blob = TakeoffCarriers.ReadProvenance(region);
            if (blob == null || RegionProvenance.FromJson(blob).ZoneGuid != zoneGuid) continue;
            var loops = TakeoffAtlas.Boundaries(region);
            if (loops.Count == 0) continue;
            double sqft = region.get_Parameter(BuiltInParameter.HOST_AREA_COMPUTED)?.AsDouble()
                          ?? new ZoneScope { Loops = loops }.ExactGeometry().Area;
            found.Add(new ExistingRegion(region.Id.Value(), frGuid.Value, loops, sqft));
        }
        return found;
    }

    public sealed record MaterializeResult(
        int Created, int Held, int Rebound, int Orphaned, List<string> Failures);

    // First run creates proposals. A rerun is read/propose-only: it rebinds the new result to the
    // accepted baseline and reports unmatched/orphaned facts without creating or overwriting FRs.
    public static MaterializeResult Materialize(
        Document doc, View view, double elevation, Guid zoneGuid, string runId,
        IReadOnlyList<RoomResult> accepted, IReadOnlyList<ResidueResult> held,
        Action<string> log)
    {
        TakeoffCarriers.Require(doc, TakeoffCarrierStage.Materialization);
        var frType = new FilteredElementCollector(doc).OfClass(typeof(FilledRegionType))
            .Cast<FilledRegionType>().First();
        var existing = ReadExisting(doc, view, zoneGuid, TakeoffCarriers.RoleRoomRegion);
        var existingHeld = ReadExisting(doc, view, zoneGuid, TakeoffCarriers.RoleHeldResidue);
        bool firstRun = existing.Count == 0 && existingHeld.Count == 0;
        var rebind = Rebind(accepted, existing);
        var failures = new List<string>();
        var createdRegions = new List<FilledRegion>();
        int created = 0, heldDrawn = 0;

        foreach (var room in firstRun ? rebind.Unmatched : [])
        {
            try
            {
                var loops = Kernel.ToLoops(room.Polygon, room.Holes, elevation);
                var region = FilledRegion.Create(doc, frType.Id, view.Id, loops);
                TakeoffCarriers.WriteIdentity(region, TakeoffCarriers.RoleRoomRegion, Guid.NewGuid());
                TakeoffCarriers.WriteProvenance(region,
                    (new RegionProvenance(1, zoneGuid, runId, room.Id, room.RawSqft)
                        { Flags = room.Flags.ToList(), Partition = room.Partition }).ToJson());
                TakeoffCarriers.WriteRoomType(region, "hall");
                createdRegions.Add(region);
                created++;
            }
            catch (Exception ex)
            {
                // Drop, don't mangle: a room Revit rejects stays visible as a failure, never bent.
                failures.Add($"{room.Id}: {ex.Message}");
            }
        }

        if (firstRun)
            foreach (var residue in held)
            {
                try
                {
                    var loops = Kernel.ToLoops(residue.Polygon, residue.Holes, elevation);
                    var region = FilledRegion.Create(doc, frType.Id, view.Id, loops);
                    TakeoffCarriers.WriteIdentity(region, TakeoffCarriers.RoleHeldResidue, Guid.NewGuid());
                    TakeoffCarriers.WriteProvenance(region,
                        (new RegionProvenance(1, zoneGuid, runId, residue.Id, residue.RawSqft)
                            { Partition = residue.Partition }).ToJson());
                    heldDrawn++;
                }
                catch (Exception ex)
                {
                    failures.Add($"{residue.Id}: {ex.Message}");
                }
            }

        if (failures.Count > 0)
            foreach (var region in createdRegions)
            {
                string blob = TakeoffCarriers.ReadProvenance(region)!;
                var provenance = RegionProvenance.FromJson(blob);
                if (!provenance.Flags.Contains("materialization-failure"))
                    provenance.Flags.Add("materialization-failure");
                TakeoffCarriers.WriteProvenance(region, provenance.ToJson());
            }

        log($"[materialize] zone={zoneGuid:D} created={created} held={heldDrawn} " +
            $"rebound={rebind.Matched.Count} orphaned={rebind.Orphaned.Count} failures={failures.Count}");
        return new MaterializeResult(created, heldDrawn, rebind.Matched.Count,
            rebind.Orphaned.Count, failures);
    }
}
