using NetTopologySuite.Coverage;
using NetTopologySuite.Geometries;
using NetTopologySuite.Operation.Valid;

namespace Pe.Revit.Takeoff;

public enum EditabilityViolationKind
{
    InvalidLoop,
    InvalidCoverage,
    NoCoherentFrame,
    OffFrameEdge,
    NonRightCorner,
    AcuteTip,
    Reversal,
    DiagonalShortcut,
    MicroStepRun,
    ExcessiveDetail,
}

public sealed record EditabilityPoint(double X, double Y);

public sealed record EditabilityViolation(
    EditabilityViolationKind Kind,
    string RoomId,
    string Loop,
    int EdgeIndex,
    EditabilityPoint At,
    EditabilityPoint From,
    EditabilityPoint To,
    double Measured,
    string Message);

public sealed record RoomEditabilityAudit(
    string RoomId,
    bool IsStrictlyEditable,
    double FrameDegrees,
    double FrameSupport,
    int CornerCount,
    double MinimumEdgeFt,
    IReadOnlyList<EditabilityViolation> Violations);

public sealed record LevelEditabilityAudit(
    string LevelName,
    bool IsStrictlyEditable,
    int StrictlyEditableRooms,
    IReadOnlyList<RoomEditabilityAudit> Rooms,
    IReadOnlyList<EditabilityViolation> CoverageViolations);

/// <summary>
/// Judges intrinsic candidate-frame editability. This does not prove that a room is structurally
/// correct, evidence-conformant, or ready for promotion.
/// </summary>
public static class TakeoffEditability
{
    private const double AngleTolerance = 0.25 * Math.PI / 180;
    private const double FrameAnchorMinFt = 2;
    private const double FrameMinSupport = 0.80;
    private const double AcuteAngle = 75 * Math.PI / 180;
    private const double MicroEdgeMaxFt = 1;
    private const int MicroRunMinEdges = 3;
    private const double ShallowDetailMaxFt = 2.25;
    private const double ShallowDetailSpanMaxFt = 4;
    private const double ShortTurnEdgeMaxFt = 2.25;
    private const double ShortTurnRunMaxFt = 16;
    private const int ShortTurnRunMinEdges = 4;
    private const double Epsilon = 1e-9;
    private static readonly GeometryFactory GeometryFactory =
        new(new PrecisionModel(1_000_000));

    public static LevelEditabilityAudit Evaluate(LevelTakeoff takeoff)
    {
        if (takeoff == null) throw new ArgumentNullException(nameof(takeoff));
        var rooms = takeoff.Rooms.Select(AuditRoom).ToList();
        var validIds = new HashSet<string>(rooms
            .Where(room => room.Violations.All(violation => violation.Kind != EditabilityViolationKind.InvalidLoop))
            .Select(room => room.RoomId), StringComparer.Ordinal);
        var coverage = AuditCoverage(takeoff.Rooms.Where(room => validIds.Contains(room.Id)).ToList());
        if (coverage.Count > 0)
            rooms = rooms.Select(room => coverage.Where(violation => violation.RoomId == room.RoomId).ToList()
                    is { Count: > 0 } roomCoverage
                ? room with {
                    IsStrictlyEditable = false,
                    Violations = room.Violations.Concat(roomCoverage).ToList(),
                }
                : room).ToList();
        return new LevelEditabilityAudit(
            takeoff.LevelName, coverage.Count == 0 && rooms.All(room => room.IsStrictlyEditable),
            rooms.Count(room => room.IsStrictlyEditable), rooms, coverage);
    }

    private static IReadOnlyList<EditabilityViolation> AuditCoverage(
        IReadOnlyList<TakeoffRoomShape> rooms)
    {
        if (rooms.Count < 2) return [];
        try
        {
            var geometries = rooms.Select(ToPolygon).Cast<Geometry>().ToArray();
            if (CoverageValidator.IsValid(geometries)) return [];

            var marks = CoverageValidator.Validate(geometries);
            var violations = new List<EditabilityViolation>();
            for (var index = 0; index < marks.Length; index++)
            {
                var mark = marks[index];
                if (mark == null || mark.IsEmpty) continue;
                var from = new Point(mark.Coordinate.X, mark.Coordinate.Y);
                var last = mark.Coordinates[^1];
                violations.Add(Violation(EditabilityViolationKind.InvalidCoverage,
                    rooms[index].Id, "coverage", -1, from,
                    new Point(last.X, last.Y), mark.Length,
                    "room boundary overlaps or disagrees with the shared coverage"));
            }
            return violations;
        }
        catch
        {
            return rooms.Select(room => Violation(EditabilityViolationKind.InvalidCoverage,
                room.Id, "coverage", -1, new Point(0, 0), new Point(0, 0), 0,
                "shared coverage could not be evaluated")).ToList();
        }
    }

