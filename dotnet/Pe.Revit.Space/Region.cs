namespace Pe.Revit.Space;

/// <summary>A room or space UniqueId, or a box in host internal feet.</summary>
public sealed record Region(string Kind, string? UniqueId = null, double[]? Box = null);

public static class RegionBounds {
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
