using NetTopologySuite.Geometries;
using NetTopologySuite.Geometries.Utilities;
using NetTopologySuite.Operation.Union;

namespace Pe.Revit.Takeoff;

internal enum FrameLocalRejectionReason
{
    NoCoherentFrame,
    MixedFrame,
    InsufficientRails,
    NoOwnedCells,
    InvalidGeometry,
    LabelOutside,
    AreaDrift,
    BoundaryDrift,
    SourceFeatureDrop,
    MicroStepRun,
    CrossFrameOverlap,
    AmbiguousSourceOverlap,
    CanonicalEditability
}

/// <summary>
/// One room the projector refused, and — when the projection got far enough to measure them — the
/// two drift magnitudes it measured.
/// </summary>
/// <remarks>
/// <paramref name="AreaDrift"/> and <paramref name="BoundaryDriftFt"/> are miss attribution, not
/// gate inputs: they are recorded whenever a candidate polygon existed, INCLUDING when some other
/// gate is what actually fired. Without them a rejection only says "too far"; with them a sweep can
/// answer the question that a tolerance change actually turns on — how far, and would any reachable
/// tolerance have saved this room. Null means the room died before a candidate existed (no frame,
/// no rails, no owned cells), so no distance was ever measured and none is invented.
/// </remarks>
internal sealed record FrameLocalRejectedRoom(
    RoomResult Room,
    FrameLocalRejectionReason Reason,
    string Detail,
    double? AreaDrift = null,
    double? BoundaryDriftFt = null);

internal sealed record FrameLocalConservation(
    int SourceRooms,
    int AcceptedRooms,
    int RejectedRooms,
    double SourceSqft,
    double AcceptedSourceSqft,
    double AcceptedProjectedSqft,
    double RejectedOriginalSqft,
    double AcceptedRejectedOverlapSqft)
{
    public double AccountedSourceSqft => AcceptedSourceSqft + RejectedOriginalSqft;
    public double SourceDeltaSqft => AccountedSourceSqft - SourceSqft;
}

/// <summary>
/// The projector's tunable tolerances. Defaults are the shipped constants, so an omitted record
/// reproduces shipped behavior exactly; <see cref="From"/> projects the public options record.
/// </summary>
internal sealed record FrameLocalKnobs(
    double MaxBoundaryDriftFt,
    double MaxSourceDropFt,
    double MaxAreaDrift,
    double MinFrameSupport,
    double RailMergeFt,
    double RailGapFt,
    double MinRailEdgeFt,
    double ComponentGapFt,
    double DeStaircaseFt = 1.0,
    double ZoneSnapDeg = 0)
{
    internal static readonly FrameLocalKnobs Default = new(1.5, 1.5, 0.10, 0.42, 0.55, 1.1, 0.75, 0.55);

    internal static FrameLocalKnobs From(TakeoffOptions options) => new(
        options.FrameMaxBoundaryDriftFt,
        options.FrameMaxSourceDropFt,
        options.FrameMaxAreaDrift,
        options.FrameMinFrameSupport,
        options.FrameRailMergeFt,
        options.FrameRailGapFt,
        options.FrameMinRailEdgeFt,
        options.FrameComponentGapFt,
        options.FrameDeStaircaseFt,
        options.FrameZoneSnapDeg);
}

internal sealed record FrameLocalProjectionResult(
    TakeoffResult Accepted,
    IReadOnlyList<FrameLocalRejectedRoom> Rejected,
    FrameLocalConservation Conservation);

/// <summary>
/// Projects already-selected rooms onto locally orthogonal, shared rails. This is deliberately
/// not a detector: a room either survives as one high-precision polygon or is rejected whole.
/// </summary>
internal static class FrameLocalProjector
{
    private const double MinEdgeFt = 1.5;
    private const double AxisToleranceRad = 8 * Math.PI / 180;
    private const double MixedFrameMargin = 0.10;
    private const double Epsilon = 1e-7;

    private static readonly GeometryFactory Factory = TakeoffGeometry.Factory;

    internal static FrameLocalProjectionResult Project(TakeoffResult source) =>
        Project(source, FrameLocalKnobs.Default, allowLocalRetry: true);

    internal static FrameLocalProjectionResult Project(
        TakeoffResult source, FrameLocalKnobs knobs, Geometry? declaredZone = null) =>
        Project(source, knobs, allowLocalRetry: true, declaredZone);

