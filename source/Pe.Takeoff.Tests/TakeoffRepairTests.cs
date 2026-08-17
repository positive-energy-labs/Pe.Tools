using NetTopologySuite.Geometries;
using NUnit.Framework;
using Pe.Revit.Takeoff;

namespace Pe.Takeoff.Tests;

/// <summary>
/// Direct coverage for the zone-fit repair composite (SquareFitArtifacts / SquareDebrisRuns /
/// RepairFitArtifacts) and the projector's DeJog fence. These paths previously had only
/// pipeline-level gates; each test here pins one contract with a synthetic polygon whose
/// arithmetic is derived by hand against the implementation.
/// </summary>
[TestFixture]
public sealed class TakeoffRepairTests
{
    private static readonly GeometryFactory Factory = new();

    private const double Budget = 1.0;   // the ZoneClipSquareFt default the pipeline runs with

    private static Polygon Poly(params (double X, double Y)[] points)
    {
        var coordinates = points.Select(p => new Coordinate(p.X, p.Y)).ToList();
        coordinates.Add(new Coordinate(points[0].X, points[0].Y));
        return Factory.CreatePolygon(coordinates.ToArray());
    }

    // A zone so large that containment never binds: these tests judge the repair geometry, not
    // the zone law (which has its own pipeline gates).
    private static readonly Polygon WideZone = Poly((-50, -50), (100, -50), (100, 100), (-50, 100));

    private static readonly List<(string Id, Polygon Geometry)> NoNeighbors = [];

    private static void AssertAllEdgesOnFrame(Polygon polygon, double axisToleranceRadians = 1e-9)
    {
        var points = polygon.ExteriorRing.Coordinates;
        for (int i = 0; i < points.Length - 1; i++)
        {
            double angle = Math.Abs(Math.Atan2(
                points[i + 1].Y - points[i].Y, points[i + 1].X - points[i].X)) % (Math.PI / 2);
            angle = Math.Min(angle, Math.PI / 2 - angle);
            Assert.That(angle, Is.LessThanOrEqualTo(axisToleranceRadians),
                $"edge {i} ({points[i]} -> {points[i + 1]}) is off-frame");
        }
    }

    // ------------------------------------------------------------------ SquareFitArtifacts

    [Test]
    public void Square_fit_repairs_a_single_off_frame_edge_within_budget()
    {
        // A clip cut the top-right corner with one off-frame 45-degree edge (0.8 ft deviation,
        // within the 1.0 ft budget) between two anchor-scale frame edges. The repair must
        // decompose it onto the frame; the corner restore wins on area, recovering the full
        // rectangle.
        var cut = Poly((0, 0), (20, 0), (20, 9.2), (19.2, 10), (0, 10));

        var squared = TakeoffPromotion.SquareFitArtifacts(cut, WideZone, NoNeighbors, Budget);

        Assert.That(squared, Is.Not.Null);
        AssertAllEdgesOnFrame(squared!);
        Assert.That(squared!.Area, Is.EqualTo(200.0).Within(1e-6));
    }

    [Test]
    public void Square_fit_refuses_a_corner_chamfer_beyond_the_displacement_budget()
    {
        // The same cut at 2 ft deviation: a genuine corner chamfer, not arithmetic debris. The
        // displacement budget (1.0 ft) is what separates the two — the repair must refuse.
        var chamfer = Poly((0, 0), (20, 0), (20, 8), (18, 10), (0, 10));

        Assert.That(
            TakeoffPromotion.SquareFitArtifacts(chamfer, WideZone, NoNeighbors, Budget), Is.Null);
    }

    [Test]
    public void LIMITATION_a_tilted_longest_edge_wins_the_anchor_election_and_is_not_squared()
    {
        // Documented limitation, not a blessing: when the off-frame edge is the ring's LONGEST
        // edge (a 20x10 rectangle whose whole top edge tilts 0.3 ft), the anchor law — the
        // longer adjacent edge speaks for the frame — elects the TILT as frame authority for
        // its neighbors. The repair then squares the short sides into the tilted frame instead
        // of squaring the tilt, and the output is not frame-clean. The pipeline stays safe
        // (the unmodified admission audit re-judges and the fit falls back), but the repair
        // cannot land this shape. If this test ever fails with an on-frame result, the
        // limitation has been fixed — delete this test and write the positive one.
        var tilted = Poly((0, 0), (20, 0), (20, 10.3), (0, 10));

        var squared = TakeoffPromotion.SquareFitArtifacts(tilted, WideZone, NoNeighbors, Budget);

        Assert.That(squared, Is.Not.Null, "the repair engages (on the wrong edges)");
        bool allOnFrame = true;
        var points = squared!.ExteriorRing.Coordinates;
        for (int i = 0; i < points.Length - 1 && allOnFrame; i++)
        {
            double angle = Math.Abs(Math.Atan2(
                points[i + 1].Y - points[i].Y, points[i + 1].X - points[i].X)) % (Math.PI / 2);
            allOnFrame = Math.Min(angle, Math.PI / 2 - angle) <= 1e-9;
        }
        Assert.That(allOnFrame, Is.False,
            "tilted-longest-edge is now squared clean — promote this to a positive test");
    }