    private static Polygon ToPolygon(TakeoffRoomShape room) =>
        GeometryFactory.CreatePolygon(Ring(room.Outer), room.Holes.Select(Ring).ToArray());

    private static LinearRing Ring(IReadOnlyList<double[]> points)
    {
        var coordinates = points.Select(point => new Coordinate(point[0], point[1])).ToList();
        if (coordinates.Count > 0 && !coordinates[0].Equals2D(coordinates[^1]))
            coordinates.Add(coordinates[0].Copy());
        return GeometryFactory.CreateLinearRing(coordinates.ToArray());
    }

    private static RoomEditabilityAudit AuditRoom(TakeoffRoomShape room)
    {
        var malformed = InvalidLoops(room);
        var loops = new[] { (Name: "outer", Points: CleanLoop(room.Outer)) }
            .Concat(room.Holes.Select((hole, index) =>
                (Name: $"hole:{index}", Points: CleanLoop(hole))))
            .ToList();
        var edges = loops.SelectMany(loop => Edges(loop.Name, loop.Points)).ToList();
        if (edges.Count == 0)
            return new RoomEditabilityAudit(room.Id, false, 0, 0, 0, 0, malformed.Concat([
                Violation(EditabilityViolationKind.NoCoherentFrame, room.Id, "outer", 0,
                    new Point(0, 0), new Point(0, 0), 0, "room has no usable boundary edges"),
            ]).ToList());

        var anchors = edges.Where(edge => edge.Length >= FrameAnchorMinFt).ToList();
        if (anchors.Count == 0) anchors = edges;
        var candidates = anchors.Select(edge => Normalize90(edge.Angle)).Distinct()
            .OrderBy(angle => angle).ToList();
        double frame = 0, supportLength = -1;
        foreach (var candidate in candidates)
        {
            double support = edges.Where(edge => Difference90(edge.Angle, candidate) <= AngleTolerance)
                .Sum(edge => edge.Length);
            if (support > supportLength + Epsilon)
            {
                frame = candidate;
                supportLength = support;
            }
        }
        double frameSupport = supportLength / edges.Sum(edge => edge.Length);
        var violations = new List<EditabilityViolation>(malformed);
        if (frameSupport < FrameMinSupport)
            violations.Add(Violation(EditabilityViolationKind.NoCoherentFrame, room.Id,
                "outer", 0, edges[0].From, edges[0].To, frameSupport,
                $"only {frameSupport.ToString("P1", CultureInfo.InvariantCulture)} of the boundary " +
                "belongs to one orthogonal frame"));

        foreach (var loop in loops)
            AuditLoop(room.Id, loop.Name, loop.Points, frame, violations);

        double minimumEdge = edges.Min(edge => edge.Length);
        int corners = loops.Sum(loop => loop.Points.Count);
        return new RoomEditabilityAudit(
            room.Id, violations.Count == 0, frame * 180 / Math.PI, frameSupport,
            corners, minimumEdge, violations);
    }

    private static IReadOnlyList<EditabilityViolation> InvalidLoops(TakeoffRoomShape room)
    {
        var loops = new[] { (Name: "outer", Points: (IReadOnlyList<double[]>)room.Outer) }
            .Concat(room.Holes.Select((hole, index) =>
                (Name: $"hole:{index}", Points: (IReadOnlyList<double[]>)hole)))
            .ToList();
        var violations = new List<EditabilityViolation>();
        foreach (var loop in loops)
        {
            var first = loop.Points.FirstOrDefault(point => point.Length >= 2
                && IsFinite(point[0]) && IsFinite(point[1]));
            var at = first == null ? new Point(0, 0) : new Point(first[0], first[1]);
            if (loop.Points.Count < 3 || loop.Points.Any(point => point.Length < 2
                    || !IsFinite(point[0]) || !IsFinite(point[1]))
                || CleanLoop(loop.Points).Count < 3)
            {
                violations.Add(Violation(EditabilityViolationKind.InvalidLoop, room.Id,
                    loop.Name, -1, at, at, loop.Points.Count,
                    "boundary loop is malformed or degenerate"));
                continue;
            }
            try
            {
                var ring = Ring(loop.Points);
                double area = GeometryFactory.CreatePolygon(ring).Area;
                if (!ring.IsSimple || !ring.IsValid || area <= Epsilon)
                    violations.Add(Violation(EditabilityViolationKind.InvalidLoop, room.Id,
                        loop.Name, -1, at, at, area,
                        "boundary loop is malformed or degenerate"));
            }
            catch
            {
                violations.Add(Violation(EditabilityViolationKind.InvalidLoop, room.Id,
                    loop.Name, -1, at, at, loop.Points.Count,
                    "boundary loop is malformed or degenerate"));
            }
        }
        if (violations.Count > 0) return violations;
        try
        {
            var error = new IsValidOp(ToPolygon(room)).ValidationError;
            if (error != null)
            {
                var at = new Point(error.Coordinate.X, error.Coordinate.Y);
                violations.Add(Violation(EditabilityViolationKind.InvalidLoop, room.Id,
                    "geometry", -1, at, at, 0, "room polygon is invalid"));
            }
        }
        catch
        {
            violations.Add(Violation(EditabilityViolationKind.InvalidLoop, room.Id,
                "geometry", -1, new Point(0, 0), new Point(0, 0), 0,
                "room polygon is invalid"));
        }
        return violations;
    }

