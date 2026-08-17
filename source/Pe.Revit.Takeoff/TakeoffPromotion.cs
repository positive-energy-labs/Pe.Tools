using NetTopologySuite.Geometries;
using NetTopologySuite.Operation.Overlay;
using NetTopologySuite.Operation.OverlayNG;

namespace Pe.Revit.Takeoff;

public sealed record ZonePromotionDiagnostics(
    int SourceRooms,
    int SharedNetworkStrictRooms,
    int AcceptedRooms,
    int HeldRooms,
    int TinyMerged,
    double PartitionSqft,
    double ZoneSqft,
    double AcceptedSqft,
    double HeldSqft,
    double VoidSqft,
    double ExcludedSqft,
    double InkBackedEdgeFraction,
    double ClosureErrorSqft,
    bool IsStrictlyEditable,
    bool IsContained,
    int SharedEdgePairs,
    int LostSharedEdgePairs,
    IReadOnlyDictionary<string, int> Rejections,
    IReadOnlyDictionary<string, string> RejectionDetails,
    ZoneCensus? Census = null,
    ZoneTriageVerdict? Triage = null)
{
    public double HeldFraction => this.PartitionSqft <= 0 ? 0 : this.HeldSqft / this.PartitionSqft;
    public double VoidFraction => this.PartitionSqft <= 0 ? 0
        : (this.VoidSqft + this.ExcludedSqft) / this.PartitionSqft;
}

public sealed record ZonePromotionResult(
    TakeoffResult Result,
    ZonePromotionDiagnostics Diagnostics);

/// <summary>
/// Turns one zone's raw detector partition into the promoted disposition: accepted rooms, held
/// rooms, void and excluded residue, closed against the zone's own area.
/// </summary>
public static class TakeoffPromotion
{
    private const double Epsilon = 1e-7;
    private const double AccountingEpsilonSqft = 1e-6;
    private static readonly GeometryFactory GeometryFactory = TakeoffGeometry.Factory;

    /// <summary>
    /// The disposition pipeline, in the one order that is load-bearing. Ordering constraints that
    /// used to live only in the reader's head are visible here: <c>triage</c> runs before anything
    /// reads the partition because a held zone never has one; <c>evidence</c> reads the
    /// post-regularizer partition captured by <c>shared-network</c>; the recombination stages sit
    /// immediately after <c>shared-network</c> and BEFORE <c>frame-projector</c>, because the
    /// lattice cells they exist to absorb are exactly the rooms the projector rejects — running
    /// them later meant they never fired at all (measured: zero events across the 45-zone set);
    /// and <c>disposition</c> must restore held source geometry before residues are rebuilt
    /// inside the zone. An experiment inserts, removes, or reorders entries — this array is the
    /// seam, not an interface.
    /// </summary>
    private static readonly (string Name, Action<PromotionState> Run)[] Stages = [
        ("zone-geometry", state => state.ZoneGeometry = state.Zone.ExactGeometry()),
        ("triage", RunTriage),
        ("shared-network", RunSharedNetwork),
        ("absorb-neighbor", RunAbsorbNeighbor),
        ("edge-band", RunEdgeBand),
        ("frame-projector", RunFrameProjector),
        ("zone-fit", RunZoneFit),
        ("tiny", RunTiny),
        ("evidence", RunEvidence),
        ("scope", RunScope),
        ("ink-backing", RunInkBacking),
        ("shared-audit", RunSharedAudit),
        ("editability", RunEditability),
        ("disposition", RunDisposition),
    ];

    /// <summary>
    /// Runs the disposition pipeline over one zone. <c>census</c> is the pre-solve raster census,
    /// supplied by callers that hold the ink raster; omitting it disables triage, so the zone is
    /// solved exactly as every caller did before the seam existed.
    /// </summary>
    public static ZonePromotionResult PromoteZone(
        TakeoffResult source,
        ZoneScope zone,
        TakeoffOptions options,
        Func<double, double, double> distanceToInk,
        Action<string>? log = null,
        ZoneCensus? census = null)
    {
        if (source == null) throw new ArgumentNullException(nameof(source));
        if (zone == null) throw new ArgumentNullException(nameof(zone));
        if (options == null) throw new ArgumentNullException(nameof(options));
        if (distanceToInk == null) throw new ArgumentNullException(nameof(distanceToInk));
        var state = new PromotionState(source, zone, options, distanceToInk, log) { Census = census };
        var timer = System.Diagnostics.Stopwatch.StartNew();
        long lastMilliseconds = 0;
        foreach (var stage in Stages)
        {
            stage.Run(state);
            long elapsed = timer.ElapsedMilliseconds;
            log?.Invoke(
                $"[promotion] stage={stage.Name} ms={elapsed - lastMilliseconds} total={elapsed}");
            lastMilliseconds = elapsed;
            // A triage hold IS the disposition: the zone is already closed as one held residue and
            // every later stage would be arguing about a partition that must not be trusted.
            if (state.Triage.IsHold) break;
        }
        return Close(state);
    }

    /// <summary>Everything one promotion run reads and mutates as it walks <see cref="Stages"/>.</summary>
    private sealed class PromotionState(
        TakeoffResult source,
        ZoneScope zone,
        TakeoffOptions options,
        Func<double, double, double> distanceToInk,
        Action<string>? log)
    {
        internal readonly TakeoffResult Source = source;
        internal readonly ZoneScope Zone = zone;
        internal readonly TakeoffOptions Options = options;
        internal readonly Func<double, double, double> DistanceToInk = distanceToInk;
        internal readonly Action<string>? Log = log;

        internal readonly TakeoffResult Result = Clone(source);
        internal Geometry ZoneGeometry = null!;      // set by the zone-geometry stage
        internal ZoneCensus? Census;                 // supplied by the caller; null = no triage
        internal ZoneTriageVerdict Triage = ZoneTriageVerdict.Solve;

        // The detector's selected partition is the disposition authority. Every downstream
        // regularizer/projector may either improve a room or hold that exact source room whole.
        internal List<RoomResult> CompletePartition = [];
        internal List<RoomResult> EvidencePartition = [];

        internal readonly double PartitionSqft = source.DomainSqft + source.ClaimedWallSqft;
        internal int SharedNetworkStrictRooms;
        internal int TinyMerged;
        internal int HeldRooms;
        internal int PreservedSharedPairs;
        internal int LostSharedPairs;

        internal readonly Dictionary<string, int> Rejections = new(StringComparer.Ordinal);
        internal readonly Dictionary<string, string> RejectionDetails = new(StringComparer.Ordinal);
    }