    private static FrameLocalProjectionResult Project(
        TakeoffResult source, FrameLocalKnobs knobs, bool allowLocalRetry,
        Geometry? declaredZone = null)
    {
        if (source == null) throw new ArgumentNullException(nameof(source));

        var rejected = new Dictionary<int, FrameLocalRejectedRoom>();
        var originals = new List<SourceRoom?>();
        for (int i = 0; i < source.Rooms.Count; i++)
        {
            try { originals.Add(ToSourceRoom(source.Rooms[i])); }
            catch (Exception exception)
            {
                originals.Add(null);
                rejected.Add(i, new FrameLocalRejectedRoom(CloneRoom(source.Rooms[i]),
                    FrameLocalRejectionReason.InvalidGeometry,
                    $"source geometry is invalid ({exception.GetType().Name})"));
            }
        }
        var frames = SnapToDeclaredFrames(
            DominantFrames(
                originals.OfType<SourceRoom>().Select(x => x.Geometry), knobs.DeStaircaseFt),
            declaredZone, knobs.ZoneSnapDeg);
        var assigned = new List<Assignment>();

        for (int i = 0; i < originals.Count; i++)
        {
            var sourceRoom = originals[i];
            if (sourceRoom == null) continue;
            var scores = frames
                .Select((frame, index) => new { index, frame,
                    score = FrameSupport(sourceRoom.Geometry, frame, knobs.DeStaircaseFt) })
                .OrderByDescending(x => x.score)
                .ThenBy(x => x.index)
                .ToList();

            if (scores.Count == 0 || scores[0].score < knobs.MinFrameSupport)
            {
                Reject(i, FrameLocalRejectionReason.NoCoherentFrame,
                    $"best support {(scores.Count == 0 ? 0 : scores[0].score):P1}");
                continue;
            }

            if (scores.Count > 1 && scores[0].score - scores[1].score < MixedFrameMargin)
            {
                Reject(i, FrameLocalRejectionReason.MixedFrame,
                    $"frame support margin {scores[0].score - scores[1].score:P1}");
                continue;
            }

            assigned.Add(new Assignment(i, scores[0].index, scores[0].frame, sourceRoom));
        }

        // Source overlap is ambiguous ownership, not a scoring problem. Holding every involved
        // room whole prevents atomic-cell arbitration from manufacturing a plausible partition.
        var ambiguousSourceOverlap = new HashSet<int>();
        for (int i = 0; i < assigned.Count; i++)
        for (int j = i + 1; j < assigned.Count; j++)
        {
            if (assigned[i].FrameIndex != assigned[j].FrameIndex) continue;
            if (assigned[i].Source.Geometry.Intersection(assigned[j].Source.Geometry).Area <= Epsilon)
                continue;
            ambiguousSourceOverlap.Add(assigned[i].Index);
            ambiguousSourceOverlap.Add(assigned[j].Index);
        }

        foreach (int index in ambiguousSourceOverlap)
            Reject(index, FrameLocalRejectionReason.AmbiguousSourceOverlap,
                "source geometry overlaps another room in the same frame");
        assigned.RemoveAll(room => ambiguousSourceOverlap.Contains(room.Index));

        var projected = new Dictionary<int, ProjectedRoom>();
        foreach (var frameGroup in assigned.GroupBy(x => x.FrameIndex))
        {
            foreach (var component in ConnectedComponents(frameGroup.ToList(), knobs))
            {
                try { SolveComponent(component, knobs, projected, rejected); }
                catch (Exception exception)
                {
                    foreach (var room in component)
                    {
                        projected.Remove(room.Index);
                        rejected.TryAdd(room.Index, new FrameLocalRejectedRoom(
                            CloneRoom(room.Source.Room), FrameLocalRejectionReason.InvalidGeometry,
                            $"component projection failed ({exception.GetType().Name})"));
                    }
                }
            }
        }

        // Atomic cells prevent same-frame overlaps. Cross-frame components do not share rails,
        // so ambiguity across them is held rather than hidden by clipping or raw fallback.
        var crossFrameRejected = new HashSet<int>();
        var candidates = projected.Values.OrderBy(x => x.Index).ToList();
        for (int i = 0; i < candidates.Count; i++)
        for (int j = i + 1; j < candidates.Count; j++)
        {
            if (candidates[i].FrameIndex == candidates[j].FrameIndex) continue;
            if (candidates[i].Geometry.Intersection(candidates[j].Geometry).Area <= Epsilon) continue;
            crossFrameRejected.Add(candidates[i].Index);
            crossFrameRejected.Add(candidates[j].Index);
        }

        foreach (int index in crossFrameRejected)
        {
            projected.Remove(index);
            Reject(index, FrameLocalRejectionReason.CrossFrameOverlap,
                "projected geometry overlaps a different frame component");
        }

        // A level-wide rail set can be polluted by a distant wing. Retry only drift failures
        // against their one-hop neighborhood, then admit the repair only if it preserves every
        // accepted adjacency and the complete candidate remains canonically strict.
        if (allowLocalRetry)
        {
            var retryable = rejected
                .Where(item => item.Value.Reason is FrameLocalRejectionReason.AreaDrift
                    or FrameLocalRejectionReason.BoundaryDrift
                    or FrameLocalRejectionReason.SourceFeatureDrop)
                .Select(item => item.Key)
                .OrderBy(index => index)
                .ToList();
            foreach (int index in retryable)
            {
                var sourceRoom = originals[index];
                var assignment = assigned.SingleOrDefault(item => item.Index == index);
                if (sourceRoom == null || assignment == null) continue;

                var neighborhood = originals.OfType<SourceRoom>()
                    .Where(other => sourceRoom.Geometry.Distance(other.Geometry) <= knobs.ComponentGapFt)
                    .Select(other => CloneRoom(other.Room))
                    .ToList();
                var local = Project(
                    CloneTakeoff(source, neighborhood), knobs, allowLocalRetry: false, declaredZone);
                var repaired = local.Accepted.Rooms
                    .SingleOrDefault(room => room.Id == sourceRoom.Room.Id);
                if (repaired == null) continue;

                var geometry = ToSourceRoom(repaired).Geometry;
                if (projected.Values.Any(other => geometry.Intersection(other.Geometry).Area > Epsilon))
                    continue;
                var acceptedSourceNeighbors = projected.Values.Select(other => new {
                        room = other,
                        shared = sourceRoom.Geometry.Boundary
                            .Intersection(other.Source.Geometry.Boundary).Length,
                    })
                    .Where(item => item.shared > Epsilon);
                if (acceptedSourceNeighbors.Any(item =>
                        geometry.Boundary.Intersection(item.room.Geometry.Boundary).Length
                            < 0.9 * item.shared))
                    continue;

                var candidate = new ProjectedRoom(
                    index, assignment.FrameIndex, sourceRoom, (Polygon)geometry.Copy());
                var together = projected.Values.Append(candidate).OrderBy(room => room.Index).ToList();
                if (!TakeoffEditability.Evaluate(ToLevelTakeoff(source, together)).IsStrictlyEditable)
                    continue;
                projected.Add(index, candidate);
                rejected.Remove(index);
            }
        }

        // TakeoffEditability is the canonical public contract. The projector's local checks are
        // useful early exits, but no candidate is accepted unless the canonical final audit agrees.
        if (projected.Count > 0)
        {
            var ordered = projected.Values.OrderBy(room => room.Index).ToList();
            var audit = TakeoffEditability.Evaluate(ToLevelTakeoff(source, ordered));
            var failed = ordered.Zip(audit.Rooms, (room, roomAudit) => new { room, roomAudit })
                .Where(item => !item.roomAudit.IsStrictlyEditable)
                .ToList();
            foreach (var item in failed)
            {
                projected.Remove(item.room.Index);
                string violations = string.Join(", ", item.roomAudit.Violations
                    .Select(violation => violation.Kind).Distinct());
                Reject(item.room.Index, FrameLocalRejectionReason.CanonicalEditability,
                    $"canonical editability rejected projected room ({violations})");
            }
        }

        var acceptedRooms = projected.Values
            .OrderBy(x => x.Index)
            .Select(x => CloneRoom(x.Source.Room, x.Geometry))
            .ToList();

        var rejectedRooms = rejected.OrderBy(x => x.Key).Select(x => x.Value).ToList();
        var accepted = CloneTakeoff(source, acceptedRooms);
        return new FrameLocalProjectionResult(
            accepted, rejectedRooms, Conserved(source, accepted, rejectedRooms));

        void Reject(int index, FrameLocalRejectionReason reason, string detail) =>
            rejected.TryAdd(index, new FrameLocalRejectedRoom(CloneRoom(source.Rooms[index]), reason, detail));
    }

