using NUnit.Framework;
using Pe.Revit.Takeoff;

namespace Pe.Takeoff.Tests;

public sealed class ZoneScopeTests
{
    [Test]
    public void Exact_geometry_uses_even_odd_loops_for_area_and_holes()
    {
        var zone = new ZoneScope {
            Name = "courtyard",
            Loops = {
                Loop((0, 0), (10, 0), (10, 10), (0, 10)),
                Loop((2, 2), (4, 2), (4, 4), (2, 4)),
            },
        };

        var geometry = zone.ExactGeometry();

        Assert.Multiple(() => {
            Assert.That(geometry.Area, Is.EqualTo(96).Within(1e-9));
            Assert.That(geometry.Covers(geometry.Factory.CreatePoint(
                new NetTopologySuite.Geometries.Coordinate(1, 1))), Is.True);
            Assert.That(geometry.Covers(geometry.Factory.CreatePoint(
                new NetTopologySuite.Geometries.Coordinate(3, 3))), Is.False);
        });
    }

    private static List<double[]> Loop(params (double X, double Y)[] points) =>
        points.Select(point => new[] { point.X, point.Y }).ToList();
}
