using NUnit.Framework;

using Pe.Revit.Takeoff;

namespace Pe.Takeoff.Tests;

// Pre-solve seams on hand-drawn rasters: the census measures, triage decides, hygiene edits. All
// three are pure grid arithmetic, so a 16x16 bool[] is a complete proof.
public sealed class ZoneTriageTests
{
    private const int W = 16, H = 16;
    private const int ZoneCells = 14 * 14;
    private const int RingCells = 14 * 4 - 4;

    // Zone = the 14x14 interior; a boundary ink ring hugging its edge; caller adds floating ink.
    private static (bool[] Ink, bool[] Zone) Grid(params (int X, int Y)[] extraInk)
    {
        var zone = new bool[W * H];
        var ink = new bool[W * H];
        for (int y = 1; y < H - 1; y++)
        for (int x = 1; x < W - 1; x++)
        {
            zone[y * W + x] = true;
            if (x == 1 || x == W - 2 || y == 1 || y == H - 2) ink[y * W + x] = true;
        }
        foreach (var (x, y) in extraInk) ink[y * W + x] = true;
        return (ink, zone);
    }

    private static (int X, int Y)[] Blob(int x0, int y0, int size) =>
        Enumerable.Range(0, size).SelectMany(dy =>
            Enumerable.Range(0, size).Select(dx => (x0 + dx, y0 + dy))).ToArray();

    [Test]
    public void Census_measures_area_ink_and_floating_clusters()
    {
        var (ink, zone) = Grid(Blob(6, 6, 2));
        var census = ZoneCensus.Compute(ink, zone, W, H, cellFt: 1.0);

        Assert.Multiple(() => {
            Assert.That(census.ZoneSqft, Is.EqualTo(ZoneCells).Within(1e-9));
            Assert.That(census.InkSqft, Is.EqualTo(RingCells + 4).Within(1e-9), "ring + blob");
            Assert.That(census.InkRatio,
                Is.EqualTo((RingCells + 4) / (double)ZoneCells).Within(1e-9));
            Assert.That(census.InkClusterCells, Is.EqualTo(new[] { 4 }),
                "only the free-floating blob counts; the boundary-welded ring never does");
            Assert.That(census.EdgeBandInkFraction,
                Is.EqualTo(RingCells / (double)(RingCells + 4)).Within(1e-9),
                "the ring sits in the 2 ft probe band, the interior blob does not");
        });
    }

    [Test]
    public void Census_of_an_empty_zone_is_all_zero()
    {
        var census = ZoneCensus.Compute(new bool[W * H], new bool[W * H], W, H, 1.0);
        Assert.Multiple(() => {
            Assert.That(census.ZoneSqft, Is.Zero);
            Assert.That(census.InkRatio, Is.Zero);
            Assert.That(census.InkClusterCells, Is.Empty);
        });
    }

    [Test]
    public void Triage_solves_when_disarmed_and_holds_only_when_the_knob_is_armed()
    {
        var (ink, zone) = Grid(Blob(6, 6, 2));
        var census = ZoneCensus.Compute(ink, zone, W, H, 1.0);

        Assert.Multiple(() => {
            Assert.That(ZoneTriage.Evaluate(census, new TakeoffOptions { SmallZoneSqft = 0 }).IsHold,
                Is.False, "a disarmed size knob leaves the disposition alone");
            Assert.That(ZoneTriage.Evaluate(census, new TakeoffOptions { SmallZoneSqft = ZoneCells }),
                Is.EqualTo(new ZoneTriageVerdict(ZoneTriageAction.HoldWhole, "small-zone")));
            Assert.That(
                ZoneTriage.Evaluate(census, new TakeoffOptions { SmallZoneSqft = ZoneCells - 1 })
                    .IsHold,
                Is.False, "the small-zone rule is inclusive at the threshold and nowhere above it");
        });
    }