    private static void SolveComponent(
        List<Assignment> component,
        FrameLocalKnobs knobs,
        Dictionary<int, ProjectedRoom> projected,
        Dictionary<int, FrameLocalRejectedRoom> rejected)
    {
        double frame = component[0].Frame;
        var normalized = component.ToDictionary(x => x.Index, x => Rotate(x.Source.Geometry, -frame));
        // Rails come from de-staircased copies: a rotated room's raster steps land at ±45 in its own
        // frame and would otherwise contribute nothing. Cell ownership keeps the raw geometry.
        var railSource = normalized.Values
            .Select(geometry => DeStaircase(geometry, knobs.DeStaircaseFt)).ToList();
        var xRails = BuildRails(railSource, knobs, vertical: true);
        var yRails = BuildRails(railSource, knobs, vertical: false);
        if (xRails.Count < 2 || yRails.Count < 2)
        {
            foreach (var room in component)
                Reject(room, FrameLocalRejectionReason.InsufficientRails,
                    $"{xRails.Count} x rails, {yRails.Count} y rails");
            return;
        }

        var cellsByOwner = component.ToDictionary(x => x.Index, _ => new List<Geometry>());
        for (int xi = 0; xi < xRails.Count - 1; xi++)
        for (int yi = 0; yi < yRails.Count - 1; yi++)
        {
            double minX = xRails[xi], maxX = xRails[xi + 1];
            double minY = yRails[yi], maxY = yRails[yi + 1];
            if (maxX - minX <= Epsilon || maxY - minY <= Epsilon) continue;

            var cell = Factory.ToGeometry(new Envelope(minX, maxX, minY, maxY));
            var center = Factory.CreatePoint(new Coordinate((minX + maxX) / 2, (minY + maxY) / 2));
            var owners = component
                .Where(room => normalized[room.Index].Covers(center))
                .Select(room => new
                {
                    room.Index,
                    area = normalized[room.Index].Intersection(cell).Area,
                    room.Source.Room.Id
                })
                .OrderByDescending(x => x.area)
                .ThenBy(x => x.Id, StringComparer.Ordinal)
                .ToList();
            if (owners.Count > 0) cellsByOwner[owners[0].Index].Add(cell);
        }

        foreach (var room in component)
        {
            if (cellsByOwner[room.Index].Count == 0)
            {
                Reject(room, FrameLocalRejectionReason.NoOwnedCells, "no atomic rail cells owned by room");
                continue;
            }

            Geometry local = UnaryUnionOp.Union(cellsByOwner[room.Index]);
            Geometry candidate = Rotate(local, frame);
            if (candidate is not Polygon polygon || !polygon.IsValid || polygon.IsEmpty)
            {
                Reject(room, FrameLocalRejectionReason.InvalidGeometry,
                    $"projected geometry is {candidate.GeometryType}");
                continue;
            }

            // Both drifts are measured BEFORE any of them gates, so every rejection from here down
            // carries how far the projection actually wandered — including rejections that had
            // nothing to do with drift. That is what turns "the tolerance rejected it" into "the
            // tolerance would have had to reach X", which is the only form a tolerance sweep can act
            // on. Measuring costs one extra Hausdorff per doomed room and buys the whole miss
            // attribution; guessing the magnitudes afterwards is not available at any price.
            double areaDrift = Math.Abs(candidate.Area - room.Source.Geometry.Area) /
                               Math.Max(room.Source.Geometry.Area, Epsilon);
            // Drift is measured against the DE-STAIRCASED source (the same geometry the frame
            // estimator, frame support, and rails already trust — never the raw raster trace), and
            // in AXIS units, not Euclidean feet. The upstream boundary simplifier moves vertices of
            // an axis-aligned raster staircase, so the motion it licenses is a BoundarySimplifyFt
            // box in x and y — which composes to BoundarySimplifyFt·√2 of Euclidean offset
            // perpendicular to a 45-degree wall but only BoundarySimplifyFt perpendicular to an
            // orthogonal one. A Euclidean Hausdorff therefore taxed rotated frames ~√2 for licensed
            // motion orthogonal frames paid face value for: 45-degree drifts clustered at 2.59–2.98
            // against the 2.5 budget, argmax pairs perpendicular to the walls. Measuring the
            // vertex-to-boundary offsets with the axis-frame L∞ norm charges every frame the same
            // price for the same licensed motion — the sealer's stepFt = CellFt·√2 fix, applied to
            // the drift audit. The budget itself is unchanged.
            var reference = DeStaircase(room.Source.Geometry, knobs.DeStaircaseFt).Boundary;
            // projected->source is INVENTION: an accepted boundary standing where the detector
            // proposed nothing; it has no other backstop and keeps the tight tolerance.
            // source->projected is a DROP: a thin source appendage the rail lattice swallowed,
            // already bounded by the area-drift gate above and by ink-backing downstream. One
            // symmetric number made a 547 sf room with a 0.3 ft spike indistinguishable from a
            // room whose walls had wandered off the evidence.
            double sourceDrop = AxisOrientedDistance(reference, candidate.Boundary);
            double invention = AxisOrientedDistance(candidate.Boundary, reference);
            double boundaryDrift = Math.Max(sourceDrop, invention);
            string probe = $"frameDeg={frame * 180 / Math.PI:F2} " +
                $"support={FrameSupport(room.Source.Geometry, frame, knobs.DeStaircaseFt):F3} " +
                $"srcArea={room.Source.Geometry.Area:F0} " +
                $"drop={sourceDrop:F2} invent={invention:F2}";

            var label = Factory.CreatePoint(new Coordinate(room.Source.Room.LabelX, room.Source.Room.LabelY));
            if (!candidate.Covers(label))
            {
                Reject(room, FrameLocalRejectionReason.LabelOutside, "source label is outside projected room",
                    areaDrift, boundaryDrift);
                continue;
            }

            if (areaDrift > knobs.MaxAreaDrift)
            {
                Reject(room, FrameLocalRejectionReason.AreaDrift, $"area drift {areaDrift:P1} {probe}",
                    areaDrift, boundaryDrift);
                continue;
            }

            if (invention > knobs.MaxBoundaryDriftFt)
            {
                Reject(room, FrameLocalRejectionReason.BoundaryDrift,
                    $"boundary drift {boundaryDrift:F2} ft {probe}", areaDrift, boundaryDrift);
                continue;
            }

            if (sourceDrop > knobs.MaxSourceDropFt)
            {
                Reject(room, FrameLocalRejectionReason.SourceFeatureDrop,
                    $"source feature drop {sourceDrop:F2} ft {probe}", areaDrift, boundaryDrift);
                continue;
            }

            if (HasMicroStepRun(polygon))
            {
                Reject(room, FrameLocalRejectionReason.MicroStepRun,
                    "three or more consecutive handle-scale edges remain", areaDrift, boundaryDrift);
                continue;
            }

            projected.Add(room.Index, new ProjectedRoom(
                room.Index, room.FrameIndex, room.Source, (Polygon)candidate.Copy()));
        }

        void Reject(Assignment room, FrameLocalRejectionReason reason, string detail,
            double? areaDrift = null, double? boundaryDriftFt = null) =>
            rejected.TryAdd(room.Index, new FrameLocalRejectedRoom(
                CloneRoom(room.Source.Room), reason, detail, areaDrift, boundaryDriftFt));
    }

