using NUnit.Framework;
using Pe.Revit.Takeoff;

namespace Pe.Takeoff.Tests;

public sealed class TakeoffEditabilityTests
{
    [Test]
    public void Axis_aligned_rectangle_is_intrinsically_strictly_editable()
    {
        var audit = TakeoffEditability.Evaluate(Level(
            Room("R01", (0, 0), (12, 0), (12, 8), (0, 8))));

        Assert.Multiple(() => {
            Assert.That(audit.IsStrictlyEditable, Is.True);
            Assert.That(audit.StrictlyEditableRooms, Is.EqualTo(1));
            Assert.That(audit.Rooms.Single().Violations, Is.Empty);
        });
    }

    [Test]
    public void Chamfered_corner_is_not_strictly_editable()
    {
        var room = TakeoffEditability.Evaluate(Level(
            Room("R01", (0, 0), (10, 0), (10, 8), (8, 10), (0, 10))))
            .Rooms.Single();

        Assert.Multiple(() => {
            Assert.That(room.IsStrictlyEditable, Is.False);
            Assert.That(room.Violations.Select(violation => violation.Kind), Does.Contain(
                EditabilityViolationKind.OffFrameEdge));
            Assert.That(room.Violations.Select(violation => violation.Kind), Does.Contain(
                EditabilityViolationKind.NonRightCorner));
            Assert.That(room.Violations.Select(violation => violation.Kind), Does.Contain(
                EditabilityViolationKind.DiagonalShortcut));
        });
    }

    [Test]
    public void Orthogonal_raster_staircase_is_not_strictly_editable()
    {
        var room = TakeoffEditability.Evaluate(Level(Room("R01",
            (0, 0), (10, 0), (10, 10), (6, 10), (6, 9.5), (5.5, 9.5),
            (5.5, 9), (0, 9))))
            .Rooms.Single();

        Assert.Multiple(() => {
            Assert.That(room.IsStrictlyEditable, Is.False);
            Assert.That(room.Violations.Select(violation => violation.Kind),
                Is.EqualTo(new[] { EditabilityViolationKind.MicroStepRun }));
        });
    }

    [Test]
    public void Isolated_shallow_orthogonal_cut_in_needs_evidence_before_rejection()
    {
        var room = TakeoffEditability.Evaluate(Level(Room("R01",
            (0, 0), (12, 0), (12, 10),
            (8, 10), (8, 8.5), (5, 8.5), (5, 10), (0, 10))))
            .Rooms.Single();

        Assert.Multiple(() => {
            Assert.That(room.IsStrictlyEditable, Is.True);
            Assert.That(room.Violations.Select(violation => violation.Kind),
                Does.Not.Contain(EditabilityViolationKind.ExcessiveDetail));
        });
    }

    [Test]
    public void Ordinary_large_l_shape_is_not_excessive_detail()
    {
        var room = TakeoffEditability.Evaluate(Level(Room("R01",
            (0, 0), (20, 0), (20, 8), (8, 8), (8, 20), (0, 20))))
            .Rooms.Single();

        Assert.Multiple(() => {
            Assert.That(room.IsStrictlyEditable, Is.True);
            Assert.That(room.Violations.Select(violation => violation.Kind),
                Does.Not.Contain(EditabilityViolationKind.ExcessiveDetail));
        });
    }

    [Test]
    public void Four_short_turn_edges_are_excessive_detail_even_when_not_subfoot()
    {
        var room = TakeoffEditability.Evaluate(Level(Room("R01",
            (0, 0), (12, 0), (12, 10),
            (10, 10), (10, 8), (8, 8), (8, 6), (6, 6), (6, 10), (0, 10))))
            .Rooms.Single();

        Assert.That(room.Violations.Select(violation => violation.Kind),
            Does.Contain(EditabilityViolationKind.ExcessiveDetail));
    }