    /// <summary>
    /// Pre-solve abstention. A held zone emits no rooms and its entire area as one held residue —
    /// the accounting law closes on the zone's own geometry, and the verdict reason travels as the
    /// residue id so the artifact and the contact sheet both say WHY nothing was solved.
    /// </summary>
    private static void RunTriage(PromotionState state)
    {
        if (state.Census == null) return;
        state.Triage = ZoneTriage.Evaluate(state.Census, state.Options);
        if (!state.Triage.IsHold) return;
        state.Result.Rooms.Clear();
        state.Result.Residues.Clear();
        AddResidues(
            state.Result.Residues, $"TRIAGE-HELD:{state.Triage.Reason}",
            ResidueReason.Rejected, state.ZoneGeometry, 0);
        state.Result.TotalSqft = 0;
        state.Result.DomainSqft = state.ZoneGeometry.Area;
        state.Result.ClaimedWallSqft = 0;
        state.Result.ExcludedResidueSqft = 0;
        state.HeldRooms = state.Result.Residues.Count;
        state.Log?.Invoke($"[promotion] triage held zone whole: {state.Triage.Reason} " +
                          $"zone={state.ZoneGeometry.Area:F0}sf " +
                          $"inkRatio={state.Census.InkRatio:P0}");
    }

    /// <summary>
    /// Absorb-into-neighbor recombination: a small room that hands most of its perimeter to one
    /// neighbor is a lattice cell, not a space, so it merges into whichever neighbor holds the most
    /// of that perimeter. Runs on the raw post-regularizer room set — every room is a candidate
    /// neighbor, because nothing has been accepted or rejected yet.
    /// </summary>
    private static void RunAbsorbNeighbor(PromotionState state)
    {
        if (state.Options.AbsorbNeighborMaxSqft <= 0) return;
        int merged = 0;
        foreach (var room in state.Result.Rooms
                     .Where(item => item.RawSqft < state.Options.AbsorbNeighborMaxSqft)
                     .OrderBy(item => item.RawSqft).ThenBy(item => item.Id, StringComparer.Ordinal)
                     .ToList())
        {
            if (!state.Result.Rooms.Contains(room)) continue;
            var geometry = ToPolygon(room);
            double perimeter = geometry.Length;
            if (perimeter <= Epsilon) continue;
            var target = LargestSharedNeighbor(state.Result, room, geometry);
            double share = target == null ? 0 : target.Value.SharedLength / perimeter;
            state.Log?.Invoke($"[promotion] absorb candidate={room.Id} sqft={room.RawSqft:F0} " +
                              $"share={share:P0} target={target?.Room.Id ?? "none"}");
            if (target == null
                || share < state.Options.AbsorbNeighborSharedPerimeterFraction) continue;
            if (TryMerge(state.Result, room, target.Value.Room, requireStrictEditability: false))
                merged++;
        }
        Settle(state, "absorb:merged", merged);
    }

    /// <summary>
    /// Zone-edge-band recombination: a room living almost entirely in the band that hugs the zone
    /// boundary is a rind left by the mask, not a space, so it folds back into the neighbor holding
    /// the most of its perimeter. A rind with no neighbor at all is simply left alone — the gates
    /// downstream judge it on the same terms as every other room, so nothing needs holding here.
    /// </summary>
    private static void RunEdgeBand(PromotionState state)
    {
        if (state.Options.EdgeBandFt <= 0 || state.Result.Rooms.Count == 0) return;
        var band = state.ZoneGeometry.Boundary.Buffer(state.Options.EdgeBandFt);
        var rind = state.Result.Rooms.Where(room =>
            {
                var geometry = ToPolygon(room);
                if (geometry.Area <= Epsilon) return false;
                double inBand = PolygonIntersection(geometry, band).Area / geometry.Area;
                state.Log?.Invoke($"[promotion] edgeband candidate={room.Id} " +
                                  $"sqft={room.RawSqft:F0} inBand={inBand:P0}");
                return inBand >= state.Options.EdgeBandAreaFraction;
            })
            .OrderBy(room => room.RawSqft).ThenBy(room => room.Id, StringComparer.Ordinal)
            .ToList();
        int merged = 0;
        foreach (var room in rind)
        {
            if (!state.Result.Rooms.Contains(room)) continue;
            var target = LargestSharedNeighbor(state.Result, room, ToPolygon(room));
            bool ok = target != null
                      && TryMerge(state.Result, room, target.Value.Room,
                          requireStrictEditability: false);
            state.Log?.Invoke($"[promotion] edgeband merge={room.Id} -> " +
                              $"{target?.Room.Id ?? "none"} {(ok ? "merged" : "declined")}");
            if (ok) merged++;
        }
        Settle(state, "edgeband:merged", merged);
    }

    /// <summary>
    /// Records a recombination stage's tally and re-establishes what the later stages read: the
    /// area total, and the evidence partition snapshot. That snapshot is what the evidence gate
    /// treats as "the partition" when deciding which rails are exposed — leaving it stale would
    /// make a merged room answer for the interior rail it just swallowed.
    /// </summary>
    private static void Settle(PromotionState state, string rejectionKey, int merged)
    {
        if (merged <= 0) return;
        state.Rejections[rejectionKey] = merged;
        state.Result.TotalSqft = state.Result.Rooms.Sum(item => item.RawSqft);
        state.EvidencePartition = state.Result.Rooms.Select(room => Clone(room)).ToList();
    }

    private static (RoomResult Room, double SharedLength)? LargestSharedNeighbor(
        TakeoffResult result, RoomResult room, Polygon geometry)
    {
        var neighbors = Neighbors(result, room, geometry);
        if (neighbors.Count == 0) return null;
        return neighbors
            .OrderByDescending(item => item.SharedLength)
            .ThenBy(item => item.Room.Id, StringComparer.Ordinal)
            .First();
    }