    private static List<List<Assignment>> ConnectedComponents(
        List<Assignment> rooms, FrameLocalKnobs knobs)
    {
        var remaining = rooms.ToDictionary(x => x.Index);
        var result = new List<List<Assignment>>();
        while (remaining.Count > 0)
        {
            var seed = remaining.Values.OrderBy(x => x.Index).First();
            remaining.Remove(seed.Index);
            var component = new List<Assignment> { seed };
            var queue = new Queue<Assignment>();
            queue.Enqueue(seed);
            while (queue.Count > 0)
            {
                var current = queue.Dequeue();
                var neighbors = remaining.Values
                    .Where(other => current.Source.Geometry.Distance(other.Source.Geometry)
                        <= knobs.ComponentGapFt)
                    .OrderBy(x => x.Index)
                    .ToList();
                foreach (var neighbor in neighbors)
                {
                    remaining.Remove(neighbor.Index);
                    component.Add(neighbor);
                    queue.Enqueue(neighbor);
                }
            }
            result.Add(component);
        }
        return result;
    }

    private static List<double> BuildRails(
        IEnumerable<Geometry> geometries, FrameLocalKnobs knobs, bool vertical)
    {
        var observations = new List<(double offset, double min, double max, double weight)>();
        foreach (var geometry in geometries)
        foreach (var edge in Edges(geometry))
        {
            double angle = Math.Atan2(edge.b.Y - edge.a.Y, edge.b.X - edge.a.X);
            double axisError = vertical
                ? AngleDifference90(angle, Math.PI / 2)
                : AngleDifference90(angle, 0);
            if (axisError > AxisToleranceRad || edge.length < knobs.MinRailEdgeFt) continue;
            observations.Add(vertical
                ? ((edge.a.X + edge.b.X) / 2, Math.Min(edge.a.Y, edge.b.Y), Math.Max(edge.a.Y, edge.b.Y), edge.length)
                : ((edge.a.Y + edge.b.Y) / 2, Math.Min(edge.a.X, edge.b.X), Math.Max(edge.a.X, edge.b.X), edge.length));
        }

        var rails = new List<double>();
        foreach (var cluster in ClusterByOffset(observations, knobs.RailMergeFt))
        {
            var spans = cluster.OrderBy(x => x.min).ToList();
            double start = spans[0].min, end = spans[0].max;
            var run = new List<(double offset, double min, double max, double weight)> { spans[0] };
            for (int i = 1; i < spans.Count; i++)
            {
                if (spans[i].min - end <= knobs.RailGapFt)
                {
                    end = Math.Max(end, spans[i].max);
                    run.Add(spans[i]);
                    continue;
                }
                rails.Add(WeightedOffset(run));
                start = spans[i].min;
                end = spans[i].max;
                run = new List<(double, double, double, double)> { spans[i] };
            }
            rails.Add(WeightedOffset(run));
        }

        return ClusterScalars(rails, knobs.RailMergeFt)
            .Select(cluster => cluster.Average())
            .OrderBy(x => x)
            .ToList();
    }