    [Test]
    public void Arbitrarily_rotated_rectangle_is_intrinsically_editable_not_proven_correct()
    {
        const double degrees = 17;
        double angle = degrees * Math.PI / 180;
        (double X, double Y) Rotate(double x, double y) =>
            (x * Math.Cos(angle) - y * Math.Sin(angle),
             x * Math.Sin(angle) + y * Math.Cos(angle));

        var room = TakeoffEditability.Evaluate(Level(Room("R01",
            Rotate(0, 0), Rotate(12, 0), Rotate(12, 8), Rotate(0, 8))))
            .Rooms.Single();

        Assert.Multiple(() => {
            // This audit accepts the candidate's coherent local frame. It deliberately says
            // nothing about whether 17 degrees matches the architectural evidence.
            Assert.That(room.IsStrictlyEditable, Is.True);
            Assert.That(room.FrameDegrees, Is.EqualTo(degrees).Within(1e-9));
            Assert.That(room.FrameSupport, Is.EqualTo(1).Within(1e-9));
        });
    }

    [Test]
    public void Arrowhead_protrusion_reports_an_acute_tip()
    {
        var room = TakeoffEditability.Evaluate(Level(Room("R01",
            (0, 0), (10, 0), (10, 4), (12, 5), (10, 6), (10, 10), (0, 10))))
            .Rooms.Single();

        Assert.Multiple(() => {
            Assert.That(room.IsStrictlyEditable, Is.False);
            Assert.That(room.Violations.Select(violation => violation.Kind),
                Does.Contain(EditabilityViolationKind.AcuteTip));
        });
    }

    [Test]
    public void Collinear_fragments_do_not_create_false_corners()
    {
        var room = TakeoffEditability.Evaluate(Level(Room("R01",
            (0, 0), (5, 0), (10, 0), (10, 10), (0, 10))))
            .Rooms.Single();

        Assert.Multiple(() => {
            Assert.That(room.IsStrictlyEditable, Is.True);
            Assert.That(room.CornerCount, Is.EqualTo(4));
        });
    }

    [Test]
    public void Revit_precision_noise_on_a_straight_wall_does_not_create_a_false_corner()
    {
        var room = TakeoffEditability.Evaluate(Level(Room("R01",
            (0, 0), (5, 0.00001), (10, 0), (10, 10), (0, 10))))
            .Rooms.Single();

        Assert.Multiple(() => {
            Assert.That(room.IsStrictlyEditable, Is.True);
            Assert.That(room.CornerCount, Is.EqualTo(4));
        });
    }

    [Test]
    public void Audit_output_order_is_deterministic()
    {
        var level = Level(Room("R01",
            (0, 0), (10, 0), (10, 4), (12, 5), (10, 6), (10, 10), (0, 10)));

        string first = System.Text.Json.JsonSerializer.Serialize(TakeoffEditability.Evaluate(level));
        string second = System.Text.Json.JsonSerializer.Serialize(TakeoffEditability.Evaluate(level));

        Assert.That(second, Is.EqualTo(first));
    }

    [Test]
    public void Boundary_backtrack_reports_a_reversal()
    {
        var room = TakeoffEditability.Evaluate(Level(Room("R01",
            (0, 0), (10, 0), (8, 0), (10, 0), (10, 10), (0, 10))))
            .Rooms.Single();

        Assert.Multiple(() => {
            Assert.That(room.IsStrictlyEditable, Is.False);
            Assert.That(room.Violations.Select(violation => violation.Kind),
                Does.Contain(EditabilityViolationKind.Reversal));
        });
    }

    [Test]
    public void Boundary_without_one_dominant_orthogonal_frame_is_not_strictly_editable()
    {
        var room = TakeoffEditability.Evaluate(Level(Room("R01",
            (0, 4), (2, 0), (8, 0), (10, 4), (8, 8), (2, 8))))
            .Rooms.Single();

        Assert.Multiple(() => {
            Assert.That(room.IsStrictlyEditable, Is.False);
            Assert.That(room.Violations.Select(violation => violation.Kind),
                Does.Contain(EditabilityViolationKind.NoCoherentFrame));
        });
    }

