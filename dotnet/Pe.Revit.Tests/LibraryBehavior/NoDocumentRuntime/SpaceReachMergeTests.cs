using Pe.Revit.Space;

namespace Pe.Revit.Tests;

public sealed class SpaceReachMergeTests {
    [Test]
    public void OverlappingReachBoxesMergeDistantOnesStayAndEveryBoxStaysCovered() {
        static (XYZ, XYZ) Box(double x, double y, double z, double size) => (new XYZ(x, y, z), new XYZ(x + size, y + size, z + size));
        // A run of overlapping reach boxes along x, one far member (Cleremont SA 2), one box inside another.
        var boxes = new List<(XYZ Min, XYZ Max)> { Box(0, 0, 0, 20), Box(2, 0, 0, 20), Box(4, 0, 0, 20), Box(1500, 0, 0, 20), Box(5, 5, 5, 2) };
        var merged = Pe.Revit.Space.Partition.Merge([.. boxes]);
        Assert.That(merged, Has.Count.EqualTo(2), "The overlapping run and the box inside it collapse; the far member stays apart.");
        foreach (var (min, max) in boxes)
            Assert.That(merged.Any(m => m.Min.X <= min.X && m.Min.Y <= min.Y && m.Min.Z <= min.Z
                && m.Max.X >= max.X && m.Max.Y >= max.Y && m.Max.Z >= max.Z), Is.True, "A merge never drops coverage.");
    }
}
