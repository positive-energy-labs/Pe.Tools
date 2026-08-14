using Newtonsoft.Json;

namespace Pe.Revit.Takeoff;

// Pipeline step 3's write side: accepted rooms become persistent, editable Room Region FRs inside
// their Zoning Region; held residue becomes visible held-residue FRs. FR-only — Spaces are out of
// the critical path (DECISIONS). Identity is geometric, never rank: reruns re-bind existing
// regions by label-point containment + area +/-20% (the proven anchor law) and NEVER touch a
// designer's existing region — propose, never overwrite.
public sealed record RegionProvenance(
    int Version,
    Guid ZoneGuid,
    string RunId,
    string SourceRoomId,
    double SourceSqft)
{
    public string ToJson() => JsonConvert.SerializeObject(this);

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

public sealed record ExistingRegion(long ElementId, Guid Guid, List<double[]> Polygon, double Sqft);

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
            if (!ZoneScope.ContainsEvenOdd(new List<List<double[]>> { region.Polygon },
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
            var boundary = region.GetBoundaries();
            if (boundary.Count == 0) continue;
            var outer = boundary
                .Select(loop => loop.Select(curve => {
                    var p = curve.GetEndPoint(0);
                    return new[] { p.X, p.Y };
                }).ToList())
                .OrderByDescending(pts => Math.Abs(Detector.Shoelace(pts)))
                .First();
            double sqft = region.get_Parameter(BuiltInParameter.HOST_AREA_COMPUTED)?.AsDouble()
                          ?? Math.Abs(Detector.Shoelace(outer));
            found.Add(new ExistingRegion(region.Id.Value(), frGuid.Value, outer, sqft));
        }
        return found;
    }

    public sealed record MaterializeResult(
        int Created, int Held, int Rebound, int Orphaned, List<string> Failures);

    // First run: creates everything. Rerun: re-binds by geometry, creates only unmatched rooms,
    // touches no existing region, reports orphans. Caller owns the transaction and the zone's
    // registered identity.
    public static MaterializeResult Materialize(
        Document doc, View view, double elevation, Guid zoneGuid, string runId,
        IReadOnlyList<RoomResult> accepted, IReadOnlyList<ResidueResult> held,
        Action<string> log)
    {
        TakeoffCarriers.EnsureBindings(doc);
        var frType = new FilteredElementCollector(doc).OfClass(typeof(FilledRegionType))
            .Cast<FilledRegionType>().First();
        var existing = ReadExisting(doc, view, zoneGuid, TakeoffCarriers.RoleRoomRegion);
        var rebind = Rebind(accepted, existing);
        var failures = new List<string>();
        int created = 0, heldDrawn = 0;

        foreach (var room in rebind.Unmatched)
        {
            try
            {
                var loops = new List<CurveLoop> { Annotate.ToLoop(room.Polygon, elevation) };
                loops.AddRange(room.Holes.Select(hole => Annotate.ToLoop(hole, elevation)));
                var region = FilledRegion.Create(doc, frType.Id, view.Id, loops);
                TakeoffCarriers.WriteIdentity(region, TakeoffCarriers.RoleRoomRegion, Guid.NewGuid());
                TakeoffCarriers.WriteProvenance(region,
                    new RegionProvenance(1, zoneGuid, runId, room.Id, room.RawSqft).ToJson());
                created++;
            }
            catch (Exception ex)
            {
                // Drop, don't mangle: a room Revit rejects stays visible as a failure, never bent.
                failures.Add($"{room.Id}: {ex.Message}");
            }
        }

        var existingHeld = ReadExisting(doc, view, zoneGuid, TakeoffCarriers.RoleHeldResidue);
        if (existingHeld.Count == 0)
            foreach (var residue in held)
            {
                try
                {
                    var loops = new List<CurveLoop> { Annotate.ToLoop(residue.Polygon, elevation) };
                    var region = FilledRegion.Create(doc, frType.Id, view.Id, loops);
                    TakeoffCarriers.WriteIdentity(region, TakeoffCarriers.RoleHeldResidue, Guid.NewGuid());
                    TakeoffCarriers.WriteProvenance(region,
                        new RegionProvenance(1, zoneGuid, runId, residue.Id, residue.RawSqft).ToJson());
                    heldDrawn++;
                }
                catch (Exception ex)
                {
                    failures.Add($"{residue.Id}: {ex.Message}");
                }
            }

        log($"[materialize] zone={zoneGuid:D} created={created} held={heldDrawn} " +
            $"rebound={rebind.Matched.Count} orphaned={rebind.Orphaned.Count} failures={failures.Count}");
        return new MaterializeResult(created, heldDrawn, rebind.Matched.Count,
            rebind.Orphaned.Count, failures);
    }
}
