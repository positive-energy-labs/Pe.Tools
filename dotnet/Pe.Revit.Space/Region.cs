namespace Pe.Revit.Space;

/// <summary>A room or space UniqueId, or a box in host internal feet.</summary>
public sealed record Region(string Kind, string? UniqueId = null, double[]? Box = null);

public static class RegionBounds {
    /// <summary>
    ///     A region is admission for the verbs whose question has its own reach (Sweep, Probe, scene focus): the verb prepares
    ///     only that reach, never the region box, and the region only says where the caller may ask. Sweep: every polyline point
    ///     lies inside the region. The profile, clearance and reach prisms extend past it by their own size, because a sweep
    ///     along a wall must still see the wall. Rows, Tree and Slice read the region itself, so they prepare it.
    /// </summary>
    public static void AdmitSweep(this Aabb region, IReadOnlyList<XYZ> polyline) {
        foreach (var point in polyline)
            if (!region.Contains(point))
                throw new ArgumentException($"Sweep point ({point.X:0.###}, {point.Y:0.###}, {point.Z:0.###}) lies outside the region {region}; every polyline point must lie inside it.");
    }

    /// <summary>
    ///     Probe: the probe point lies inside the region; the vertical column may leave it. A floor slab and a ceiling sit at or
    ///     just past a room's box, and they are exactly what Probe reads.
    /// </summary>
    public static void AdmitProbe(this Aabb region, XYZ at) {
        if (!region.Contains(at))
            throw new ArgumentException($"Probe point ({at.X:0.###}, {at.Y:0.###}, {at.Z:0.###}) lies outside the region {region}; the point must lie inside it (its column may leave).");
    }

    private static bool Contains(this Aabb region, XYZ p) =>
        p.X >= region.MinX && p.X <= region.MaxX && p.Y >= region.MinY && p.Y <= region.MaxY && p.Z >= region.MinZ && p.Z <= region.MaxZ;

    public static Aabb Resolve(this Region region, Document document) {
        double[] values;
        if (region.Kind == "box") values = region.Box ?? [];
        else {
            var element = region.UniqueId is { Length: > 0 } ? document.GetElement(region.UniqueId) : null;
            if (!(region.Kind == "room" && element is Autodesk.Revit.DB.Architecture.Room
                  || region.Kind == "space" && element is Autodesk.Revit.DB.Mechanical.Space))
                throw new ArgumentException("Region must name a room or space by UniqueId, or an explicit box.");
            var bounds = element!.get_BoundingBox(null) ?? throw new ArgumentException("Region has no bounding box.");
            var corners = new[] { bounds.Min.X, bounds.Max.X }.SelectMany(x =>
                new[] { bounds.Min.Y, bounds.Max.Y }.SelectMany(y =>
                    new[] { bounds.Min.Z, bounds.Max.Z }.Select(z => bounds.Transform.OfPoint(new XYZ(x, y, z))))).ToList();
            values = [corners.Min(p => p.X), corners.Min(p => p.Y), corners.Min(p => p.Z),
                corners.Max(p => p.X), corners.Max(p => p.Y), corners.Max(p => p.Z)];
        }
        if (values.Length != 6 || values.Any(v => double.IsNaN(v) || double.IsInfinity(v))
            || values[0] >= values[3] || values[1] >= values[4] || values[2] >= values[5])
            throw new ArgumentException("Region box needs six finite bounds with positive extent.");
        return new Aabb(values[0], values[1], values[2], values[3], values[4], values[5]);
    }
}