    private static List<(RoomResult Room, double SharedLength)> Neighbors(
        TakeoffResult result, RoomResult room, Polygon geometry) =>
        result.Rooms.Where(other => !ReferenceEquals(other, room))
            .Select(other => (
                Room: other,
                SharedLength: ToPolygon(other).Boundary.Intersection(geometry.Boundary).Length))
            .Where(item => item.SharedLength > Epsilon)
            .ToList();

    /// <summary>
    /// The one merge mechanic every recombination stage shares: union the two rooms and commit only
    /// a single valid polygon.
    /// </summary>
    /// <remarks>
    /// <paramref name="requireStrictEditability"/> is the difference between the two callers, and
    /// it is load-bearing. <c>tiny</c> runs AFTER the frame projector, on geometry that is already
    /// strict, so it must re-audit or it would ship a bent union. The recombination stages run
    /// BEFORE the projector on raw watershed geometry that is not strict yet and never claims to
    /// be — auditing there would reject every single merge, which is precisely how these stages
    /// managed to fire zero times. Their unions are judged by the projector and the editability
    /// gate downstream, like any other room.
    /// </remarks>
    private static bool TryMerge(
        TakeoffResult result, RoomResult source, RoomResult target,
        bool requireStrictEditability = true)
    {
        if (ToPolygon(target).Union(ToPolygon(source)) is not Polygon polygon || !polygon.IsValid)
            return false;
        var merged = Clone(target, polygon);
        merged.MergedFrom = string.Join("+", new[] {
                target.MergedFrom, source.Id, source.SplitFrom, source.MergedFrom,
            }
            .Where(value => !string.IsNullOrWhiteSpace(value)));
        merged.Flags = target.Flags.Concat(source.Flags)
            .Distinct(StringComparer.Ordinal).OrderBy(value => value, StringComparer.Ordinal)
            .ToList();
        if (requireStrictEditability)
        {
            var candidate = result.Rooms
                .Where(room => !ReferenceEquals(room, source) && !ReferenceEquals(room, target))
                .Append(merged).ToList();
            if (!TakeoffEditability.Evaluate(ToLevel(result, candidate)).IsStrictlyEditable)
                return false;
        }
        result.Rooms[result.Rooms.IndexOf(target)] = merged;
        result.Rooms.Remove(source);
        return true;
    }

    private static void RunSharedNetwork(PromotionState state)
    {
        state.CompletePartition = state.Result.Rooms.Select(room => Clone(room)).ToList();
        SpaceBoundaryNetwork.Regularize(
            state.Result.Rooms, state.Options, state.Log);
        NormalizeRoomMeasures(state.Result.Rooms);
        state.EvidencePartition = state.Result.Rooms.Select(room => Clone(room)).ToList();
        state.SharedNetworkStrictRooms = TakeoffEditability
            .Evaluate(ToLevel(state.Result, state.Result.Rooms))
            .Rooms.Count(room => room.IsStrictlyEditable);
    }

    private static void RunFrameProjector(PromotionState state)
    {
        var projection = FrameLocalProjector.Project(
            state.Result, FrameLocalKnobs.From(state.Options), state.ZoneGeometry);
        foreach (var group in projection.Rejected.GroupBy(item => $"frame:{item.Reason}"))
            state.Rejections[group.Key] = group.Count();
        foreach (var item in projection.Rejected)
        {
            state.RejectionDetails[item.Room.Id] = $"frame:{item.Reason} {item.Detail}";
            // Miss attribution rides as its own key so a sweep can read the magnitudes without
            // parsing prose, and so a rejection that was NOT about drift still reports how far the
            // projection had wandered when some other gate stopped it.
            if (item.AreaDrift != null || item.BoundaryDriftFt != null)
                state.RejectionDetails[$"drift/{item.Room.Id}"] =
                    $"area={item.AreaDrift ?? double.NaN:F4} " +
                    $"boundary={item.BoundaryDriftFt ?? double.NaN:F3}ft";
        }
        ApplyFrameLocal(state.Result, projection, state.Log);
    }

