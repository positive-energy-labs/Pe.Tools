using NUnit.Framework;
using Pe.Revit.Takeoff;

namespace Pe.Takeoff.Tests;

public sealed class TakeoffEvidenceFidelityTests
{
    [Test]
    public void Snapshot_ink_distance_uses_captured_grid_in_model_feet()
    {
        var snapshot = new DetectSnapshot {
            Field = new Heightfield { W = 3, H = 3, MinX = 10, MinY = 20, CellFt = 0.5 },
            SeedInk = new[] { false, false, false, false, true, false, false, false, false },
        };

        var distance = snapshot.SeedInkDistance();

        Assert.Multiple(() => {
            Assert.That(distance(10.75, 20.75), Is.Zero);
            Assert.That(distance(11.25, 20.75), Is.EqualTo(0.5).Within(1e-9));
            Assert.That(distance(9, 20), Is.EqualTo(double.PositiveInfinity));
        });
    }

    [Test]
    public void Exposed_edge_parallel_to_ink_is_rejected_at_half_foot_offset()
    {
        var rooms = new[] { Rect("room", 0, 0, 10, 8) };
        double Ink(double x, double y) => x >= 0 && x <= 10 ? Math.Abs(y - 8.5) : 99;

        var result = TakeoffEvidenceFidelity.Evaluate(rooms, Ink);

        Assert.That(result.Select(item => item.RoomId), Does.Contain("room"));
        Assert.That(Math.Abs(result.Single(item => item.RoomId == "room").BestOffsetFt),
            Is.InRange(0.25, 0.75));
    }

    [Test]
    public void Shared_edge_without_ink_is_not_an_exposed_rail()
    {
        var rooms = new[] { Rect("left", 0, 0, 10, 8), Rect("right", 10, 0, 20, 8) };
        double Ink(double x, double y) => y >= 0 && y <= 8 ? Math.Abs(x - 10.5) : 99;

        var result = TakeoffEvidenceFidelity.Evaluate(rooms, Ink);

        Assert.That(result, Is.Empty);
    }

    [Test]
    public void Aligned_exposed_rectangle_is_not_rejected()
    {
        var rooms = new[] { Rect("room", 0, 0, 10, 8) };
        double Ink(double x, double y) => Math.Min(Math.Min(Math.Abs(x), Math.Abs(x - 10)),
            Math.Min(Math.Abs(y), Math.Abs(y - 8)));

        Assert.That(TakeoffEvidenceFidelity.Evaluate(rooms, Ink), Is.Empty);
    }

    [Test]
    public void Far_parallel_rail_is_review_only_not_a_misalignment()
    {
        var rooms = new[] { Rect("room", 0, 0, 10, 8) };
        double Ink(double x, double y) => x >= 0 && x <= 10 ? Math.Abs(y - 9.25) : 99;

        Assert.That(TakeoffEvidenceFidelity.Evaluate(rooms, Ink), Is.Empty);
    }

    private static RoomResult Rect(string id, double minX, double minY, double maxX, double maxY) => new()
    {
        Id = id,
        RawSqft = (maxX - minX) * (maxY - minY),
        LabelX = (minX + maxX) / 2,
        LabelY = (minY + maxY) / 2,
        Polygon = new List<double[]> {
            new[] { minX, minY }, new[] { maxX, minY },
            new[] { maxX, maxY }, new[] { minX, maxY },
        },
    };
}
