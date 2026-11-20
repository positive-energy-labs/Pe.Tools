using Newtonsoft.Json;

namespace Pe.Revit.Takeoff;

// Pipeline step 3's write side: accepted rooms become persistent, editable Room Region FRs inside
// their Zoning Region; held residue becomes visible held-residue FRs. FR-only — Spaces are out of
// the critical path (LEDGER). Identity is geometric, never rank: reruns re-bind existing
// regions by label-point containment + area +/-20% (the proven anchor law) and NEVER touch a
// designer's existing region — propose, never overwrite.
public sealed record RegionProvenance(
    string? Zone,
    string RunId,
    string SourceRoomId,
    double SourceSqft)
{
    // The solver's original answer is projected from its trace. The model carries its locator and the native geometry hash.
    [JsonProperty(NullValueHandling = NullValueHandling.Ignore)]
    public Pe.Revit.Partition.Room? Partition { get; init; }
    [JsonProperty(NullValueHandling = NullValueHandling.Ignore)]
    internal string? OriginalTrace { get; init; }
    public RegionMeasurement? Measurement { get; init; }

    [JsonProperty("r10")]
    public TakeoffRhvacLink? Rhvac { get; init; }

    // /rooms: SHA256 hex of the region's own loops at creation, and of the knee-slice evidence under it.
    // A blob written before them reads both as null.
    public string? GeometryHash { get; init; }
    public string? WallHash { get; init; }

    [JsonProperty("flags")]
    public List<string> Flags { get; init; } = [];

    // rooms.merge: the regions a person combined into this one. Absent on every other region.
    [JsonProperty("mergedFrom", NullValueHandling = NullValueHandling.Ignore)]
    public List<string>? MergedFrom { get; init; }

    // Unknown carrier keys, including legacy `resolutions` (old human dismissals), survive read-modify-write untouched.
    // Nothing reads them; no migrator, no silent discard.
    [JsonExtensionData]
    public IDictionary<string, Newtonsoft.Json.Linq.JToken> Unknown { get; init; } = new Dictionary<string, Newtonsoft.Json.Linq.JToken>();

    public string ToJson() => TakeoffJson.Serialize(this);

    public static RegionProvenance Default => new(null, Rooms.RunDrawn, "", 0);

    [JsonIgnore]
    internal bool OriginalUnavailable => this.OriginalTrace != null && this.Partition == null;

    // The data text, fail-closed. The envelope version is the only gate: data that holds its own version, under
    // either spelling an earlier build wrote (`version` on a region, `v` on a zone), is refused.
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
        return provenance.Unknown.Keys.Any(key => string.Equals(key, "version", StringComparison.OrdinalIgnoreCase)
                                                  || string.Equals(key, "v", StringComparison.OrdinalIgnoreCase))
            ? throw new InvalidOperationException("provenance data holds a version; the version belongs to the envelope")
            : provenance;
    }
}

public sealed record ExistingRegion(long ElementId, string UniqueId, List<List<double[]>> Loops, double Sqft);

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
    internal static List<ExistingRegion> ReadExisting(Document doc, View view, RoomsRegionRecord record, string? zone, string role)
    {
        var found = new List<ExistingRegion>();
        foreach (var region in new FilteredElementCollector(doc, view.Id)
                     .OfClass(typeof(FilledRegion)).Cast<FilledRegion>())
        {
            var row = record[region.UniqueId];
            if (row == null || row.Role != role || row.Provenance.Zone != zone) continue;
            var loops = TakeoffAtlas.Boundaries(region);
            if (loops.Count == 0) continue;
            double sqft = region.get_Parameter(BuiltInParameter.HOST_AREA_COMPUTED)?.AsDouble()
                          ?? new ZoneScope { Loops = loops }.ExactGeometry().Area;
            found.Add(new ExistingRegion(region.Id.Value(), region.UniqueId, loops, sqft));
        }
        return found;
    }

    public sealed record MaterializeResult(
        int Created, int Held, int Rebound, int Orphaned, List<string> Failures);

    // First run creates proposals. A rerun is read/propose-only: it rebinds the new result to the
    // accepted baseline and reports unmatched/orphaned facts without creating or overwriting FRs.
    internal static MaterializeResult Materialize(
        Document doc, View view, RoomsRegionRecord record, double elevation, string zone, string runId,
        IReadOnlyList<RoomResult> accepted, IReadOnlyList<ResidueResult> held,
        Action<string> log)
    {
        var frType = new FilteredElementCollector(doc).OfClass(typeof(FilledRegionType))
            .Cast<FilledRegionType>().First();
        var existing = ReadExisting(doc, view, record, zone, TakeoffCarriers.RoleRoomRegion);
        var existingHeld = ReadExisting(doc, view, record, zone, TakeoffCarriers.RoleHeldResidue);
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
                if (loops.Count == 0) continue;   // under 1 sf: nothing to draw
                var region = FilledRegion.Create(doc, frType.Id, view.Id, loops);
                record.Regions.Add(region.UniqueId, new(TakeoffCarriers.RoleRoomRegion, new RoomFields(Type: "hall"),
                    new RegionProvenance(zone, runId, room.Id, room.RawSqft)
                        { Flags = room.Flags.ToList(), Partition = room.Partition }));
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
                    if (loops.Count == 0) continue;   // under 1 sf: nothing to draw
                    var region = FilledRegion.Create(doc, frType.Id, view.Id, loops);
                    record.Regions.Add(region.UniqueId, new(TakeoffCarriers.RoleHeldResidue, new RoomFields(),
                        new RegionProvenance(zone, runId, residue.Id, residue.RawSqft) { Partition = residue.Partition }));
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
                var provenance = record[region.UniqueId]!.Provenance;
                if (!provenance.Flags.Contains("materialization-failure"))
                    provenance.Flags.Add("materialization-failure");
            }

        log($"[materialize] zone={zone} created={created} held={heldDrawn} " +
            $"rebound={rebind.Matched.Count} orphaned={rebind.Orphaned.Count} failures={failures.Count}");
        return new MaterializeResult(created, heldDrawn, rebind.Matched.Count,
            rebind.Orphaned.Count, failures);
    }
}
