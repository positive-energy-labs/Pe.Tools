using NUnit.Framework;
using Pe.Revit.Takeoff;

namespace Pe.Takeoff.Tests;

public sealed class LevelFootprintTests
{
    [Test]
    public void Keeps_only_same_level_floor_sealed_by_architectural_ink()
    {
        var field = Field(9, 9);
        var obstruction = RectangleWithGap(gap: false);

        var footprint = Detector.InkBoundedFloor(field, obstruction, 0, 0.1);

        Assert.Multiple(() =>
        {
            Assert.That(footprint[4 * 9 + 4], Is.True);
            Assert.That(footprint[2 * 9 + 4], Is.True);
            Assert.That(footprint[1 * 9 + 4], Is.False);
        });
    }

    [Test]
    public void Open_plan_does_not_promote_its_floor_to_room_domain()
    {
        var field = Field(9, 9);
        var footprint = Detector.InkBoundedFloor(field, RectangleWithGap(gap: true), 0, 0.1);
        var domain = PartitionFormulation.BuildDomain(
            field, 0, new TakeoffOptions { CellFt = 1, RequireCeiling = false }, footprint);

        Assert.That(domain[4 * 9 + 4], Is.False);
    }

    [Test]
    public void Remote_header_ink_is_not_admitted_by_unbounded_floor_edges()
    {
        var field = Field(9, 9);
        var options = new TakeoffOptions {
            CellFt = 1,
            HeaderNearFt = 1,
            GapSealFt = 0,
            SealDoorHeads = false,
            SealWallRunGaps = false,
        };
        var plan = RectangleWithGap(gap: false);
        var header = new bool[81];
        header[0] = true;
        header[3 * 9 + 3] = true;
        var provisional = ProjectionSeed.ComposeInk(
            plan, header, 9, 9, 1, options, floorEdge: null);
        var obstruction = Detector.BuildObstruction(field, provisional, 0, options, _ => { });
        var footprint = Detector.InkBoundedFloor(field, obstruction, 0, 0.1);
        var floorEdge = new bool[81];
        for (var y = 0; y < 9; y++)
        for (var x = 0; x < 9; x++)
        {
            var i = y * 9 + x;
            if (!footprint[i]) continue;
            floorEdge[i] = x > 0 && !footprint[i - 1]
                           || x < 8 && !footprint[i + 1]
                           || y > 0 && !footprint[i - 9]
                           || y < 8 && !footprint[i + 9];
        }

        var composed = ProjectionSeed.ComposeInk(
            plan, header, 9, 9, 1, options, floorEdge);

        Assert.Multiple(() =>
        {
            Assert.That(composed[0], Is.False);
            Assert.That(composed[3 * 9 + 3], Is.True);
        });
    }

    [Test]
    public void Profile_inference_ignores_unsupported_floor_without_rewriting_capture()
    {
        var field = Field(9, 9);
        for (var y = 0; y < 9; y++)
        for (var x = 0; x < 9; x++)
            field.CeilZ[y * 9 + x] = x is >= 2 and <= 6 && y is >= 2 and <= 6 ? 10 : 25;
        var obstruction = RectangleWithGap(gap: false);
        var profile = TakeoffPolicy.InferLevelProfile(new DetectSnapshot {
            LevelName = "test",
            LevelElevation = 0,
            Field = field,
            SeedInk = obstruction,
        });

        Assert.Multiple(() =>
        {
            Assert.That(field.FloorZ[4 * 9 + 4], Is.EqualTo(0));
            Assert.That(field.FloorZ[0], Is.EqualTo(0));
            Assert.That(field.CeilZ[0], Is.EqualTo(25));
            Assert.That(profile.DoubleHeightFraction, Is.Zero);
            Assert.That(profile.Options.StoryCapFt, Is.EqualTo(14));
        });
    }

    private static bool[] RectangleWithGap(bool gap)
    {
        var obstruction = new bool[81];
        for (var x = 2; x <= 6; x++)
        {
            if (!gap || x != 4) obstruction[2 * 9 + x] = true;
            obstruction[6 * 9 + x] = true;
        }
        for (var y = 2; y <= 6; y++)
        {
            obstruction[y * 9 + 2] = true;
            obstruction[y * 9 + 6] = true;
        }
        return obstruction;
    }

    private static Heightfield Field(int width, int height) => new()
    {
        W = width,
        H = height,
        CellFt = 1,
        FloorZ = Enumerable.Repeat(0f, width * height).ToArray(),
        CeilZ = Enumerable.Repeat(10f, width * height).ToArray(),
    };
}