    private static List<List<(double offset, double min, double max, double weight)>> ClusterByOffset(
        List<(double offset, double min, double max, double weight)> values, double railMergeFt)
    {
        var result = new List<List<(double, double, double, double)>>();
        foreach (var value in values.OrderBy(x => x.offset))
        {
            if (result.Count == 0 || value.offset - WeightedOffset(result[^1]) > railMergeFt)
                result.Add(new List<(double, double, double, double)>());
            result[^1].Add(value);
        }
        return result;
    }

    private static double WeightedOffset(List<(double offset, double min, double max, double weight)> values) =>
        values.Sum(x => x.offset * x.weight) / Math.Max(values.Sum(x => x.weight), Epsilon);

    private static List<List<double>> ClusterScalars(IEnumerable<double> values, double tolerance)
    {
        var result = new List<List<double>>();
        foreach (double value in values.OrderBy(x => x))
        {
            if (result.Count == 0 || value - result[^1].Average() > tolerance)
                result.Add(new List<double>());
            result[^1].Add(value);
        }
        return result;
    }

    // The discrete oriented Hausdorff (max over FROM's vertices of distance to TO), except the
    // vertex-to-boundary offset is priced with the world-axis L∞ norm instead of Euclidean length.
    // The raster and its simplifier move boundaries in axis-aligned steps, so axis units are the
    // units the licensed motion is actually denominated in; Euclidean pricing charges rotated
    // frames √2 on the same motion. The nearest point is still found euclideanly — for offsets
    // perpendicular to a straight wall (the drift regime) the two argmins coincide, and anywhere
    // they differ the Euclidean choice only overestimates, never forgives.
    private static double AxisOrientedDistance(Geometry from, Geometry to)
    {
        double max = 0;
        foreach (var vertex in from.Coordinates)
        {
            var nearest = NetTopologySuite.Operation.Distance.DistanceOp
                .NearestPoints(Factory.CreatePoint(vertex), to);
            double distance = Math.Max(
                Math.Abs(nearest[0].X - nearest[1].X),
                Math.Abs(nearest[0].Y - nearest[1].Y));
            if (distance > max) max = distance;
        }
        return max;
    }