    [Test]
    public void Overlapping_rooms_are_not_a_strictly_editable_shared_coverage()
    {
        var audit = TakeoffEditability.Evaluate(Level(
            Room("R01", (0, 0), (10, 0), (10, 10), (0, 10)),
            Room("R02", (9, 0), (20, 0), (20, 10), (9, 10))));

        Assert.Multiple(() => {
            Assert.That(audit.IsStrictlyEditable, Is.False);
            Assert.That(audit.CoverageViolations.Select(violation => violation.Kind),
                Does.Contain(EditabilityViolationKind.InvalidCoverage));
            Assert.That(audit.Rooms,
                Has.None.Matches<RoomEditabilityAudit>(room => room.IsStrictlyEditable));
        });
    }

    [Test]
    public void Exact_neighbor_boundary_is_a_strictly_editable_shared_coverage()
    {
        var audit = TakeoffEditability.Evaluate(Level(
            Room("R01", (0, 0), (10, 0), (10, 10), (0, 10)),
            Room("R02", (10, 0), (20, 0), (20, 10), (10, 10))));

        Assert.Multiple(() => {
            Assert.That(audit.IsStrictlyEditable, Is.True);
            Assert.That(audit.StrictlyEditableRooms, Is.EqualTo(2));
            Assert.That(audit.CoverageViolations, Is.Empty);
        });
    }

    [Test]
    public void Hole_edges_must_share_the_rooms_frame()
    {
        var input = Room("R01", (0, 0), (10, 0), (10, 10), (0, 10));
        input.Holes.Add([
            new[] { 4d, 5d }, new[] { 5d, 4d },
            new[] { 6d, 5d }, new[] { 5d, 6d },
        ]);

        var room = TakeoffEditability.Evaluate(Level(input)).Rooms.Single();

        Assert.Multiple(() => {
            Assert.That(room.IsStrictlyEditable, Is.False);
            Assert.That(room.Violations.Any(violation =>
                violation.Kind == EditabilityViolationKind.OffFrameEdge
                && violation.Loop == "hole:0"), Is.True);
        });
    }

    [Test]
    public void Degenerate_room_returns_a_deterministic_violation_instead_of_throwing()
    {
        var level = Level(
            Room("BAD", (0, 0), (1, 0), (2, 0)),
            Room("GOOD", (10, 0), (20, 0), (20, 10), (10, 10)));
        LevelEditabilityAudit? audit = null;

        Assert.DoesNotThrow(() => audit = TakeoffEditability.Evaluate(level));
        var violations = audit!.Rooms.Single(room => room.RoomId == "BAD").Violations;
        Assert.Multiple(() => {
            Assert.That(violations, Is.Not.Empty);
            Assert.That(violations.Select(violation => violation.Kind),
                Does.Contain(EditabilityViolationKind.InvalidLoop));
            Assert.That(
                System.Text.Json.JsonSerializer.Serialize(violations),
                Is.EqualTo(System.Text.Json.JsonSerializer.Serialize(
                    TakeoffEditability.Evaluate(level).Rooms.Single(room => room.RoomId == "BAD").Violations)));
        });
    }

    private static LevelTakeoff Level(params TakeoffRoomShape[] rooms) =>
        new("Test Level", 0, rooms.ToList());

    private static TakeoffRoomShape Room(string id, params (double X, double Y)[] points)
    {
        var outer = points.Select(point => new[] { point.X, point.Y }).ToList();
        double area = 0, perimeter = 0;
        for (var i = 0; i < outer.Count; i++)
        {
            var a = outer[i];
            var b = outer[(i + 1) % outer.Count];
            area += a[0] * b[1] - b[0] * a[1];
            perimeter += Math.Sqrt(Math.Pow(b[0] - a[0], 2) + Math.Pow(b[1] - a[1], 2));
        }
        return new TakeoffRoomShape(id, Math.Abs(area / 2), perimeter, 9, outer, []);
    }
}
