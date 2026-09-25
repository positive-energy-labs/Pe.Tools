using System.Globalization;
using System.Security.Cryptography;
using System.Text;
using Pe.Revit.Space;

namespace Pe.Revit.Takeoff;

public sealed record RegionMeasurement(
    string GeometryKey, string RunId, double? FloorZ, double? CeilingZ, string? Hold);

/// <summary>Explicit measurement of the designer's native shapes; never changes their geometry or role.</summary>
internal static class RegionMeasurements
{
    internal static string GeometryKey(double elevation, IEnumerable<List<List<double[]>>> boundaries)
    {
        var shapes = boundaries.Select(loops => {
            var geometry = new ZoneScope { Loops = loops }.ExactGeometry();
            geometry.Normalize();
            return geometry.AsText();
        }).OrderBy(value => value, StringComparer.Ordinal);
        using var hash = SHA256.Create();
        return Convert.ToBase64String(hash.ComputeHash(Encoding.UTF8.GetBytes(
            elevation.ToString("R", CultureInfo.InvariantCulture) + "|" + string.Join("|", shapes))));
    }

    // A room's zone need not be a live Zoning Region: a zone that flipped to a room is its own zone, and a drawn room
    // outside every zone carries the level scope guid. Then the regions sharing that guid are the whole scope.
    internal static string ScopeKey(Document doc, View view, Guid zoneGuid)
    {
        var zone = new FilteredElementCollector(doc).OfClass(typeof(FilledRegion)).Cast<FilledRegion>()
            .SingleOrDefault(fr => TakeoffCarriers.ReadIdentity(fr) == (TakeoffCarriers.RoleZoningRegion, zoneGuid));
        if (zone != null && zone.OwnerViewId != view.Id)
            throw new InvalidOperationException("Zoning Region and Room Region views disagree");
        var regions = ZoneMaterializer.ReadExisting(doc, view, zoneGuid, TakeoffCarriers.RoleRoomRegion)
            .Concat(ZoneMaterializer.ReadExisting(doc, view, zoneGuid, TakeoffCarriers.RoleHeldResidue));
        return ScopeKey(view.GenLevel?.ProjectElevation
            ?? throw new InvalidOperationException("Takeoff view has no level"),
            zone == null ? null : TakeoffAtlas.Boundaries(zone), regions.Select(r => r.Loops));
    }

    internal static string ScopeKey(double elevation, List<List<double[]>>? zone, IEnumerable<List<List<double[]>>> regions) =>
        GeometryKey(elevation, (zone == null ? [] : new[] { zone }).Concat(regions));

    internal static TakeoffRegionAnalysis Read(RegionProvenance provenance, string geometryKey)
    {
        var measurement = provenance.Measurement;
        if (measurement is null) return new("unmeasured", null, null, null, "remeasure-required");
        return measurement.GeometryKey == geometryKey
            ? new("current", measurement.RunId, measurement.FloorZ, measurement.CeilingZ, measurement.Hold)
            : new("stale", measurement.RunId, null, null, "geometry-changed");
    }

    internal static void Measure(Document doc, View view, Guid zoneGuid, string runId)
    {
        var regions = ZoneMaterializer.ReadExisting(doc, view, zoneGuid, TakeoffCarriers.RoleRoomRegion)
            .Concat(ZoneMaterializer.ReadExisting(doc, view, zoneGuid, TakeoffCarriers.RoleHeldResidue)).ToList();
        var key = ScopeKey(doc, view, zoneGuid);
        var levelZ = view.GenLevel.ProjectElevation;
        foreach (var region in regions)
        {
            var shape = new ZoneScope { Loops = region.Loops }.ExactGeometry();
            var label = shape.InteriorPoint.Coordinate;
            // ponytail: one interior height probe, matching Partition; sample multiple points when variable-height rooms are supported.
            var probe = Pe.Revit.Space.Verbs.Probe(doc, new XYZ(label.X, label.Y, levelZ + 3.5), purpose: ProbePurpose.RoomHeights);
            if (!probe.Stamp.Fresh || probe.Stamp.BuiltUtc == default)
                throw new InvalidOperationException("Native measurement requires fresh Space evidence");
            var floor = probe.Floor?.Z;
            var ceiling = probe.Ceiling?.Z;
            var knobs = Pe.Revit.Partition.Knobs.Default;
            string? hold = floor is not { } fz || Math.Abs(fz - levelZ) > knobs.FloorTolFt ? "no-floor"
                : ceiling is null ? "no-ceiling"
                : ceiling - floor < knobs.MinHeadroomFt ? "low-headroom" : null;
            var fr = (FilledRegion)doc.GetElement(region.ElementId.ToElementId());
            var provenance = RegionProvenance.FromJson(TakeoffCarriers.ReadProvenance(fr)!);
            TakeoffCarriers.WriteProvenance(fr, (provenance with {
                Measurement = new(key + GeometryKey(levelZ, [region.Loops]), runId, floor, ceiling, hold)
            }).ToJson());
        }
    }
}