    // A rotated wall traced from the raster is a staircase of cell-scale axis-aligned steps, and a
    // staircase folds its entire length into the axis bin — the true frame is invisible to any
    // raw-edge histogram. Simplifying first melts the stairs back into the diagonals they sample,
    // so angle measurement always happens on de-rasterized geometry.
    private static Geometry DeStaircase(Geometry geometry, double toleranceFt)
    {
        if (toleranceFt <= 0) return geometry;
        var simplified = NetTopologySuite.Simplify.DouglasPeuckerSimplifier
            .Simplify(geometry, toleranceFt);
        return simplified.IsValid && simplified.Area > Epsilon ? simplified : geometry;
    }

    /// <summary>
    /// Replaces a measured frame with the declared zone's own angle when the two agree to within
    /// <paramref name="snapDegrees"/>.
    /// </summary>
    /// <remarks>
    /// A frame measured off raster boundaries carries chord noise of a few tenths of a degree — on
    /// the project-a 45-degree wing the estimate lands at 45.27 against a zone drawn at exactly 45.00.
    /// That 0.27 is inside the measurement's own noise but OUTSIDE the 0.25-degree tolerance the
    /// canonical editability audit allows, so every zone-fit clip along the declared edge reads as
    /// OffFrameEdge, falls back, and dies at the scope gate. Where a declared angle exists and the
    /// measurement already agrees with it, the declaration is simply the better number: it is known
    /// rather than estimated. Beyond the margin the two are different frames and the measurement is
    /// left alone, so a zone drawn at an angle the rooms do not share can never bend them.
    /// </remarks>
    private static List<double> SnapToDeclaredFrames(
        List<double> frames, Geometry? declaredZone, double snapDegrees)
    {
        if (declaredZone == null || snapDegrees <= 0 || frames.Count == 0) return frames;
        var declared = DominantFrames([declaredZone], deStaircaseFt: 0);
        if (declared.Count == 0) return frames;
        double tolerance = snapDegrees * Math.PI / 180;
        return frames.Select(frame =>
        {
            var nearest = declared
                .Where(angle => AngleDifference90(angle, frame) <= tolerance)
                .OrderBy(angle => AngleDifference90(angle, frame))
                .ToList();
            return nearest.Count == 0 ? frame : nearest[0];
        }).ToList();
    }

    // Matches the strict core's length-weighted modulo-90 histogram and circular mean, without
    // importing its detector internals. The frames therefore come from each level's own edges.
    private static List<double> DominantFrames(
        IEnumerable<Geometry> geometries, double deStaircaseFt)
    {
        const int bins = 30;
        var histogram = new double[bins];
        var edges = geometries.Select(geometry => DeStaircase(geometry, deStaircaseFt))
            .SelectMany(Edges).Where(x => x.length >= MinEdgeFt).ToList();
        foreach (var edge in edges)
        {
            double folded = Fold90(Math.Atan2(edge.b.Y - edge.a.Y, edge.b.X - edge.a.X));
            int bin = Math.Min(bins - 1, (int)(folded / (Math.PI / 2) * bins));
            histogram[bin] += edge.length;
        }

        double total = histogram.Sum();
        var selected = new List<double>();
        foreach (int peak in Enumerable.Range(0, bins).OrderByDescending(i => histogram[i]).ThenBy(i => i))
        {
            if (selected.Count == 3 || total <= Epsilon || histogram[peak] / total < 0.05) break;
            double center = (peak + 0.5) * (Math.PI / 2) / bins;
            if (selected.Any(x => AngleDifference90(x, center) < 15 * Math.PI / 180)) continue;

            double sx = 0, sy = 0;
            foreach (var edge in edges)
            {
                double angle = Fold90(Math.Atan2(edge.b.Y - edge.a.Y, edge.b.X - edge.a.X));
                if (AngleDifference90(angle, center) > 9 * Math.PI / 180) continue;
                sx += edge.length * Math.Cos(4 * angle);
                sy += edge.length * Math.Sin(4 * angle);
            }
            double mean = Math.Atan2(sy, sx) / 4;
            selected.Add(Fold90(mean));
        }
        return selected;
    }

    private static double FrameSupport(Geometry geometry, double frame, double deStaircaseFt)
    {
        var edges = Edges(DeStaircase(geometry, deStaircaseFt))
            .Where(x => x.length >= MinEdgeFt).ToList();
        double total = edges.Sum(x => x.length);
        if (total <= Epsilon) return 0;
        return edges.Where(x => AngleDifference90(
                Math.Atan2(x.b.Y - x.a.Y, x.b.X - x.a.X), frame) <= AxisToleranceRad)
            .Sum(x => x.length) / total;
    }

    private static IEnumerable<(Coordinate a, Coordinate b, double length)> Edges(Geometry geometry)
    {
        foreach (var polygon in Polygons(geometry))
        {
            foreach (var edge in RingEdges(polygon.ExteriorRing)) yield return edge;
            for (int i = 0; i < polygon.NumInteriorRings; i++)
                foreach (var edge in RingEdges(polygon.GetInteriorRingN(i))) yield return edge;
        }
    }