    /// <summary>
    /// Fits accepted rooms to the zone boundary, which is USER-DECLARED AUTHORITY. Ink is evidence,
    /// so a room that disagrees with it earns a drift budget and is judged; the zone boundary is not
    /// evidence about where the room is — it is the statement of where the room ends. So a room that
    /// misses it by a hair is moved onto it (<b>snap</b>) and a room that runs past it is cut by it
    /// (<b>clip</b>), instead of being argued with or thrown away.
    /// </summary>
    /// <remarks>
    /// Runs after <c>frame-projector</c>, on rail-snapped geometry, so the only gaps left along the
    /// zone edge are the raster's, not the watershed's — and before <c>tiny</c>, so a room that clip
    /// takes below the area floor is judged by the floor exactly like any other small room.
    /// <para>
    /// Nothing here is permitted to be a relaxation. A fitted room is committed only if it clears
    /// the same strict editability audit, area floor, containment, and non-overlap that every other
    /// accepted room clears, AND keeps every shared edge it had with a neighbour. If it fails —
    /// the ordinary case being a zone edge cut diagonally across the room's frame, where snapping
    /// bends the room off its rails — the pre-fit geometry is restored untouched and the downstream
    /// scope gate judges the room on exactly today's terms. Snapping only ever moves a vertex that
    /// lies on no neighbour's boundary, so a shared wall cannot be dragged by its endpoint.
    /// </para>
    /// </remarks>
    private static void RunZoneFit(PromotionState state)
    {
        bool snapping = state.Options.ZoneSnapFt > 0;
        if ((!snapping && !state.Options.ZoneClipEnabled) || state.Result.Rooms.Count == 0) return;
        var zoneBoundary = state.ZoneGeometry.Boundary;
        int snapped = 0, clipped = 0, fellBack = 0;
        foreach (var room in state.Result.Rooms
                     .OrderBy(item => item.Id, StringComparer.Ordinal).ToList())
        {
            int index = state.Result.Rooms.IndexOf(room);
            if (index < 0) continue;
            var original = ToPolygon(room);
            var neighbors = state.Result.Rooms.Where(other => !ReferenceEquals(other, room))
                .Select(other => (other.Id, Geometry: ToPolygon(other))).ToList();

            // Snap and clip are tried together first, but a snap is never allowed to sink a clip
            // that would have stood on its own: if the combined candidate fails the strict audit,
            // the clip-only candidate gets its own hearing before the room falls back.
            (Polygon Fitted, List<Polygon> Dropped, bool DidSnap, bool DidClip)? Attempt(bool withSnap)
            {
                var fitted = original;
                bool didSnap = false, didClip = false;
                if (withSnap && snapping
                    && SnapToZone(fitted, zoneBoundary, neighbors, state.Options.ZoneSnapFt)
                        is { } moved)
                {
                    fitted = moved;
                    didSnap = true;
                }

                var dropped = new List<Polygon>();
                if (state.Options.ZoneClipEnabled
                    && PolygonDifference(fitted, state.ZoneGeometry).Area > Epsilon)
                {
                    // Clip can shatter an overhanging room into several in-zone pieces. Only the
                    // largest is a candidate room; the rest are residue, because picking a second
                    // "best" piece would be the solver inventing a partition the detector never
                    // proposed.
                    var parts = PolygonParts(PolygonIntersection(fitted, state.ZoneGeometry))
                        .Where(part => part.Area > Epsilon)
                        .OrderByDescending(part => part.Area)
                        .ThenBy(part => part.InteriorPoint.X).ThenBy(part => part.InteriorPoint.Y)
                        .ToList();
                    if (parts.Count == 0) return null;   // wholly outside: the scope gate owns it
                    fitted = parts[0];
                    dropped = parts.Skip(1).ToList();
                    didClip = true;
                }
                return didSnap || didClip ? (fitted, dropped, didSnap, didClip) : null;
            }

            var attempts = new List<(Polygon Fitted, List<Polygon> Dropped, bool DidSnap, bool DidClip)>();
            if (Attempt(withSnap: true) is { } combined) attempts.Add(combined);
            if (attempts.Count > 0 && attempts[0].DidSnap && attempts[0].DidClip
                && Attempt(withSnap: false) is { } clipOnly) attempts.Add(clipOnly);
            if (attempts.Count == 0) continue;

            bool committed = false;
            foreach (var attempt in attempts)
            {
                var candidate = Clone(room, attempt.Fitted);
                candidate.Flags = candidate.Flags.Append("zone-fit")
                    .Distinct(StringComparer.Ordinal).OrderBy(value => value, StringComparer.Ordinal)
                    .ToList();
                if (!Fits(state, candidate, attempt.Fitted, original, neighbors)) continue;

                state.Result.Rooms[index] = candidate;
                foreach (var part in attempt.Dropped)
                    AddResidues(state.Result.Residues, $"{room.Id}~zonefit",
                        ResidueReason.Rejected, part, room.MeanCeilingFt);
                if (attempt.DidSnap) snapped++;
                if (attempt.DidClip) clipped++;
                state.Log?.Invoke(
                    $"[promotion] zone-fit room={room.Id} snap={attempt.DidSnap} " +
                    $"clip={attempt.DidClip} sqft={original.Area:F0}->{attempt.Fitted.Area:F0} " +
                    $"residue={attempt.Dropped.Count}");
                committed = true;
                break;
            }
            if (!committed)
            {
                fellBack++;
                state.Log?.Invoke($"[promotion] zone-fit fell back room={room.Id}");
            }
        }
        if (snapped > 0) state.Rejections["zonefit:snapped"] = snapped;
        if (clipped > 0) state.Rejections["zonefit:clipped"] = clipped;
        if (fellBack > 0) state.Rejections["zonefit:fallback"] = fellBack;
        state.Result.TotalSqft = state.Result.Rooms.Sum(item => item.RawSqft);
    }

    /// <summary>
    /// The zone-fit admission test: every law an accepted room already answers to, re-asked of the
    /// fitted geometry. A false here means the pre-fit room stands, unmodified.
    /// </summary>
    private static bool Fits(
        PromotionState state, RoomResult candidate, Polygon fitted, Polygon original,
        List<(string Id, Polygon Geometry)> neighbors)
    {
        // Each refusal names itself in RejectionDetails: a fallback whose cause is invisible is a
        // dead end for tuning, and the zone-fit stage is where diagonal zones go to die quietly.
        string Refuse(string why)
        {
            state.RejectionDetails[$"zonefit/{candidate.Id}"] = why;
            return why;
        }
        if (!fitted.IsValid || fitted.Area < state.Options.MinimumPromotedRoomSqft)
            { Refuse($"invalid-or-tiny area={fitted.Area:F1}"); return false; }
        if (PolygonDifference(fitted, state.ZoneGeometry).Area > Epsilon)
            { Refuse("still-overhangs-zone"); return false; }
        if (neighbors.Any(other => PolygonIntersection(fitted, other.Geometry).Area > Epsilon))
            { Refuse("overlaps-neighbor"); return false; }
        // Shared-edge survival on the same terms the shared-audit stage enforces: a wall two rooms
        // agreed on may not quietly stop existing because one of them was fitted.
        foreach (var other in neighbors)
        {
            if (Intersection(original.Boundary, other.Geometry.Boundary).Length <= Epsilon) continue;
            if (Intersection(fitted.Boundary, other.Geometry.Boundary).Length <= Epsilon)
                { Refuse($"lost-shared-edge with={other.Id}"); return false; }
        }
        var together = state.Result.Rooms
            .Select(room => room.Id == candidate.Id ? candidate : room).ToList();
        var audit = TakeoffEditability.Evaluate(ToLevel(state.Result, together));
        if (audit.IsStrictlyEditable) return true;
        var kinds = audit.Rooms.Where(room => !room.IsStrictlyEditable)
            .SelectMany(room => room.Violations.Select(violation => $"{room.RoomId}:{violation.Kind}"))
            .Distinct().Take(6);
        Refuse($"editability {string.Join(",", kinds)}");
        return false;
    }