    [Test]
    public void Square_fit_leaves_a_lawful_L_untouched()
    {
        // Every edge on-frame and anchor-scale: a genuine architectural L, not fit debris.
        var lShape = Poly((0, 0), (10, 0), (10, 4), (4, 4), (4, 10), (0, 10));

        Assert.That(
            TakeoffPromotion.SquareFitArtifacts(lShape, WideZone, NoNeighbors, Budget), Is.Null);
    }

    // ------------------------------------------------------------------ SquareDebrisRuns

    [Test]
    public void Debris_run_collapses_to_the_chord_when_the_chord_lies_on_frame()
    {
        // Top edge interrupted by a sub-anchor zigzag (every run edge < 2 ft, off-frame members
        // present) whose endpoints are level: the lawful repair is the straight chord.
        var zigzag = Poly(
            (0, 0), (20, 0), (20, 10), (12, 10),
            (11, 10.4), (9.5, 10.4),                 // stranded debris riding 0.4 ft proud
            (8, 10), (0, 10));

        var collapsed = TakeoffPromotion.SquareDebrisRuns(
            zigzag, WideZone, NoNeighbors, Budget, allowedOutside: 1e-6, allowedOverlap: 1e-6);

        Assert.That(collapsed, Is.Not.Null);
        AssertAllEdgesOnFrame(collapsed!);
        Assert.That(collapsed!.Area, Is.EqualTo(200.0).Within(1e-6),
            "the chord repair must land exactly on the 20x10 rectangle");
        // The chord's endpoints survive as collinear vertices (the splice replaces, it does not
        // simplify) — shape-wise this IS the rectangle.
        Assert.That(collapsed.ExteriorRing.NumPoints - 1, Is.EqualTo(6));
    }

    [Test]
    public void Debris_run_restores_the_corner_when_the_chord_is_off_frame()
    {
        // A clipped corner: two sub-anchor off-frame edges chamfering the (20,10) corner. The
        // chord itself is off-frame, so the repair must go through an inserted frame corner.
        var chamfered = Poly(
            (0, 0), (20, 0), (20, 9),
            (19.4, 9.7),                             // debris chamfer, edges ~0.9 ft
            (18.6, 10), (0, 10));

        var repaired = TakeoffPromotion.SquareDebrisRuns(
            chamfered, WideZone, NoNeighbors, Budget, allowedOutside: 1e-6, allowedOverlap: 1e-6);

        Assert.That(repaired, Is.Not.Null);
        AssertAllEdgesOnFrame(repaired!);
        Assert.That(repaired!.Area, Is.EqualTo(200.0).Within(1e-6),
            "the corner restore must recover the full rectangle");
    }

    [Test]
    public void Debris_run_decomposes_a_long_shallow_cut_into_a_coarse_staircase()
    {
        // A shallow diagonal cut: 5 ft along, 1.8 ft rise, in four sub-anchor edges. One corner
        // would displace the boundary by the full 1.8 ft rise (over the 1.0 ft budget); the
        // lawful decomposition is a two-riser staircase (treads 2.5 ft, risers 0.9 ft).
        var cut = Poly(
            (0, 0), (20, 0), (20, 10), (14, 10),
            (12.75, 9.55), (11.5, 9.1), (10.25, 8.65),
            (9, 8.2), (0, 8.2));

        var repaired = TakeoffPromotion.SquareDebrisRuns(
            cut, WideZone, NoNeighbors, Budget, allowedOutside: 1e-6, allowedOverlap: 1e-6);

        Assert.That(repaired, Is.Not.Null);
        AssertAllEdgesOnFrame(repaired!);
        // The staircase must track the cut within the displacement budget: the area between
        // repair and source is bounded by budget x run length.
        Assert.That(repaired!.SymmetricDifference(cut).Area, Is.LessThanOrEqualTo(Budget * 5.5));
    }

    [Test]
    public void Debris_run_never_touches_an_all_on_frame_notch()
    {
        // A sub-anchor notch whose every edge is on-frame: a lawful lattice notch (a real
        // architectural feature at raster scale), not fit debris. The run trigger demands an
        // off-frame member as the provenance marker of a cut; this has none.
        var notched = Poly(
            (0, 0), (20, 0), (20, 10), (11.2, 10),
            (11.2, 8.4), (9.6, 8.4), (9.6, 10),
            (0, 10));

        Assert.That(
            TakeoffPromotion.SquareDebrisRuns(
                notched, WideZone, NoNeighbors, Budget,
                allowedOutside: 1e-6, allowedOverlap: 1e-6),
            Is.Null);
    }