    [Test]
    public void A_zone_the_raster_never_saw_holds_as_no_raster_whatever_the_knobs_say()
    {
        // Attic Level#03 is 5,609 geometric sf whose cell mask comes back empty. Blaming a
        // size threshold for that would attribute a raster failure to a policy decision.
        var census = ZoneCensus.Compute(new bool[W * H], new bool[W * H], W, H, 1.0);

        Assert.Multiple(() => {
            Assert.That(ZoneTriage.Evaluate(census, new TakeoffOptions()),
                Is.EqualTo(new ZoneTriageVerdict(ZoneTriageAction.HoldWhole, "no-raster")),
                "holds unconditionally — there is nothing to partition at any threshold");
            Assert.That(ZoneTriage.Evaluate(census, new TakeoffOptions { SmallZoneSqft = 750 }).Reason,
                Is.EqualTo("no-raster"), "an armed size knob must not steal the attribution");
        });
    }

    [Test]
    public void Low_wall_ratio_lets_the_larger_hold_threshold_apply()
    {
        var (ink, zone) = Grid();       // ring only: ink ratio 52/196 = 0.265
        var census = ZoneCensus.Compute(ink, zone, W, H, 1.0);

        Assert.Multiple(() => {
            Assert.That(ZoneTriage.Evaluate(census, new TakeoffOptions {
                    SmallZoneSqft = 30, SmallZoneLowInkSqft = 200, MinZoneInkRatio = 0.5,
                }),
                Is.EqualTo(new ZoneTriageVerdict(ZoneTriageAction.HoldWhole, "low-wall-ratio")));
            Assert.That(ZoneTriage.Evaluate(census, new TakeoffOptions {
                SmallZoneSqft = 30, SmallZoneLowInkSqft = 200, MinZoneInkRatio = 0.2,
            }).IsHold, Is.False, "ink-rich enough to solve, and above the plain small-zone bar");
        });
    }

    [Test]
    public void Hygiene_removes_floating_blobs_and_never_the_boundary_ring()
    {
        var (ink, zone) = Grid(Blob(3, 3, 2).Concat(Blob(8, 8, 3)).ToArray());

        var small = InkHygiene.RemoveFloatingClusters(
            ink, zone, W, H, minClusterCells: 5, maxClusterBboxFt: 0, cellFt: 1.0);

        Assert.Multiple(() => {
            Assert.That(small.RemovedCells, Is.EqualTo(4), "only the 2x2 blob is under 5 cells");
            Assert.That(small.Ink[3 * W + 3], Is.False);
            Assert.That(small.Ink[8 * W + 8], Is.True, "the 9-cell blob survives the cell-count rule");
            Assert.That(small.Ink[1 * W + 1], Is.True, "boundary-welded ink is never touched");
            Assert.That(ink[3 * W + 3], Is.True, "the transform is pure — the input is untouched");
        });
    }

    [Test]
    public void Hygiene_bbox_rule_catches_a_compact_cluster_above_the_cell_count()
    {
        var (ink, zone) = Grid(Blob(8, 8, 3));

        var byBbox = InkHygiene.RemoveFloatingClusters(
            ink, zone, W, H, minClusterCells: 5, maxClusterBboxFt: 3.0, cellFt: 1.0);

        Assert.That(byBbox.RemovedCells, Is.EqualTo(9),
            "9 cells is over the count bar but fits inside a 3 ft square");
    }

    [Test]
    public void Hygiene_is_a_no_op_when_both_knobs_are_off()
    {
        var (ink, zone) = Grid(Blob(6, 6, 2));
        var untouched = InkHygiene.RemoveFloatingClusters(ink, zone, W, H, 0, 0, 1.0);
        Assert.Multiple(() => {
            Assert.That(untouched.RemovedCells, Is.Zero);
            Assert.That(untouched.Ink, Is.EqualTo(ink));
        });
    }

    [Test]
    public void Ink_welded_to_the_boundary_ring_is_structure_however_small_the_bar()
    {
        var (ink, zone) = Grid();
        ink[7 * W + 1] = true;  // a stub reaching inward from the ring
        ink[7 * W + 2] = true;
        ink[7 * W + 3] = true;
        var census = ZoneCensus.Compute(ink, zone, W, H, 1.0);
        var cleaned = InkHygiene.RemoveFloatingClusters(ink, zone, W, H, 1000, 0, 1.0);

        Assert.Multiple(() => {
            Assert.That(census.InkClusterCells, Is.Empty);
            Assert.That(cleaned.RemovedCells, Is.Zero);
        });
    }
}