    /// <summary>
    /// Moves every room edge that runs parallel to a zone segment within <paramref name="snapFt"/>
    /// onto that segment's line, and returns null when nothing moved. An edge with an endpoint on a
    /// neighbour's boundary is pinned: it is a shared wall, and the zone has no authority there.
    /// </summary>
    private static Polygon? SnapToZone(
        Polygon room, Geometry zoneBoundary,
        List<(string Id, Polygon Geometry)> neighbors, double snapFt)
    {
        // Edge-wise, frame-preserving: a room EDGE moves onto the zone line only when a zone
        // segment runs parallel to it (within a few degrees) and both endpoints are within snapFt
        // of that segment's line. Vertex-wise nearest-point snapping was falsified on the diagonal
        // wings — a lone vertex snapping across a zone jog onto a non-parallel segment tilts both
        // adjacent edges, the strict audit refuses the tilt, and the whole fit falls back.
        const double parallelTolDeg = 3.0;
        var zoneSegments = new List<(Coordinate A, Coordinate B)>();
        foreach (var geometry in zoneBoundary is GeometryCollection collection
                     ? collection.Geometries : [zoneBoundary])
            if (geometry is LineString line)
                for (int i = 1; i < line.NumPoints; i++)
                    zoneSegments.Add((line.GetCoordinateN(i - 1), line.GetCoordinateN(i)));

        bool moved = false;
        var exterior = SnapRing(room.ExteriorRing);
        var holes = Enumerable.Range(0, room.NumInteriorRings)
            .Select(index => SnapRing(room.GetInteriorRingN(index))).ToArray();
        if (!moved) return null;
        var polygon = GeometryFactory.CreatePolygon(exterior, holes);
        return polygon.IsValid && polygon.Area > Epsilon ? polygon : null;

        LinearRing SnapRing(LineString ring)
        {
            var points = ring.Coordinates.Take(ring.NumPoints - 1).Select(p => p.Copy()).ToList();
            int count = points.Count;
            for (int i = 0; i < count; i++)
            {
                var a = points[i];
                var b = points[(i + 1) % count];
                if (Pinned(a) || Pinned(b)) continue;
                foreach (var segment in zoneSegments)
                {
                    double edgeAngle = Math.Atan2(b.Y - a.Y, b.X - a.X);
                    double zoneAngle = Math.Atan2(segment.B.Y - segment.A.Y, segment.B.X - segment.A.X);
                    double delta = Math.Abs(edgeAngle - zoneAngle) % Math.PI;
                    delta = Math.Min(delta, Math.PI - delta);
                    if (delta > parallelTolDeg * Math.PI / 180) continue;
                    // Signed offset of each endpoint from the zone segment's infinite line, along
                    // its normal; both must be within snapFt and the projections must overlap the
                    // segment so a far-away parallel wall is never dragged.
                    double ux = segment.B.X - segment.A.X, uy = segment.B.Y - segment.A.Y;
                    double len = Math.Sqrt(ux * ux + uy * uy);
                    if (len <= Epsilon) continue;
                    ux /= len; uy /= len;
                    double OffsetOf(Coordinate p) =>
                        (p.X - segment.A.X) * -uy + (p.Y - segment.A.Y) * ux;
                    double TOf(Coordinate p) =>
                        (p.X - segment.A.X) * ux + (p.Y - segment.A.Y) * uy;
                    double offsetA = OffsetOf(a), offsetB = OffsetOf(b);
                    if (Math.Abs(offsetA) <= Epsilon && Math.Abs(offsetB) <= Epsilon) continue;
                    if (Math.Abs(offsetA) > snapFt || Math.Abs(offsetB) > snapFt) continue;
                    double t0 = Math.Min(TOf(a), TOf(b)), t1 = Math.Max(TOf(a), TOf(b));
                    if (t1 < 0 || t0 > len) continue;
                    points[i] = new Coordinate(a.X - offsetA * -uy, a.Y - offsetA * ux);
                    points[(i + 1) % count] = new Coordinate(b.X - offsetB * -uy, b.Y - offsetB * ux);
                    moved = true;
                    break;
                }
            }
            points.Add(new Coordinate(points[0].X, points[0].Y));
            return GeometryFactory.CreateLinearRing(points.ToArray());
        }

        bool Pinned(Coordinate point)
        {
            var vertex = GeometryFactory.CreatePoint(point);
            return neighbors.Any(other => other.Geometry.Boundary.Distance(vertex) <= Epsilon);
        }
    }

    private static void RunTiny(PromotionState state)
    {
        int beforeTiny = state.Result.Rooms.Count;
        int heldTiny = state.Options.MinimumPromotedRoomSqft > 0
            ? MergeOrHoldTinyRooms(state.Result, state.Options.MinimumPromotedRoomSqft, state.Log)
            : 0;
        state.TinyMerged = beforeTiny - state.Result.Rooms.Count - heldTiny;
        if (heldTiny > 0) state.Rejections["tiny:held"] = heldTiny;
    }

    private static void RunEvidence(PromotionState state)
    {
        int rejected = RejectMisalignedExposedRails(
            state.Result, state.EvidencePartition, state.DistanceToInk, state.Log);
        if (rejected > 0) state.Rejections["evidence:misaligned"] = rejected;
    }

    private static void RunScope(PromotionState state)
    {
        foreach (var room in state.Result.Rooms)
        {
            var polygon = ToPolygon(room);
            double outside = PolygonDifference(polygon, state.ZoneGeometry).Area;
            if (outside > Epsilon)
                state.RejectionDetails[$"scope/{room.Id}"] =
                    $"outside={outside:F2} sf of {polygon.Area:F0} sf ({outside / polygon.Area:P2})";
        }
        int rejected = RejectOutsideZone(state.Result, state.ZoneGeometry);
        if (rejected > 0) state.Rejections["scope:outside"] = rejected;
    }

    /// <summary>
    /// Teal means trustworthy: an accepted room must stand on wall ink. The zone edge is exempt —
    /// it is authority, not evidence — so what is judged is only the boundary the solver itself
    /// asserted. A room below the floor is held whole, exactly like any other hold: this is the
    /// gate that stops seal-manufactured partitions in ink-starved zones from reading as solved.
    /// </summary>
    private static void RunInkBacking(PromotionState state)
    {
        if (state.Options.InkBackedAcceptMin <= 0 || state.Result.Rooms.Count == 0) return;
        var zoneBoundary = state.ZoneGeometry.Boundary;
        int held = 0;
        foreach (var room in state.Result.Rooms
                     .OrderBy(item => item.Id, StringComparer.Ordinal).ToList())
        {
            double? backed = TakeoffEvidenceFidelity.RoomBoundarySupportFraction(
                room, state.DistanceToInk, zoneBoundary, state.Options.InkBackedZoneEdgeExemptFt);
            if (backed == null || backed >= state.Options.InkBackedAcceptMin) continue;
            state.Result.Rooms.Remove(room);
            MoveToRejectedResidue(state.Result, [room]);
            state.RejectionDetails[$"ink/{room.Id}"] = $"backed {backed:P0} < " +
                $"{state.Options.InkBackedAcceptMin:P0} of non-zone-edge boundary";
            held++;
        }
        if (held > 0)
        {
            state.Rejections["ink:unbacked"] = held;
            state.Result.TotalSqft = state.Result.Rooms.Sum(room => room.RawSqft);
            state.Log?.Invoke($"[promotion] ink-backing held={held}");
        }
    }