    private static IEnumerable<Polygon> Polygons(Geometry geometry)
    {
        if (geometry is Polygon polygon) yield return polygon;
        else if (geometry is MultiPolygon multi)
            for (int i = 0; i < multi.NumGeometries; i++) yield return (Polygon)multi.GetGeometryN(i);
    }

    private static IEnumerable<(Coordinate a, Coordinate b, double length)> RingEdges(LineString ring)
    {
        var coordinates = ring.Coordinates;
        for (int i = 1; i < coordinates.Length; i++)
            yield return (coordinates[i - 1], coordinates[i], coordinates[i - 1].Distance(coordinates[i]));
    }

    private static bool HasMicroStepRun(Polygon polygon)
    {
        if (HasMicroStepRun(polygon.ExteriorRing)) return true;
        for (int i = 0; i < polygon.NumInteriorRings; i++)
            if (HasMicroStepRun(polygon.GetInteriorRingN(i))) return true;
        return false;
    }

    private static bool HasMicroStepRun(LineString ring)
    {
        var points = ring.Coordinates.Take(ring.NumPoints - 1).ToList();
        bool changed;
        do
        {
            changed = false;
            for (int i = 0; i < points.Count && points.Count >= 3; i++)
            {
                var previous = points[(i + points.Count - 1) % points.Count];
                var current = points[i];
                var next = points[(i + 1) % points.Count];
                double ax = current.X - previous.X, ay = current.Y - previous.Y;
                double bx = next.X - current.X, by = next.Y - current.Y;
                double cross = Math.Abs(ax * by - ay * bx);
                double dot = ax * bx + ay * by;
                if (dot > 0 && cross <= Math.Sin(0.25 * Math.PI / 180) *
                        Math.Sqrt(ax * ax + ay * ay) * Math.Sqrt(bx * bx + by * by))
                {
                    points.RemoveAt(i);
                    changed = true;
                    break;
                }
            }
        } while (changed);

        if (points.Count < 3) return false;
        var shortEdges = Enumerable.Range(0, points.Count)
            .Select(i => points[i].Distance(points[(i + 1) % points.Count]) <= 1).ToArray();
        if (shortEdges.All(x => x)) return true;
        for (int start = 0; start < shortEdges.Length; start++)
            if (!shortEdges[(start + shortEdges.Length - 1) % shortEdges.Length] && shortEdges[start]
                && shortEdges[(start + 1) % shortEdges.Length]
                && shortEdges[(start + 2) % shortEdges.Length])
                return true;
        return false;
    }

    private static SourceRoom ToSourceRoom(RoomResult room)
    {
        var polygon = TakeoffGeometry.ToPolygon(room, Factory);
        if (!polygon.IsValid || polygon.Area <= Epsilon)
            throw new ArgumentException("Room polygon is invalid.");
        return new SourceRoom(room, polygon);
    }

    private static Geometry Rotate(Geometry geometry, double radians) =>
        AffineTransformation.RotationInstance(radians).Transform(geometry);

    private static double Fold90(double angle)
    {
        double period = Math.PI / 2;
        angle %= period;
        if (angle < 0) angle += period;
        return angle;
    }

    private static double AngleDifference90(double a, double b)
    {
        double difference = Math.Abs(Fold90(a) - Fold90(b));
        return Math.Min(difference, Math.PI / 2 - difference);
    }

    private static RoomResult CloneRoom(
        RoomResult room, Geometry? replacement = null, bool collapseCollinear = false)
    {
        var clone = new RoomResult
        {
            Id = room.Id,
            RawSqft = replacement?.Area ?? room.RawSqft,
            PerimeterFt = replacement?.Length ?? room.PerimeterFt,
            LabelX = room.LabelX,
            LabelY = room.LabelY,
            MeanCeilingFt = room.MeanCeilingFt,
            Polygon = replacement is Polygon polygon
                ? Coordinates(polygon.ExteriorRing, counterClockwise: true, collapseCollinear)
                : Copy(room.Polygon),
            Holes = replacement is Polygon p
                ? Enumerable.Range(0, p.NumInteriorRings)
                    .Select(i => Coordinates(p.GetInteriorRingN(i), counterClockwise: false,
                        collapseCollinear)).ToList()
                : room.Holes.Select(Copy).ToList(),
            Flags = room.Flags.ToList(),
            SplitFrom = room.SplitFrom,
            MergedFrom = room.MergedFrom
        };
        return clone;
    }

