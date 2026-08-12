using NUnit.Framework;
using Pe.Revit.Takeoff;

namespace Pe.Takeoff.Tests;

public sealed class StrictSpaceBoundaryNetworkTests
{
    [Test]
    public void Reconstructs_adjacent_rectangles_from_one_shared_straight_network()
    {
        var result = StrictSpaceBoundaryNetwork.Build([
            Room("R01", 5, 5, (0, 0), (10, 0), (10, 10), (0, 10)),
            Room("R02", 15, 5, (10, 0), (20, 0), (20, 10), (10, 10)),
        ], cellFt: 1, simplifyFt: 2);

        Assert.Multiple(() =>
        {
            Assert.That(result.DroppedRoomIds, Is.Empty);
            Assert.That(result.AcceptedRooms.Select(room => room.Id),
                Is.EqualTo(new[] { "R01", "R02" }));
            Assert.That(result.AcceptedRooms.Select(room => room.RawSqft),
                Is.EqualTo(new[] { 100d, 100d }));
            // Top and bottom spans merge across the shared-room junction; the divider remains.
            Assert.That(result.Curves, Has.Count.EqualTo(5));
            Assert.That(result.Curves, Has.All.Matches<BoundaryCurve>(curve =>
                Math.Abs(curve.X1 - curve.X2) < 1e-9 || Math.Abs(curve.Y1 - curve.Y2) < 1e-9));
        });
    }

    [Test]
    public void Drops_a_whole_room_when_a_large_unexplained_staircase_cannot_be_ruled_straight()
    {
        var outline = new List<(double X, double Y)> {
            (0, 0), (500, 0), (500, 500), (300, 500),
        };
        Stair(outline, 300, 500, 250, 470);
        Stair(outline, 250, 470, 200, 500);
        outline.Add((0, 500));

        var result = StrictSpaceBoundaryNetwork.Build([
            Room("bad", 250, 250, outline.ToArray()),
        ], cellFt: 1, simplifyFt: 4);

        Assert.Multiple(() =>
        {
            Assert.That(result.DroppedRoomIds, Is.EqualTo(new[] { "bad" }));
            Assert.That(result.AcceptedRooms, Is.Empty);
            Assert.That(result.Curves, Is.Empty);
        });
    }

    private static RoomResult Room(
        string id, double labelX, double labelY, params (double X, double Y)[] points)
    {
        var polygon = points.Select(point => new[] { point.X, point.Y }).ToList();
        return new RoomResult {
            Id = id,
            LabelX = labelX,
            LabelY = labelY,
            RawSqft = Math.Abs(SignedArea(polygon)),
            Polygon = polygon,
        };
    }

    private static void Stair(
        List<(double X, double Y)> points, int fromX, int fromY, int toX, int toY)
    {
        int x = fromX, y = fromY;
        int dx = Math.Sign(toX - fromX), dy = Math.Sign(toY - fromY);
        while (x != toX || y != toY)
        {
            if (x != toX) points.Add((x += dx, y));
            if (y != toY) points.Add((x, y += dy));
        }
    }

    private static double SignedArea(IReadOnlyList<double[]> polygon)
    {
        double twiceArea = 0;
        for (int i = 0; i < polygon.Count; i++)
        {
            var a = polygon[i];
            var b = polygon[(i + 1) % polygon.Count];
            twiceArea += a[0] * b[1] - b[0] * a[1];
        }
        return twiceArea / 2;
    }
}