    private static void RunSharedAudit(PromotionState state)
    {
        var shared = EnforceSharedEdges(state.Result, state.CompletePartition);
        state.PreservedSharedPairs = shared.PreservedPairs;
        state.LostSharedPairs = shared.LostPairs;
        if (shared.LostPairs > 0) state.Rejections["shared:lost"] = shared.LostPairs;
    }

    private static void RunEditability(PromotionState state)
    {
        int rejected = RejectUneditable(state.Result);
        if (rejected > 0) state.Rejections["editability:final"] = rejected;
    }

    private static void RunDisposition(PromotionState state)
    {
        state.HeldRooms = state.Result.Residues
            .Count(residue => residue.Reason == ResidueReason.Rejected);
        RestoreHeldSourceGeometry(state.Result, state.CompletePartition);
        RebuildResiduesInsideZone(state.Result, state.ZoneGeometry);
    }

    /// <summary>Measures the finished disposition, enforces the binding laws, and reports.</summary>
    private static ZonePromotionResult Close(PromotionState state)
    {
        var result = state.Result;
        double acceptedSqft = result.Rooms.Sum(room => room.RawSqft);
        double heldSqft = result.Residues
            .Where(residue => residue.Reason == ResidueReason.Rejected)
            .Sum(residue => residue.RawSqft);
        double voidSqft = result.Residues
            .Where(residue => residue.Reason is ResidueReason.Border or ResidueReason.Crumb)
            .Sum(residue => residue.RawSqft);
        double excludedSqft = result.Residues
            .Where(residue => residue.Reason == ResidueReason.Excluded)
            .Sum(residue => residue.RawSqft);
        double closureError = Math.Abs(
            acceptedSqft + heldSqft + voidSqft + excludedSqft - state.ZoneGeometry.Area);
        bool strict = TakeoffEditability.Evaluate(ToLevel(result, result.Rooms)).IsStrictlyEditable;
        bool contained = result.Rooms.All(room =>
            PolygonDifference(ToPolygon(room), state.ZoneGeometry).Area <= Epsilon);
        if (!strict || !contained || closureError > AccountingEpsilonSqft)
            throw new InvalidOperationException(
                $"zone promotion violated a binding law: strict={strict} contained={contained} " +
                $"closure={closureError:F9}sf");
        var diagnostics = new ZonePromotionDiagnostics(
            state.Source.Rooms.Count,
            state.SharedNetworkStrictRooms,
            result.Rooms.Count,
            state.HeldRooms,
            state.TinyMerged,
            state.PartitionSqft,
            state.ZoneGeometry.Area,
            acceptedSqft,
            heldSqft,
            voidSqft,
            excludedSqft,
            TakeoffEvidenceFidelity.BoundarySupportFraction(result.Rooms, state.DistanceToInk),
            closureError,
            strict,
            contained,
            state.PreservedSharedPairs,
            state.LostSharedPairs,
            new SortedDictionary<string, int>(state.Rejections, StringComparer.Ordinal),
            new SortedDictionary<string, string>(state.RejectionDetails, StringComparer.Ordinal),
            state.Census,
            state.Triage);
        return new ZonePromotionResult(result, diagnostics);
    }

    private static void NormalizeRoomMeasures(IEnumerable<RoomResult> rooms)
    {
        foreach (var room in rooms)
        {
            var polygon = ToPolygon(room);
            room.RawSqft = polygon.Area;
            room.PerimeterFt = polygon.Length;
        }
    }

    private static void RestoreHeldSourceGeometry(
        TakeoffResult result, IReadOnlyList<RoomResult> sourceRooms)
    {
        var sourceById = sourceRooms.ToDictionary(room => room.Id, StringComparer.Ordinal);
        foreach (var residue in result.Residues
                     .Where(item => item.Reason == ResidueReason.Rejected))
        {
            if (!sourceById.TryGetValue(residue.Id, out var source)) continue;
            residue.RawSqft = ToPolygon(source).Area;
            residue.LabelX = source.LabelX;
            residue.LabelY = source.LabelY;
            residue.MeanCeilingFt = source.MeanCeilingFt;
            residue.Polygon = source.Polygon.Select(point => new[] { point[0], point[1] }).ToList();
            residue.Holes = source.Holes.Select(hole => hole
                .Select(point => new[] { point[0], point[1] }).ToList()).ToList();
        }
    }

    private static int RejectOutsideZone(TakeoffResult result, Geometry zone)
    {
        var rejected = result.Rooms.Where(room =>
            PolygonDifference(ToPolygon(room), zone).Area > Epsilon).ToList();
        if (rejected.Count == 0) return 0;
        result.Rooms.RemoveAll(rejected.Contains);
        MoveToRejectedResidue(result, rejected);
        return rejected.Count;
    }