    private static List<double[]> Coordinates(
        LineString ring, bool counterClockwise, bool collapseCollinear = true)
    {
        var coordinates = ring.Coordinates.Take(ring.NumPoints - 1).ToList();
        if (!collapseCollinear)
        {
            var raw = coordinates.Select(x => new[] { x.X, x.Y }).ToList();
            if ((TakeoffGeometry.SignedArea(raw) > 0) != counterClockwise) raw.Reverse();
            return raw;
        }
        bool changed;
        do
        {
            changed = false;
            for (int i = 0; i < coordinates.Count && coordinates.Count >= 3; i++)
            {
                var previous = coordinates[(i + coordinates.Count - 1) % coordinates.Count];
                var current = coordinates[i];
                var next = coordinates[(i + 1) % coordinates.Count];
                double ax = current.X - previous.X, ay = current.Y - previous.Y;
                double bx = next.X - current.X, by = next.Y - current.Y;
                double cross = Math.Abs(ax * by - ay * bx);
                double dot = ax * bx + ay * by;
                if (dot <= 0 || cross > Epsilon * Math.Sqrt(ax * ax + ay * ay) *
                        Math.Sqrt(bx * bx + by * by)) continue;
                coordinates.RemoveAt(i);
                changed = true;
                break;
            }
        } while (changed);

        var points = coordinates.Select(x => new[] { x.X, x.Y }).ToList();
        if ((TakeoffGeometry.SignedArea(points) > 0) != counterClockwise) points.Reverse();
        return points;
    }

    private static LevelTakeoff ToLevelTakeoff(TakeoffResult source, List<ProjectedRoom> rooms) =>
        new(source.LevelName, source.LevelElevation, rooms.Select(projected =>
        {
            var room = CloneRoom(projected.Source.Room, projected.Geometry, collapseCollinear: false);
            return new TakeoffRoomShape(room.Id, room.RawSqft, room.PerimeterFt, room.MeanCeilingFt,
                room.Polygon, room.Holes) { Label = new[] { room.LabelX, room.LabelY } };
        }).ToList());

    private static List<double[]> Copy(List<double[]> points) =>
        points.Select(x => new[] { x[0], x[1] }).ToList();

    private static FrameLocalConservation Conserved(
        TakeoffResult source,
        TakeoffResult accepted,
        IReadOnlyList<FrameLocalRejectedRoom> rejected)
    {
        var sources = source.Rooms.ToDictionary(room => room.Id, StringComparer.Ordinal);
        var acceptedIds = accepted.Rooms.Select(room => room.Id).ToList();
        var rejectedIds = rejected.Select(item => item.Room.Id).ToList();
        var accounted = acceptedIds.Concat(rejectedIds).ToList();
        if (sources.Count != source.Rooms.Count
            || accounted.Count != sources.Count
            || accounted.Distinct(StringComparer.Ordinal).Count() != accounted.Count
            || accounted.Any(id => !sources.ContainsKey(id)))
            throw new InvalidOperationException(
                "frame-local projection must account for every source room exactly once");

        foreach (var item in rejected)
        {
            var original = sources[item.Room.Id];
            if (Math.Abs(item.Room.RawSqft - original.RawSqft) > Epsilon
                || item.Room.SplitFrom != original.SplitFrom
                || item.Room.MergedFrom != original.MergedFrom
                || !item.Room.Flags.SequenceEqual(original.Flags))
                throw new InvalidOperationException(
                    $"rejected room '{item.Room.Id}' must preserve original area and provenance");
        }
        foreach (var room in accepted.Rooms)
        {
            var original = sources[room.Id];
            if (room.SplitFrom != original.SplitFrom
                || room.MergedFrom != original.MergedFrom
                || !room.Flags.SequenceEqual(original.Flags))
                throw new InvalidOperationException(
                    $"accepted room '{room.Id}' must preserve source provenance");
        }

        double acceptedRejectedOverlap = 0;
        if (accepted.Rooms.Count > 0 && rejected.Count > 0)
        {
            var acceptedDomain = UnaryUnionOp.Union(accepted.Rooms
                .Select(room => (Geometry)ToSourceRoom(room).Geometry).ToList());
            var rejectedDomain = UnaryUnionOp.Union(rejected
                .Select(item => (Geometry)ToSourceRoom(item.Room).Geometry).ToList());
            acceptedRejectedOverlap = acceptedDomain.Intersection(rejectedDomain).Area;
        }
        return new FrameLocalConservation(
            source.Rooms.Count,
            accepted.Rooms.Count,
            rejected.Count,
            source.Rooms.Sum(room => room.RawSqft),
            acceptedIds.Sum(id => sources[id].RawSqft),
            accepted.Rooms.Sum(room => room.RawSqft),
            rejected.Sum(item => item.Room.RawSqft),
            acceptedRejectedOverlap);
    }

    private static TakeoffResult CloneTakeoff(TakeoffResult source, List<RoomResult> rooms) => new()
    {
        LevelName = source.LevelName,
        LevelElevation = source.LevelElevation,
        Source = source.Source,
        Rooms = rooms,
        Residues = source.Residues.ToList(),
        TotalSqft = rooms.Sum(x => x.RawSqft),
        ProfileProvenance = source.ProfileProvenance,
        LevelFlags = source.LevelFlags.ToList(),
        SeedViewA = source.SeedViewA,
        SeedViewB = source.SeedViewB,
        EvidenceView = source.EvidenceView
    };

    private sealed record SourceRoom(RoomResult Room, Polygon Geometry);
    private sealed record Assignment(int Index, int FrameIndex, double Frame, SourceRoom Source);
    private sealed record ProjectedRoom(int Index, int FrameIndex, SourceRoom Source, Polygon Geometry);
}