    private static void AuditLoop(
        string roomId, string loopName, IReadOnlyList<Point> points, double frame,
        List<EditabilityViolation> violations)
    {
        var edges = Edges(loopName, points).ToList();
        for (var index = 0; index < edges.Count; index++)
        {
            var edge = edges[index];
            if (Difference90(edge.Angle, frame) <= AngleTolerance) continue;
            violations.Add(Violation(EditabilityViolationKind.OffFrameEdge, roomId,
                loopName, index, edge.From, edge.To, Difference90(edge.Angle, frame) * 180 / Math.PI,
                "edge is not on the room's orthogonal frame"));

            var previous = edges[(index + edges.Count - 1) % edges.Count];
            var next = edges[(index + 1) % edges.Count];
            if (Difference90(previous.Angle, frame) <= AngleTolerance
                && Difference90(next.Angle, frame) <= AngleTolerance
                && FrameAxis(previous.Angle, frame) != FrameAxis(next.Angle, frame))
                violations.Add(Violation(EditabilityViolationKind.DiagonalShortcut, roomId,
                    loopName, index, edge.From, edge.To, edge.Length,
                    "diagonal replaces the intersection of two frame-aligned edges"));
        }

        for (var index = 0; index < points.Count; index++)
        {
            var previous = points[(index + points.Count - 1) % points.Count];
            var point = points[index];
            var next = points[(index + 1) % points.Count];
            var incoming = point - previous;
            var outgoing = next - point;
            double turn = Math.Atan2(Cross(incoming, outgoing), Dot(incoming, outgoing));
            double turnMagnitude = Math.Abs(turn);
            if (Math.Abs(turnMagnitude - Math.PI) <= AngleTolerance)
            {
                violations.Add(Violation(EditabilityViolationKind.Reversal, roomId,
                    loopName, index, previous, next, turnMagnitude * 180 / Math.PI,
                    "boundary reverses direction at the vertex", point));
                continue;
            }
            if (Math.Abs(turnMagnitude - Math.PI / 2) <= AngleTolerance) continue;

            violations.Add(Violation(EditabilityViolationKind.NonRightCorner, roomId,
                loopName, index, previous, next, turnMagnitude * 180 / Math.PI,
                "corner is not 90 degrees", point));
            double included = Math.Acos(Clamp(Dot(-incoming, outgoing) /
                (incoming.Length * outgoing.Length)));
            if (included < AcuteAngle)
                violations.Add(Violation(EditabilityViolationKind.AcuteTip, roomId,
                    loopName, index, previous, next, included * 180 / Math.PI,
                    "corner ends in an acute tip", point));
        }

        for (var index = 0; index < edges.Count; index++)
        {
            if (edges[index].Length > MicroEdgeMaxFt
                || edges[(index + edges.Count - 1) % edges.Count].Length <= MicroEdgeMaxFt)
                continue;
            int count = 0;
            while (count < edges.Count
                   && edges[(index + count) % edges.Count].Length <= MicroEdgeMaxFt)
                count++;
            if (count < MicroRunMinEdges) continue;
            var last = edges[(index + count - 1) % edges.Count];
            violations.Add(Violation(EditabilityViolationKind.MicroStepRun, roomId,
                loopName, index, edges[index].From, last.To, count,
                $"{count} consecutive handle-scale edges form a micro-step run"));
        }
        if (edges.Count >= MicroRunMinEdges && edges.All(edge => edge.Length <= MicroEdgeMaxFt))
            violations.Add(Violation(EditabilityViolationKind.MicroStepRun, roomId,
                loopName, 0, edges[0].From, edges[^1].To, edges.Count,
                $"all {edges.Count} boundary edges are handle-scale"));

        for (var index = 0; index < edges.Count; index++)
        {
            if (edges[index].Length > ShortTurnEdgeMaxFt
                || edges[(index + edges.Count - 1) % edges.Count].Length <= ShortTurnEdgeMaxFt)
                continue;
            int count = 0;
            double total = 0;
            while (count < edges.Count && edges[(index + count) % edges.Count].Length <= ShortTurnEdgeMaxFt)
            {
                total += edges[(index + count) % edges.Count].Length;
                count++;
            }
            if (count < ShortTurnRunMinEdges || total > ShortTurnRunMaxFt) continue;
            var last = edges[(index + count - 1) % edges.Count];
            violations.Add(Violation(EditabilityViolationKind.ExcessiveDetail, roomId,
                loopName, index, edges[index].From, last.To, count,
                $"{count} consecutive short turn edges create avoidable edit handles"));
        }

    }