    private static (int PreservedPairs, int LostPairs) EnforceSharedEdges(
        TakeoffResult result, IReadOnlyList<RoomResult> source)
    {
        var sourceGeometry = source.ToDictionary(room => room.Id, ToPolygon, StringComparer.Ordinal);
        var accepted = result.Rooms.ToDictionary(room => room.Id, ToPolygon, StringComparer.Ordinal);
        var lostIds = new HashSet<string>(StringComparer.Ordinal);
        int preserved = 0, lost = 0;
        var ids = accepted.Keys.Where(sourceGeometry.ContainsKey).OrderBy(id => id, StringComparer.Ordinal).ToList();
        for (int left = 0; left < ids.Count; left++)
        for (int right = left + 1; right < ids.Count; right++)
        {
            string a = ids[left], b = ids[right];
            double expected = Intersection(
                sourceGeometry[a].Boundary, sourceGeometry[b].Boundary).Length;
            if (expected <= Epsilon) continue;
            double actual = Intersection(accepted[a].Boundary, accepted[b].Boundary).Length;
            if (actual > Epsilon) preserved++;
            else
            {
                lost++;
                lostIds.Add(a);
                lostIds.Add(b);
            }
        }
        if (lostIds.Count > 0)
        {
            var rejected = result.Rooms.Where(room => lostIds.Contains(room.Id)).ToList();
            result.Rooms.RemoveAll(room => lostIds.Contains(room.Id));
            MoveToRejectedResidue(result, rejected);
        }
        return (preserved, lost);
    }

    private static int RejectUneditable(TakeoffResult result)
    {
        if (result.Rooms.Count == 0) return 0;
        var rejectedIds = TakeoffEditability.Evaluate(ToLevel(result, result.Rooms)).Rooms
            .Where(room => !room.IsStrictlyEditable)
            .Select(room => room.RoomId).ToHashSet(StringComparer.Ordinal);
        if (rejectedIds.Count == 0) return 0;
        var rejected = result.Rooms.Where(room => rejectedIds.Contains(room.Id)).ToList();
        result.Rooms.RemoveAll(room => rejectedIds.Contains(room.Id));
        MoveToRejectedResidue(result, rejected);
        return rejected.Count;
    }

    private static void RebuildResiduesInsideZone(TakeoffResult result, Geometry zone)
    {
        Geometry available = result.Rooms.Count == 0
            ? zone.Copy()
            : PolygonDifference(zone, OverlayNGRobust.Union(
                result.Rooms.Select(room => (Geometry)ToPolygon(room))));
        var rebuilt = new List<ResidueResult>();
        foreach (var residue in result.Residues
                     .OrderBy(item => item.Reason == ResidueReason.Rejected ? 0 : 1)
                     .ThenBy(item => item.Id, StringComparer.Ordinal))
        {
            var geometry = PolygonIntersection(ToGeometry(residue), available);
            AddResidues(rebuilt, residue.Id, residue.Reason, geometry, residue.MeanCeilingFt);
            if (!geometry.IsEmpty) available = PolygonDifference(available, geometry);
        }
        AddResidues(rebuilt, "ZONE-EXCLUDED", ResidueReason.Excluded, available, 0);
        result.Residues = rebuilt;
        result.DomainSqft = zone.Area;
        result.ClaimedWallSqft = 0;
        result.ExcludedResidueSqft = 0;
        result.TotalSqft = result.Rooms.Sum(room => room.RawSqft);
    }

    private static Geometry ToGeometry(ResidueResult residue) =>
        TakeoffGeometry.ToPolygon(residue, GeometryFactory);

    private static Geometry Intersection(Geometry left, Geometry right) =>
        OverlayNGRobust.Overlay(left, right, SpatialFunction.Intersection);

    private static Geometry PolygonIntersection(Geometry left, Geometry right) =>
        Polygonal(OverlayNGRobust.Overlay(
            Polygonal(left), Polygonal(right), SpatialFunction.Intersection));

    private static Geometry PolygonDifference(Geometry left, Geometry right) =>
        Polygonal(OverlayNGRobust.Overlay(
            Polygonal(left), Polygonal(right), SpatialFunction.Difference));

    private static Geometry Polygonal(Geometry geometry)
    {
        var polygons = PolygonParts(geometry).Cast<Geometry>().ToList();
        return polygons.Count switch {
            0 => GeometryFactory.CreatePolygon(),
            1 => polygons[0],
            _ => GeometryFactory.BuildGeometry(polygons),
        };
    }

    private static void AddResidues(
        ICollection<ResidueResult> target, string id, ResidueReason reason,
        Geometry geometry, double meanCeilingFt)
    {
        var polygons = PolygonParts(geometry).Where(polygon => polygon.Area > Epsilon).ToList();
        for (int index = 0; index < polygons.Count; index++)
        {
            var polygon = polygons[index];
            var label = polygon.InteriorPoint.Coordinate;
            target.Add(new ResidueResult {
                Id = polygons.Count == 1 ? id : $"{id}~{index + 1}",
                Reason = reason,
                RawSqft = polygon.Area,
                LabelX = label.X,
                LabelY = label.Y,
                MeanCeilingFt = meanCeilingFt,
                Polygon = Coordinates(polygon.ExteriorRing, true),
                Holes = Enumerable.Range(0, polygon.NumInteriorRings)
                    .Select(ring => Coordinates(polygon.GetInteriorRingN(ring), false)).ToList(),
            });
        }
    }

    private static IEnumerable<Polygon> PolygonParts(Geometry geometry)
    {
        if (geometry is Polygon polygon) yield return polygon;
        else if (geometry is GeometryCollection collection)
            for (int index = 0; index < collection.NumGeometries; index++)
            foreach (var part in PolygonParts(collection.GetGeometryN(index))) yield return part;
    }

    internal static int ApplyFrameLocal(
        TakeoffResult result, FrameLocalProjectionResult projection, Action<string>? log = null)
    {
        var rejected = projection.Rejected.Select(item => item.Room).ToList();
        result.Rooms = projection.Accepted.Rooms.ToList();
        MoveToRejectedResidue(result, rejected);
        result.TotalSqft = result.Rooms.Sum(room => room.RawSqft);
        if (projection.Rejected.Count > 0)
        {
            string reasons = string.Join(" ", projection.Rejected
                .GroupBy(item => item.Reason)
                .OrderBy(group => group.Key)
                .Select(group => $"{group.Key}={group.Count()}"));
            log?.Invoke($"[promotion] frame-local accepted={result.Rooms.Count} " +
                        $"rejected={projection.Rejected.Count} {reasons}");
        }
        return projection.Rejected.Count;
    }