    [Test]
    public void A_real_notch_inside_a_mixed_debris_run_survives_the_collapse()
    {
        // The R3a falsifier: a genuine 1.6 ft architectural notch sits inside a run that ALSO
        // carries one off-frame debris edge at its entry. The chain-split law must fence the
        // notch (its vertices are lawful frame corners) and square only the debris edge.
        var mixed = Poly(
            (0, 0), (20, 0), (20, 10), (12, 10),
            (11.2, 10.05),                           // off-frame debris entry (~3.6 deg tilt)
            (11.2, 8.4), (9.6, 8.4), (9.6, 10),      // the genuine notch, all on-frame
            (8, 10), (0, 10));

        var repaired = TakeoffPromotion.SquareDebrisRuns(
            mixed, WideZone, NoNeighbors, Budget, allowedOutside: 1e-6, allowedOverlap: 1e-6);

        Assert.That(repaired, Is.Not.Null, "the debris edge itself must still be squared");
        AssertAllEdgesOnFrame(repaired!);
        var notchInterior = Factory.CreatePoint(new Coordinate(10.4, 9.2));
        var underNotch = Factory.CreatePoint(new Coordinate(10.4, 8.0));
        Assert.Multiple(() =>
        {
            Assert.That(repaired!.Covers(notchInterior), Is.False,
                "the genuine notch was erased by the run collapse");
            Assert.That(repaired!.Covers(underNotch), Is.True,
                "the room under the notch must remain");
        });
    }

    // ------------------------------------------------------------------ DeJog fence

    [Test]
    public void Dejog_removes_a_free_jog()
    {
        // A 0.5 ft perpendicular jog between two same-direction runs of the top edge.
        var jogged = Poly((0, 0), (20, 0), (20, 10), (12, 10), (12, 10.5), (0, 10.5));

        var dejogged = FrameLocalProjector.DeJog(jogged, stepFt: Budget, jogMovable: null);

        Assert.That(dejogged, Is.Not.Null);
        Assert.That(dejogged, Is.InstanceOf<Polygon>());
        var polygon = (Polygon)dejogged!;
        Assert.That(polygon.ExteriorRing.NumPoints - 1, Is.EqualTo(4),
            "the jog must dissolve to a plain rectangle");
        AssertAllEdgesOnFrame(polygon);
    }

    [Test]
    public void Dejog_leaves_a_jog_standing_on_shared_linework()
    {
        // The zone-fit fence: when the jog's REMOVED step rides another room's linework, the
        // dissolve may not straighten it (that jag belongs to both rooms; the projector carves
        // both sides, which zone-fit's laws forbid). Vertices (12,10)-(12,10.5) are declared
        // shared; the jog must stand.
        var jogged = Poly((0, 0), (20, 0), (20, 10), (12, 10), (12, 10.5), (0, 10.5));
        var sharedWall = Factory.CreateLineString(
            [new Coordinate(12, 10), new Coordinate(12, 10.5)]);
        bool JogMovable(Coordinate point) =>
            sharedWall.Distance(Factory.CreatePoint(point)) > 1e-6;

        var fenced = FrameLocalProjector.DeJog(jogged, stepFt: Budget, JogMovable);

        Assert.That(fenced, Is.Not.Null);
        var polygon = (Polygon)fenced!;
        Assert.Multiple(() =>
        {
            Assert.That(polygon.ExteriorRing.NumPoints - 1, Is.EqualTo(6),
                "the fenced jog must survive");
            Assert.That(polygon.Area, Is.EqualTo(jogged.Area).Within(1e-9));
        });
    }

    // ------------------------------------------------------------------ RepairFitArtifacts

    [Test]
    public void Repair_composite_returns_an_audit_clean_polygon_for_a_clipped_corner_cut()
    {
        var cut = Poly((0, 0), (20, 0), (20, 9.2), (19.2, 10), (0, 10));

        var repair = TakeoffPromotion.RepairFitArtifacts(
            cut, WideZone, NoNeighbors, Budget, clipped: true);

        Assert.That(repair, Is.Not.Null);
        Assert.That(repair!.Value.Squared, Is.True);
        AssertAllEdgesOnFrame(repair.Value.Polygon);
        var audited = TakeoffEditability.Evaluate(new LevelTakeoff("repair-test", 0, [
            new TakeoffRoomShape("fit", repair.Value.Polygon.Area, repair.Value.Polygon.Length, 0,
                repair.Value.Polygon.ExteriorRing.Coordinates
                    .Select(c => new[] { c.X, c.Y }).ToList(), []),
        ]));
        Assert.That(audited.Rooms[0].Violations, Is.Empty,
            "the composite's output must pass the unmodified canonical audit");
    }

    [Test]
    public void Repair_composite_ships_a_clean_polygon_byte_identical()
    {
        // A polygon that would already pass the audit must come back null: the composite may
        // never pay displacement for geometry that had nothing to repair.
        var clean = Poly((0, 0), (20, 0), (20, 10), (0, 10));

        Assert.That(
            TakeoffPromotion.RepairFitArtifacts(
                clean, WideZone, NoNeighbors, Budget, clipped: true),
            Is.Null);
    }
}