    private static IReadOnlyList<Point> CleanLoop(IReadOnlyList<double[]> source)
    {
        var points = source.Where(point => point.Length >= 2)
            .Select(point => new Point(point[0], point[1])).ToList();
        if (points.Count > 1 && (points[0] - points[^1]).Length <= Epsilon) points.RemoveAt(points.Count - 1);
        for (var index = points.Count - 1; index >= 0 && points.Count > 1; index--)
            if ((points[index] - points[(index + points.Count - 1) % points.Count]).Length <= Epsilon)
                points.RemoveAt(index);

        bool changed;
        do
        {
            changed = false;
            for (var index = 0; index < points.Count && points.Count >= 3; index++)
            {
                var incoming = points[index] - points[(index + points.Count - 1) % points.Count];
                var outgoing = points[(index + 1) % points.Count] - points[index];
                if (Math.Abs(Cross(incoming, outgoing))
                        <= Math.Sin(AngleTolerance) * incoming.Length * outgoing.Length
                    && Dot(incoming, outgoing) > 0)
                {
                    points.RemoveAt(index);
                    changed = true;
                    break;
                }
            }
        } while (changed);
        return points;
    }

    private static IEnumerable<Edge> Edges(string loop, IReadOnlyList<Point> points)
    {
        for (var index = 0; index < points.Count; index++)
        {
            var from = points[index];
            var to = points[(index + 1) % points.Count];
            var delta = to - from;
            if (delta.Length > Epsilon)
                yield return new Edge(loop, index, from, to, delta.Length,
                    Math.Atan2(delta.Y, delta.X));
        }
    }

    private static EditabilityViolation Violation(
        EditabilityViolationKind kind, string roomId, string loop, int edgeIndex,
        Point from, Point to, double measured, string message, Point? at = null) =>
        new(kind, roomId, loop, edgeIndex,
            new EditabilityPoint((at ?? from).X, (at ?? from).Y),
            new EditabilityPoint(from.X, from.Y), new EditabilityPoint(to.X, to.Y), measured, message);

    private static int FrameAxis(double angle, double frame) =>
        AngleDifference(angle, frame) <= AngleDifference(angle, frame + Math.PI / 2) ? 0 : 1;

    private static double Normalize90(double angle)
    {
        angle %= Math.PI / 2;
        return angle < 0 ? angle + Math.PI / 2 : angle;
    }

    private static double Difference90(double first, double second)
    {
        double difference = Math.Abs(Normalize90(first) - Normalize90(second));
        return Math.Min(difference, Math.PI / 2 - difference);
    }

    private static double AngleDifference(double first, double second)
    {
        double difference = Math.Abs(Normalize180(first) - Normalize180(second));
        return Math.Min(difference, Math.PI - difference);
    }

    private static double Normalize180(double angle)
    {
        angle %= Math.PI;
        return angle < 0 ? angle + Math.PI : angle;
    }

    private static double Cross(Point first, Point second) => first.X * second.Y - first.Y * second.X;
    private static double Dot(Point first, Point second) => first.X * second.X + first.Y * second.Y;
    private static double Clamp(double value) => Math.Max(-1, Math.Min(1, value));
    private static bool IsFinite(double value) => !double.IsNaN(value) && !double.IsInfinity(value);

    private readonly record struct Point(double X, double Y)
    {
        internal double Length => Math.Sqrt(X * X + Y * Y);
        public static Point operator -(Point left, Point right) => new(left.X - right.X, left.Y - right.Y);
        public static Point operator -(Point point) => new(-point.X, -point.Y);
    }

    private readonly record struct Edge(
        string Loop, int Index, Point From, Point To, double Length, double Angle);
}