    internal static int MergeOrHoldTinyRooms(
        TakeoffResult result, double minimumSqft, Action<string>? log = null)
    {
        int merged = 0, held = 0;
        foreach (var tiny in result.Rooms.Where(room => room.RawSqft < minimumSqft)
                     .OrderBy(room => room.RawSqft).ThenBy(room => room.Id, StringComparer.Ordinal)
                     .ToList())
        {
            if (!result.Rooms.Contains(tiny)) continue;
            var neighbors = Neighbors(result, tiny, ToPolygon(tiny));
            if (neighbors.Count == 1 && TryMerge(result, tiny, neighbors[0].Room))
            {
                merged++;
                continue;
            }
            result.Rooms.Remove(tiny);
            MoveToRejectedResidue(result, [tiny]);
            held++;
        }
        result.TotalSqft = result.Rooms.Sum(room => room.RawSqft);
        log?.Invoke($"[promotion] tiny-room policy merged={merged} held={held} " +
                    $"minimum={minimumSqft:F0}sf accepted={result.Rooms.Count}");
        return held;
    }

    internal static int RejectMisalignedExposedRails(
        TakeoffResult result,
        IReadOnlyList<RoomResult> completePartition,
        Func<double, double, double>? distanceToInk,
        Action<string>? log = null)
    {
        if (distanceToInk == null || result.Rooms.Count == 0) return 0;
        var acceptedIds = result.Rooms.Select(room => room.Id).ToHashSet(StringComparer.Ordinal);
        var survivingRails = TakeoffEvidenceFidelity.Evaluate(
            completePartition, acceptedIds, distanceToInk);
        var rejectedIds = survivingRails.Select(rail => rail.RoomId).ToHashSet(StringComparer.Ordinal);
        if (rejectedIds.Count == 0) return 0;
        var rejected = result.Rooms.Where(room => rejectedIds.Contains(room.Id)).ToList();
        result.Rooms.RemoveAll(room => rejectedIds.Contains(room.Id));
        MoveToRejectedResidue(result, rejected);
        result.TotalSqft = result.Rooms.Sum(room => room.RawSqft);
        log?.Invoke($"[promotion] rejected {rejected.Count} evidence-misaligned room(s): " +
                    string.Join(" ", survivingRails.Select(rail =>
                        $"{rail.RoomId}:{rail.BestOffsetFt:+0.000;-0.000}ft")));
        return rejected.Count;
    }

    private static LevelTakeoff ToLevel(TakeoffResult result, IReadOnlyList<RoomResult> rooms) =>
        new(result.LevelName, result.LevelElevation, rooms.Select(room => new TakeoffRoomShape(
            room.Id, room.RawSqft, room.PerimeterFt, room.MeanCeilingFt,
            room.Polygon, room.Holes) { Label = [room.LabelX, room.LabelY] }).ToList());

    private static Polygon ToPolygon(RoomResult room) =>
        TakeoffGeometry.ToPolygon(room, GeometryFactory);

    private static RoomResult Clone(RoomResult room, Polygon polygon) => new()
    {
        Id = room.Id,
        RawSqft = polygon.Area,
        PerimeterFt = polygon.Length,
        LabelX = room.LabelX,
        LabelY = room.LabelY,
        MeanCeilingFt = room.MeanCeilingFt,
        Polygon = Coordinates(polygon.ExteriorRing, true),
        Holes = Enumerable.Range(0, polygon.NumInteriorRings)
            .Select(index => Coordinates(polygon.GetInteriorRingN(index), false)).ToList(),
        Flags = room.Flags.ToList(),
        SplitFrom = room.SplitFrom,
        MergedFrom = room.MergedFrom,
    };

    private static RoomResult Clone(RoomResult room) => new()
    {
        Id = room.Id,
        RawSqft = room.RawSqft,
        PerimeterFt = room.PerimeterFt,
        LabelX = room.LabelX,
        LabelY = room.LabelY,
        MeanCeilingFt = room.MeanCeilingFt,
        Polygon = room.Polygon.Select(point => new[] { point[0], point[1] }).ToList(),
        Holes = room.Holes.Select(hole => hole
            .Select(point => new[] { point[0], point[1] }).ToList()).ToList(),
        Flags = room.Flags.ToList(),
        SplitFrom = room.SplitFrom,
        MergedFrom = room.MergedFrom,
    };

    private static TakeoffResult Clone(TakeoffResult source) => new()
    {
        LevelName = source.LevelName,
        LevelElevation = source.LevelElevation,
        Source = source.Source,
        Rooms = source.Rooms.Select(room => Clone(room)).ToList(),
        Residues = source.Residues.Select(residue => new ResidueResult {
            Id = residue.Id,
            Reason = residue.Reason,
            RawSqft = residue.RawSqft,
            LabelX = residue.LabelX,
            LabelY = residue.LabelY,
            MeanCeilingFt = residue.MeanCeilingFt,
            Polygon = residue.Polygon.Select(point => new[] { point[0], point[1] }).ToList(),
            Holes = residue.Holes.Select(hole => hole
                .Select(point => new[] { point[0], point[1] }).ToList()).ToList(),
        }).ToList(),
        TotalSqft = source.TotalSqft,
        DomainSqft = source.DomainSqft,
        ClaimedWallSqft = source.ClaimedWallSqft,
        ExcludedResidueSqft = source.ExcludedResidueSqft,
        ProfileProvenance = source.ProfileProvenance,
        LevelFlags = source.LevelFlags.ToList(),
        SeedViewA = source.SeedViewA,
        SeedViewB = source.SeedViewB,
        EvidenceView = source.EvidenceView,
    };

    private static List<double[]> Coordinates(LineString ring, bool counterClockwise)
    {
        var points = ring.Coordinates.Take(ring.NumPoints - 1)
            .Select(point => new[] { point.X, point.Y }).ToList();
        if ((TakeoffGeometry.SignedArea(points) > 0) != counterClockwise) points.Reverse();
        return points;
    }

    private static void MoveToRejectedResidue(
        TakeoffResult result, IEnumerable<RoomResult> rejectedRooms)
    {
        foreach (var room in rejectedRooms)
            result.Residues.Add(new ResidueResult {
                Id = room.Id,
                Reason = ResidueReason.Rejected,
                RawSqft = room.RawSqft,
                LabelX = room.LabelX,
                LabelY = room.LabelY,
                MeanCeilingFt = room.MeanCeilingFt,
                Polygon = room.Polygon,
                Holes = room.Holes,
            });
    }
}
