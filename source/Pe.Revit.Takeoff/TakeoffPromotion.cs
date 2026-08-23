using NetTopologySuite.Geometries;
using NetTopologySuite.Geometries.Utilities;
using NetTopologySuite.Operation.Buffer;
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
    double GapSqft,
    double OverlapSqft,
    double OutsideZoneSqft,
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
    private const double JointClipMaximumUnbackedRunFt = 1.0;
    private static readonly GeometryFactory GeometryFactory = TakeoffGeometry.Factory;

    /// <summary>
    /// The disposition pipeline, in the one order that is load-bearing. Ordering constraints that
    /// used to live only in the reader's head are visible here: <c>triage</c> rejects a missing
    /// raster before anything reads the partition and arms the small-zone fallback;
    /// <c>evidence</c> reads the
    /// post-regularizer partition captured by <c>shared-network</c>; the recombination stages sit
    /// immediately after <c>shared-network</c> and BEFORE <c>frame-projector</c>, because the
    /// lattice cells they exist to absorb are exactly the rooms the projector rejects — running
    /// them later meant they never fired at all (measured: zero events across the 45-zone set);
    /// and <c>disposition</c> restores held post-network candidate geometry before residue rebuild
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
        ("closure-trust", RunClosureTrust),
        ("shared-audit", RunSharedAudit),
        ("editability", RunEditability),
        ("small-zone-fallback", RunSmallZoneFallback),
        ("single-unbacked-fallback", RunSingleUnbackedFallback),
        ("disposition", RunDisposition),
    ];

    /// <summary>
    /// Runs the disposition pipeline over one zone. <c>census</c> is the pre-solve raster census,
    /// supplied by callers that hold the ink raster; omitting it disables triage, so the zone is
    /// solved exactly as every caller did before the seam existed. <c>stageSnapshot</c> receives
    /// defensive copies after shared-network and frame-projector for evaluation artifacts only;
    /// omitting it performs no snapshot work.
    /// </summary>
    public static ZonePromotionResult PromoteZone(
        TakeoffResult source,
        ZoneScope zone,
        TakeoffOptions options,
        Func<double, double, double> distanceToInk,
        Action<string>? log = null,
        ZoneCensus? census = null,
        Func<double, double, double>? distanceToWallInk = null,
        Func<double, double, byte>? heuristicClosureAt = null,
        Action<string, TakeoffResult>? stageSnapshot = null)
    {
        if (source == null) throw new ArgumentNullException(nameof(source));
        if (zone == null) throw new ArgumentNullException(nameof(zone));
        if (options == null) throw new ArgumentNullException(nameof(options));
        if (distanceToInk == null) throw new ArgumentNullException(nameof(distanceToInk));
        var state = new PromotionState(source, zone, options, distanceToInk, log)
            { Census = census, DistanceToWallInk = distanceToWallInk ?? distanceToInk,
                HeuristicClosureAt = heuristicClosureAt };
        var timer = System.Diagnostics.Stopwatch.StartNew();
        long lastMilliseconds = 0;
        foreach (var stage in Stages)
        {
            stage.Run(state);
            long elapsed = timer.ElapsedMilliseconds;
            log?.Invoke(
                $"[promotion] stage={stage.Name} ms={elapsed - lastMilliseconds} total={elapsed}");
            if (stageSnapshot != null
                && stage.Name is "shared-network" or "frame-projector")
                stageSnapshot(stage.Name, Clone(state.Result));
            lastMilliseconds = elapsed;
            // A triage hold IS the disposition: either no raster existed, or a conservative
            // post-solve fallback retained the authoritative whole zone.
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
        // Seed-ink-only oracle for judgments about WALLS (door-heads back edges for trust, but a
        // door is an opening, not a wall). Falls back to the evidence oracle when the caller has
        // no raw-ink oracle to give.
        internal Func<double, double, double> DistanceToWallInk = distanceToInk;
        internal Func<double, double, byte>? HeuristicClosureAt;
        internal readonly Action<string>? Log = log;

        internal readonly TakeoffResult Result = Clone(source);
        internal Geometry ZoneGeometry = null!;      // set by the zone-geometry stage
        internal ZoneCensus? Census;                 // supplied by the caller; null = no triage
        internal ZoneTriageVerdict Triage = ZoneTriageVerdict.Solve;
        internal ZoneTriageVerdict? SmallZoneFallback;

        // The detector's selected partition is the accounting authority. Held review geometry is
        // the post-network candidate; raw raster coverage that it leaves behind stays residue.
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
    /// Missing raster holds immediately. A small-zone verdict instead arms a whole-zone fallback,
    /// allowing a valid partition to win without turning a failed solve into excluded space.
    /// </summary>
    private static void RunTriage(PromotionState state)
    {
        if (state.Census == null) return;
        var verdict = ZoneTriage.Evaluate(state.Census, state.Options);
        if (verdict.Reason == "small-zone")
        {
            state.SmallZoneFallback = verdict;
            return;
        }
        if (!verdict.IsHold) return;
        HoldWhole(state, verdict);
    }

    private static void RunSmallZoneFallback(PromotionState state)
    {
        if (state.SmallZoneFallback == null) return;
        if (state.Result.Rooms.Count == 1)
        {
            var room = state.Result.Rooms[0];
            // net48 (R2023/24) has no Split(char, StringSplitOptions) overload; the char[] one is
            // identical and exists everywhere.
            int mergedSources = room.MergedFrom?
                .Split(new[] { '+' }, StringSplitOptions.RemoveEmptyEntries).Length ?? 0;
            double? support = TakeoffEvidenceFidelity.RoomBoundarySupportFraction(
                room, state.DistanceToInk, state.ZoneGeometry.Boundary,
                state.Options.InkBackedZoneEdgeExemptFt);
            if (mergedSources >= 3 && support == null)
            {
                state.Rejections["small-zone:ambiguous-merge"] = 1;
                state.Log?.Invoke($"[promotion] small-zone whole-boundary room held: " +
                                  $"mergedSources={mergedSources}");
                HoldWhole(state, state.SmallZoneFallback);
                return;
            }
        }
        if (state.Result.Rooms.Count > 0) return;
        HoldWhole(state, state.SmallZoneFallback);
    }

    private static void RunSingleUnbackedFallback(PromotionState state)
    {
        if (state.Result.Rooms.Count > 0 || state.Source.Rooms.Count != 1
            || !state.Rejections.TryGetValue("ink:unbacked", out int rejected) || rejected != 1)
            return;
        HoldWhole(state,
            new ZoneTriageVerdict(ZoneTriageAction.HoldWhole, "single-unbacked-room"));
    }

    private static void HoldWhole(PromotionState state, ZoneTriageVerdict verdict)
    {
        state.Triage = verdict;
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
                          $"inkRatio={state.Census?.InkRatio ?? 0:P0}");
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
        // The naked-separator path may extend candidacy past the closet-scale cap: a big watershed
        // cell in an ink-starved zone is still not a room. The single-neighbor share path keeps the
        // original cap — it never checks ink and must not start bulldozing genuine rooms.
        double candidacyCap = Math.Max(
            state.Options.AbsorbNeighborMaxSqft, state.Options.AbsorbNakedMaxSqft);
        int merged = 0;
        foreach (var room in state.Result.Rooms
                     .Where(item => item.RawSqft < candidacyCap)
                     .OrderBy(item => item.RawSqft).ThenBy(item => item.Id, StringComparer.Ordinal)
                     .ToList())
        {
            if (!state.Result.Rooms.Contains(room)) continue;
            var geometry = ToPolygon(room);
            double perimeter = geometry.Length;
            if (perimeter <= Epsilon) continue;
            var neighbors = Neighbors(state.Result, room, geometry);
            var target = neighbors.Count == 0
                ? ((RoomResult Room, double SharedLength)?)null
                : neighbors.OrderByDescending(item => item.SharedLength)
                    .ThenBy(item => item.Room.Id, StringComparer.Ordinal).First();
            double share = target == null ? 0 : target.Value.SharedLength / perimeter;
            bool absorb = target != null
                          && room.RawSqft < state.Options.AbsorbNeighborMaxSqft
                          && share >= state.Options.AbsorbNeighborSharedPerimeterFraction;
            // A lattice cell can hand its perimeter to SEVERAL neighbors, each below the
            // single-neighbor bar. Split share alone is not enough — a genuine closet is also
            // mostly surrounded — so this path additionally requires the separating boundary to
            // stand on nothing: no ink, no door-scale door-head. An unbacked separator is a
            // watershed line, not a wall (kaitpw, round 2: LL09's sliver).
            double totalShare = perimeter <= Epsilon
                ? 0 : neighbors.Sum(item => item.SharedLength) / perimeter;
            double naked = neighbors.Count == 0
                ? double.NaN
                : SeparatorNakedFraction(geometry, neighbors, state.DistanceToWallInk);
            if (!absorb && target != null
                && state.Options.AbsorbNakedSeparatorFraction > 0
                && totalShare >= state.Options.AbsorbNeighborSharedPerimeterFraction)
                absorb = naked >= state.Options.AbsorbNakedSeparatorFraction;
            state.Log?.Invoke($"[promotion] absorb candidate={room.Id} sqft={room.RawSqft:F0} " +
                              $"share={share:P0} total={totalShare:P0} naked={naked:F2} " +
                              $"target={target?.Room.Id ?? "none"}");
            if (!absorb || target == null) continue;
            if (TryMerge(state.Result, room, target.Value.Room, requireStrictEditability: false))
                merged++;
        }
        Settle(state, "absorb:merged", merged);
    }

    /// <summary>
    /// Fraction of a room's neighbor-shared boundary samples standing on NO wall ink within the
    /// backing hit distance. Sampling mirrors <see cref="TakeoffEvidenceFidelity"/>: 0.25 ft step
    /// per shared component, 0.25 ft hit. The oracle is the WALL-ink oracle (seed ink only) — a
    /// door-head backs an edge for trust, but a door is an opening, not a wall, so it cannot make
    /// a watershed line into a room separator.
    /// </summary>
    private static double SeparatorNakedFraction(
        Polygon geometry,
        List<(RoomResult Room, double SharedLength)> neighbors,
        Func<double, double, double> distanceToInk)
    {
        const double SampleStepFt = 0.25;
        const double HitFt = 0.25;
        int naked = 0, sampled = 0;
        foreach (var neighbor in neighbors)
        {
            var shared = ToPolygon(neighbor.Room).Boundary.Intersection(geometry.Boundary);
            foreach (var component in LineComponents(shared))
            {
                var coords = component.Coordinates;
                for (int i = 0; i + 1 < coords.Length; i++)
                {
                    double dx = coords[i + 1].X - coords[i].X;
                    double dy = coords[i + 1].Y - coords[i].Y;
                    double length = Math.Sqrt(dx * dx + dy * dy);
                    if (length <= Epsilon) continue;
                    int count = Math.Max(2, (int)Math.Ceiling(length / SampleStepFt) + 1);
                    for (int index = 0; index < count; index++)
                    {
                        double t = (double)index / (count - 1);
                        if (distanceToInk(coords[i].X + t * dx, coords[i].Y + t * dy)
                            > HitFt + Epsilon) naked++;
                        sampled++;
                    }
                }
            }
        }
        return sampled == 0 ? 0 : (double)naked / sampled;
    }

    private static IEnumerable<LineString> LineComponents(Geometry geometry)
    {
        if (geometry is LineString line) { yield return line; yield break; }
        if (geometry is GeometryCollection collection)
            foreach (var item in collection.Geometries)
            foreach (var component in LineComponents(item))
                yield return component;
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
        int detached = DetachNarrowNecks(
            state.Result, state.Options.FrameDeStaircaseFt,
            state.Options.MinimumPromotedRoomSqft, state.Log);
        if (detached > 0) state.Rejections["frame:neck-detached"] = detached;
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
        int snapped = 0, clipped = 0, jointClipped = 0, fellBack = 0, squared = 0, dissolved = 0;
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
            (Polygon Fitted, List<Polygon> Dropped, bool DidSnap, bool DidClip, bool DidSquare,
                bool DidDissolve)? Attempt(bool withSnap)
            {
                var fitted = original;
                bool didSnap = false, didClip = false, didSquare = false, didDissolve = false;
                if (withSnap && snapping
                    && SnapToZone(fitted, zoneBoundary, neighbors, state.Options.ZoneSnapFt,
                        // Where a wall hugs the declared line, the ink face is where the room
                        // ends, and a snap may not sweep the boundary back across it. The zone
                        // stays authority — the room simply never reached it (kaitpw, round-2
                        // summon: zone edges often clip walls).
                        state.DistanceToInk,
                        1.2 * state.Options.CellFt)
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
                if ((didSnap || didClip) && state.Options.ZoneClipSquareFt > 0
                    && RepairFitArtifacts(fitted, state.ZoneGeometry, neighbors,
                        state.Options.ZoneClipSquareFt, didClip) is { } repair)
                {
                    fitted = repair.Polygon;
                    didSquare = repair.Squared;
                    didDissolve = repair.Dissolved;
                }
                return didSnap || didClip
                    ? (fitted, dropped, didSnap, didClip, didSquare, didDissolve)
                    : null;
            }

            var attempts = new List<(Polygon Fitted, List<Polygon> Dropped, bool DidSnap,
                bool DidClip, bool DidSquare, bool DidDissolve)>();
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
                if (!Fits(state, candidate, attempt.Fitted, original, neighbors,
                        out var coverageRooms))
                {
                    if (attempt.DidClip && TryJointClip(state, candidate, attempt.Dropped,
                            coverageRooms, out int jointlyClipped))
                    {
                        clipped += jointlyClipped;
                        jointClipped += jointlyClipped;
                        committed = true;
                        break;
                    }
                    continue;
                }

                state.Result.Rooms[index] = candidate;
                foreach (var part in attempt.Dropped)
                    AddResidues(state.Result.Residues, $"{room.Id}~zonefit",
                        ResidueReason.Rejected, part, room.MeanCeilingFt);
                if (attempt.DidSnap) snapped++;
                if (attempt.DidClip) clipped++;
                if (attempt.DidSquare) squared++;
                if (attempt.DidDissolve) dissolved++;
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
        if (jointClipped > 0) state.Rejections["zonefit:joint-clipped"] = jointClipped;
        if (squared > 0) state.Rejections["zonefit:squared"] = squared;
        if (dissolved > 0) state.Rejections["zonefit:dissolved"] = dissolved;
        if (fellBack > 0) state.Rejections["zonefit:fallback"] = fellBack;
        state.Result.TotalSqft = state.Result.Rooms.Sum(item => item.RawSqft);
    }

    /// <summary>
    /// The zone-fit admission test: every law an accepted room already answers to, re-asked of the
    /// fitted geometry. A false here means the pre-fit room stands, unmodified.
    /// </summary>
    private static bool Fits(
        PromotionState state, RoomResult candidate, Polygon fitted, Polygon original,
        List<(string Id, Polygon Geometry)> neighbors,
        out IReadOnlyList<string> coverageRooms)
    {
        coverageRooms = [];
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
        coverageRooms = audit.CoverageViolations.Select(violation => violation.RoomId)
            .Distinct(StringComparer.Ordinal).OrderBy(id => id, StringComparer.Ordinal).ToList();
        var kinds = audit.Rooms.Where(room => !room.IsStrictlyEditable)
            .SelectMany(room => room.Violations.Select(violation => $"{room.RoomId}:{violation.Kind}"))
            .Distinct().Take(6);
        // The fitted room's own violations carry their coordinates and magnitudes: a fallback
        // hold that names where and how much is minable; a bare kind list is a dead end.
        var where = audit.Rooms.Where(room => room.RoomId == candidate.Id)
            .SelectMany(room => room.Violations.Select(violation =>
                $"{violation.Kind}@({violation.At.X:F2},{violation.At.Y:F2})m={violation.Measured:F2}"))
            .Take(8);
        Refuse($"editability {string.Join(",", kinds)} [{string.Join(" ", where)}]");
        return false;
    }

    /// <summary>
    /// A one-room zone clip can invalidate a shared coverage only because its named partners still
    /// carry the uncut side of the same edge. Retry that exact, bounded component as one motion;
    /// every ordinary admission law still judges the complete partition before anything commits.
    /// </summary>
    private static bool TryJointClip(
        PromotionState state, RoomResult firstCandidate, IReadOnlyList<Polygon> firstDropped,
        IReadOnlyList<string> coverageRooms, out int clipped)
    {
        clipped = 0;
        if (coverageRooms.Count is < 2 or > 3 || !coverageRooms.Contains(firstCandidate.Id))
            return false;

        var ids = coverageRooms.ToHashSet(StringComparer.Ordinal);
        var originals = state.Result.Rooms.Where(room => ids.Contains(room.Id))
            .ToDictionary(room => room.Id, StringComparer.Ordinal);
        if (originals.Count != ids.Count) return false;

        var polygons = new Dictionary<string, Polygon>(StringComparer.Ordinal) {
            [firstCandidate.Id] = ToPolygon(firstCandidate),
        };
        var dropped = new Dictionary<string, IReadOnlyList<Polygon>>(StringComparer.Ordinal) {
            [firstCandidate.Id] = firstDropped,
        };
        foreach (var room in originals.Values.Where(room => room.Id != firstCandidate.Id))
        {
            var original = ToPolygon(room);
            var parts = PolygonParts(PolygonIntersection(original, state.ZoneGeometry))
                .Where(part => part.Area > Epsilon)
                .OrderByDescending(part => part.Area)
                .ThenBy(part => part.InteriorPoint.X).ThenBy(part => part.InteriorPoint.Y)
                .ToList();
            if (parts.Count == 0) return false;
            polygons[room.Id] = parts[0];
            dropped[room.Id] = parts.Skip(1).ToList();
        }

        foreach (var id in coverageRooms)
            polygons[id] = RenodeAgainstNeighbors(polygons[id], coverageRooms
                .Where(other => other != id)
                .Select(other => (other, polygons[other])).ToList());

        var replacements = originals.Values.Select(room => {
            var candidate = Clone(room, polygons[room.Id]);
            candidate.Flags = candidate.Flags.Append("zone-fit")
                .Distinct(StringComparer.Ordinal).OrderBy(value => value, StringComparer.Ordinal)
                .ToList();
            return candidate;
        }).ToDictionary(room => room.Id, StringComparer.Ordinal);
        if (replacements.Values.Any(room => ToPolygon(room) is var polygon
                && (!polygon.IsValid || polygon.Area < state.Options.MinimumPromotedRoomSqft
                    || PolygonDifference(polygon, state.ZoneGeometry).Area > Epsilon)))
            return false;

        double worst = TakeoffEvidenceFidelity.WorstUnbackedRunFt(
            replacements[firstCandidate.Id], state.DistanceToInk, state.ZoneGeometry.Boundary,
            state.Options.InkBackedZoneEdgeExemptFt);
        if (worst > JointClipMaximumUnbackedRunFt + Epsilon)
        {
            state.RejectionDetails[$"zonefit/{firstCandidate.Id}"] =
                $"unbacked-run {worst:F2}ft > {JointClipMaximumUnbackedRunFt:F2}ft";
            return false;
        }

        var together = state.Result.Rooms
            // net48 has no 2-arg GetValueOrDefault; TryGetValue is the same thing everywhere.
            .Select(room => replacements.TryGetValue(room.Id, out var swap) ? swap : room).ToList();
        if (!TakeoffEditability.Evaluate(ToLevel(state.Result, together)).IsStrictlyEditable)
            return false;

        foreach (var room in originals.Values)
        foreach (var other in state.Result.Rooms.Where(other => other.Id != room.Id))
        {
            if (Intersection(ToPolygon(room).Boundary, ToPolygon(other).Boundary).Length <= Epsilon)
                continue;
            if (Intersection(ToPolygon(replacements[room.Id]).Boundary,
                    ToPolygon(replacements.TryGetValue(other.Id, out var swapOther) ? swapOther : other)
                        .Boundary).Length
                <= Epsilon)
                return false;
        }

        foreach (var room in replacements.Values)
        {
            int index = state.Result.Rooms.FindIndex(item => item.Id == room.Id);
            state.Result.Rooms[index] = room;
            foreach (var part in dropped[room.Id])
                AddResidues(state.Result.Residues, $"{room.Id}~zonefit",
                    ResidueReason.Rejected, part, room.MeanCeilingFt);
            if (PolygonDifference(ToPolygon(originals[room.Id]), state.ZoneGeometry).Area > Epsilon)
                clipped++;
        }
        state.Log?.Invoke($"[promotion] zone-fit joint clip rooms={string.Join(",", coverageRooms)}");
        return true;
    }

    /// <summary>
    /// Moves every room edge that runs parallel to a zone segment within <paramref name="snapFt"/>
    /// onto that segment's line, and returns null when nothing moved. An edge with an endpoint on a
    /// neighbour's boundary is pinned: it is a shared wall, and the zone has no authority there.
    /// </summary>
    internal static Polygon? SnapToZone(
        Polygon room, Geometry zoneBoundary,
        List<(string Id, Polygon Geometry)> neighbors, double snapFt,
        Func<double, double, double>? distanceToInk = null, double inkTolFt = 0)
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
            var source = ring.Coordinates.Take(ring.NumPoints - 1).Select(p => p.Copy()).ToList();
            var points = source.Select(point => point.Copy()).ToList();
            int count = points.Count;
            for (int i = 0; i < count; i++)
            {
                var a = source[i];
                var b = source[(i + 1) % count];
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
                    // Ink between the edge and its target line means the declared line runs on the
                    // far side of a wall the zone clipped; the room already ends at the wall's
                    // face, and snapping across the ink would swallow the clipped half-wall the
                    // zone-edge ink pull just kept out of the partition. Midpoints of the sweep
                    // sitting on ink refuse the move; everywhere else the zone line stays the
                    // snap target it has always been.
                    if (distanceToInk != null)
                    {
                        bool crossesInk = false;
                        for (double t = 0; t <= 1 && !crossesInk; t += 0.25)
                        {
                            double px = a.X + (b.X - a.X) * t, py = a.Y + (b.Y - a.Y) * t;
                            double offset = offsetA + (offsetB - offsetA) * t;
                            crossesInk = distanceToInk(
                                px - 0.5 * offset * -uy, py - 0.5 * offset * ux) <= inkTolFt;
                        }
                        if (crossesInk) continue;
                    }
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

    /// <summary>
    /// The zone-fit repair composite: squaring first (the unchanged SquareFitArtifacts
    /// discipline), then — only while the canonical audit still refuses the polygon for
    /// handle-scale debris — the projector's de-jog dissolve, rotated into the audit's own frame
    /// and budgeted by the same displacement knob, alternating with re-squaring until the debris
    /// is gone or nothing moves. Squaring decomposes an off-frame cut into frame edges but can
    /// strand micro-step runs and sub-anchor off-frame stubs the audit then refuses (the R2a
    /// residual: repair-debris after squaring); the dissolve is gated on the audit refusing, so
    /// a fit that would already pass ships byte-identical. Containment and neighbor overlap may
    /// not grow past the polygon that entered, and the unmodified admission test in Fits stays
    /// the only judge — a repair that still fails falls back exactly as before.
    /// </summary>
    internal static (Polygon Polygon, bool Squared, bool Dissolved)? RepairFitArtifacts(
        Polygon fitted, Geometry zone, List<(string Id, Polygon Geometry)> neighbors,
        double maxDisplacementFt, bool clipped, Action<string>? trace = null)
    {
        double allowedOutside = PolygonDifference(fitted, zone).Area + Epsilon;
        double allowedOverlap = neighbors
            .Sum(other => PolygonIntersection(fitted, other.Geometry).Area) + Epsilon;
        var current = fitted;
        bool squared = false, dissolved = false;
        if (SquareFitArtifacts(current, zone, neighbors, maxDisplacementFt) is { } first)
        {
            current = first;
            squared = true;
        }
        trace?.Invoke($"sq0={squared}");
        // The dissolve rescues CUT geometry — the debris a clip manufactures and squaring
        // strands. A snap-only fit that cannot pass the audit loses nothing by falling back
        // (the room was never forced to change), and repairing it would supplant already-good
        // shipped geometry with a repaired shape that paid displacement for no need.
        const int maxPasses = 12;
        for (int pass = 0; pass < (clipped ? maxPasses : 0); pass++)
        {
            if (FitDebrisFrame(current, trace) is not { } frameRadians) break;
            var before = current;
            bool moved = false;
            if (DeJogFit(current, frameRadians, maxDisplacementFt,
                    zone, neighbors, allowedOutside, allowedOverlap) is { } dejogged)
            {
                current = dejogged;
                moved = true;
            }
            bool jogged = moved;
            if (SquareDebrisRuns(current, zone, neighbors, maxDisplacementFt,
                    allowedOutside, allowedOverlap, pass == 0 ? trace : null) is { } collapsed)
            {
                current = collapsed;
                moved = true;
            }
            trace?.Invoke($"p{pass}:dejog={jogged},runs={moved && true},moved={moved}");
            if (!moved) break;
            dissolved = true;
            if (SquareFitArtifacts(current, zone, neighbors, maxDisplacementFt) is { } resquared)
            {
                current = resquared;
                squared = true;
            }
            // Fixpoint guard: a repair the resquarer immediately undoes is churn, not progress.
            if (current.EqualsExact(before)) break;
        }
        if (dissolved)
        {
            // The canonical coverage contract demands vertex-matched shared linework: a repair
            // that dropped vertices a neighbor still holds on our boundary would die at
            // InvalidCoverage even though the SHAPES agree. Re-absorbing those vertices changes
            // segmentation, never geometry — the one-sided half of the projector's RenodeShared.
            current = RenodeAgainstNeighbors(current, neighbors);
        }
        return squared || dissolved ? (current, squared, dissolved) : null;
    }

    /// <summary>
    /// Inserts every neighbor boundary vertex that lies on this polygon's edges into its rings.
    /// Segmentation-only: the shape is unchanged, but the coverage validator's vertex-matching
    /// contract is restored after a repair simplified an edge a neighbor still holds points on.
    /// </summary>
    private static Polygon RenodeAgainstNeighbors(
        Polygon polygon, List<(string Id, Polygon Geometry)> neighbors)
    {
        var vertices = neighbors.SelectMany(other => other.Geometry.Coordinates)
            .GroupBy(coordinate => (coordinate.X, coordinate.Y))
            .Select(group => group.First())
            .ToList();
        if (vertices.Count == 0) return polygon;
        LinearRing Renode(LineString ring)
        {
            var coordinates = ring.Coordinates;
            var output = new List<Coordinate>();
            for (int i = 0; i < coordinates.Length - 1; i++)
            {
                var from = coordinates[i];
                var to = coordinates[i + 1];
                output.Add(from);
                var segment = new NetTopologySuite.Geometries.LineSegment(from, to);
                output.AddRange(vertices
                    .Where(vertex => !vertex.Equals2D(from) && !vertex.Equals2D(to)
                        && segment.Distance(vertex) <= 1e-9)
                    .Select(vertex => new { vertex, t = segment.ProjectionFactor(vertex) })
                    .Where(item => item.t > 0 && item.t < 1)
                    .OrderBy(item => item.t)
                    .Select(item => new Coordinate(item.vertex.X, item.vertex.Y)));
            }
            output.Add(coordinates[^1]);
            return GeometryFactory.CreateLinearRing(output.ToArray());
        }
        try
        {
            return GeometryFactory.CreatePolygon(
                Renode(polygon.ExteriorRing),
                Enumerable.Range(0, polygon.NumInteriorRings)
                    .Select(index => Renode(polygon.GetInteriorRingN(index))).ToArray());
        }
        catch
        {
            return polygon;
        }
    }

    /// <summary>
    /// Audits the candidate alone and returns its frame angle (radians) when every violation is
    /// repairable handle-scale debris — off-frame edges, the corners they break, micro-step runs,
    /// and short-turn detail. Null means either nothing to repair (a clean polygon must ship
    /// untouched) or the refusal is structural (invalid loop, no coherent frame) and no jog
    /// dissolution may speak for it. Coverage violations never appear in a single-room audit,
    /// which is correct: shared-linework disagreements belong to Fits, not to the repair.
    /// </summary>
    private static double? FitDebrisFrame(Polygon polygon, Action<string>? trace = null)
    {
        var level = new LevelTakeoff("zonefit-repair", 0, [
            new TakeoffRoomShape("fit", polygon.Area, polygon.Length, 0,
                Coordinates(polygon.ExteriorRing, true),
                Enumerable.Range(0, polygon.NumInteriorRings)
                    .Select(index => Coordinates(polygon.GetInteriorRingN(index), false))
                    .ToList()),
        ]);
        var audit = TakeoffEditability.Evaluate(level).Rooms[0];
        if (audit.Violations.Count == 0)
        {
            trace?.Invoke("gate:clean");
            return null;
        }
        var repairable = new[]
        {
            EditabilityViolationKind.OffFrameEdge,
            EditabilityViolationKind.NonRightCorner,
            EditabilityViolationKind.AcuteTip,
            EditabilityViolationKind.DiagonalShortcut,
            EditabilityViolationKind.MicroStepRun,
            EditabilityViolationKind.ExcessiveDetail,
        };
        if (!audit.Violations.All(violation => repairable.Contains(violation.Kind)))
        {
            trace?.Invoke("gate:structural:" + string.Join("|",
                audit.Violations.Select(violation => violation.Kind.ToString()).Distinct()));
            return null;
        }
        trace?.Invoke($"gate:open:f={audit.FrameDegrees:F2}:" + string.Join("|",
            audit.Violations.Select(violation => violation.Kind.ToString()).Distinct()));
        return audit.FrameDegrees * Math.PI / 180;
    }

    /// <summary>
    /// One de-jog dissolve in the audit's frame: rotate local, run the projector's DeJog under
    /// the zone-fit displacement budget, rotate back, and pin every vertex the dissolve did not
    /// move back onto its exact pre-rotation coordinate so shared linework stays vertex-matched
    /// through the rotation round-trip. Zone-fit may not edit a neighbor, so the dissolve is
    /// fenced to free boundary: a jog touching any neighbor's linework is left standing (the
    /// projector straightens such walls by carving both sides — a move zone-fit's laws forbid),
    /// and a candidate that still loses a shared edge is refused here rather than shipped to
    /// die at the admission test. Containment and neighbor overlap may not grow beyond the
    /// allowance of the polygon that entered the repair.
    /// </summary>
    private static Polygon? DeJogFit(
        Polygon polygon, double frameRadians, double stepFt, Geometry zone,
        List<(string Id, Polygon Geometry)> neighbors,
        double allowedOutside, double allowedOverlap)
    {
        const double sharedLineworkFt = 1e-6;
        var toLocal = AffineTransformation.RotationInstance(-frameRadians);
        var local = toLocal.Transform(polygon);
        var neighborLinework = neighbors
            .Select(other => toLocal.Transform(other.Geometry.Boundary)).ToList();
        bool JogMovable(Coordinate point)
        {
            var probe = GeometryFactory.CreatePoint(point);
            return neighborLinework.All(line => line.Distance(probe) > sharedLineworkFt);
        }
        if (FrameLocalProjector.DeJog(local, stepFt, JogMovable) is not { } dejogged) return null;
        if (AffineTransformation.RotationInstance(frameRadians).Transform(dejogged)
                is not Polygon candidate || !candidate.IsValid || candidate.Area <= Epsilon)
            return null;
        candidate = PinUnmovedVertices(candidate, polygon);
        if (!candidate.IsValid || candidate.Area <= Epsilon) return null;
        if (candidate.EqualsExact(polygon)) return null;
        if (PolygonDifference(candidate, zone).Area > allowedOutside) return null;
        if (neighbors.Sum(other => PolygonIntersection(candidate, other.Geometry).Area)
            > allowedOverlap) return null;
        foreach (var other in neighbors)
        {
            if (Intersection(polygon.Boundary, other.Geometry.Boundary).Length <= Epsilon)
                continue;
            if (Intersection(candidate.Boundary, other.Geometry.Boundary).Length <= Epsilon)
                return null;
        }
        return candidate;
    }

    /// <summary>
    /// Collapses a maximal run of sub-anchor debris edges into its own axis decomposition. The
    /// single-edge squarer needs an anchor-scale adjacent edge to speak for the frame, so a CHAIN
    /// of handle-scale edges — which squaring itself manufactures when it decomposes a cut one
    /// edge at a time — is unrepairable by it: no member of the chain ever has an anchor
    /// neighbor. Here the whole run (every edge under anchor scale, flanked by anchor-scale
    /// edges on both sides) is replaced at once: by the straight flank-axis chord when the chord
    /// lies on the frame, else by two frame edges through one corner. The run must contain at
    /// least one off-frame edge — rooms enter zone-fit audit-clean, so an off-frame member is
    /// the provenance marker of fit debris, and a lawful lattice notch (all on-frame) is never
    /// touched. The budget is displacement: no erased vertex may sit farther than
    /// <paramref name="maxDisplacementFt"/> from the replacement path, and an inserted corner
    /// pays the same price against the chain it replaces. Containment and neighbor overlap may
    /// not grow, reversals are refused, and the unmodified admission test stays the only judge.
    /// </summary>
    internal static Polygon? SquareDebrisRuns(
        Polygon fitted, Geometry zone, List<(string Id, Polygon Geometry)> neighbors,
        double maxDisplacementFt, double allowedOutside, double allowedOverlap,
        Action<string>? trace = null)
    {
        const double angleTolerance = TakeoffEditability.AngleTolerance;
        const double anchorMinFt = TakeoffEditability.FrameAnchorMinFt;
        const int maxRepairs = 16;
        var current = fitted;
        bool changed = false;
        for (int repair = 0; repair < maxRepairs; repair++)
        {
            var next = CollapseOne(current);
            if (next == null) break;
            current = next;
            changed = true;
        }
        return changed ? current : null;

        Polygon? CollapseOne(Polygon polygon)
        {
            var rings = new List<LineString> { polygon.ExteriorRing };
            rings.AddRange(Enumerable.Range(0, polygon.NumInteriorRings)
                .Select(polygon.GetInteriorRingN));
            for (int ringIndex = 0; ringIndex < rings.Count; ringIndex++)
            {
                var points = rings[ringIndex].Coordinates
                    .Take(rings[ringIndex].NumPoints - 1).ToList();
                int count = points.Count;
                if (count < 5) continue;
                double Length(int edge)
                {
                    var from = points[edge % count];
                    var to = points[(edge + 1) % count];
                    return from.Distance(to);
                }
                for (int start = 0; start < count; start++)
                {
                    if (Length(start + count - 1) < anchorMinFt) continue;   // left flank
                    if (Length(start) >= anchorMinFt) continue;              // run starts short
                    int length = 0;
                    while (length < count && Length(start + length) < anchorMinFt) length++;
                    if (length >= count - 2) continue;                       // ring is all debris
                    var flankStart = points[(start + count - 1) % count];
                    var a = points[start];
                    var b = points[(start + length) % count];
                    var flankEnd = points[(start + length + 1) % count];
                    var interior = Enumerable.Range(1, length - 1)
                        .Select(offset => points[(start + offset) % count]).ToList();
                    if (interior.Count == 0) continue;                       // single edges: SquareOne's job

                    // Flank axis from the longer flank edge.
                    double lx = a.X - flankStart.X, ly = a.Y - flankStart.Y;
                    double rx = flankEnd.X - b.X, ry = flankEnd.Y - b.Y;
                    double left = Math.Sqrt(lx * lx + ly * ly);
                    double right = Math.Sqrt(rx * rx + ry * ry);
                    double ux, uy;
                    if (left >= right) { ux = lx / left; uy = ly / left; }
                    else { ux = rx / right; uy = ry / right; }
                    double axisAngle = Math.Atan2(uy, ux);
                    bool OffFrame(Coordinate from, Coordinate to)
                    {
                        double difference = Math.Abs(
                            Math.Atan2(to.Y - from.Y, to.X - from.X) - axisAngle) % (Math.PI / 2);
                        difference = Math.Min(difference, Math.PI / 2 - difference);
                        return difference > angleTolerance;
                    }
                    bool hasOffFrame = false;
                    var chain = new List<Coordinate> { a };
                    chain.AddRange(interior);
                    chain.Add(b);
                    for (int edge = 0; edge < chain.Count - 1 && !hasOffFrame; edge++)
                        hasOffFrame = OffFrame(chain[edge], chain[edge + 1]);
                    if (!hasOffFrame) continue;
                    trace?.Invoke($"run@({a.X:F1},{a.Y:F1})n={length}");

                    // A run of short edges can span a GENUINE frame corner (an L in the cut):
                    // collapsing across it would erase real shape for the run's full rise. Split
                    // the chain at every lawful frame vertex — both adjacent edges on-frame —
                    // and repair each debris fragment on its own.
                    var splits = new List<int> { 0 };
                    for (int vertex = 1; vertex < chain.Count - 1; vertex++)
                        if (!OffFrame(chain[vertex - 1], chain[vertex])
                            && !OffFrame(chain[vertex], chain[vertex + 1]))
                            splits.Add(vertex);
                    splits.Add(chain.Count - 1);

                    for (int fragment = 0; fragment < splits.Count - 1; fragment++)
                    {
                        int f0 = splits[fragment], f1 = splits[fragment + 1];
                        if (f1 <= f0) continue;
                        var fa = chain[f0];
                        var fb = chain[f1];
                        var fInterior = chain.GetRange(f0 + 1, f1 - f0 - 1);
                        var fChain = chain.GetRange(f0, f1 - f0 + 1);
                        bool fragmentOffFrame = false;
                        for (int edge = 0; edge < fChain.Count - 1 && !fragmentOffFrame; edge++)
                            fragmentOffFrame = OffFrame(fChain[edge], fChain[edge + 1]);
                        if (!fragmentOffFrame) continue;
                        var fFlankStart = f0 == 0 ? flankStart : chain[f0 - 1];
                        var fFlankEnd = f1 == chain.Count - 1 ? flankEnd : chain[f1 + 1];

                        // Chord decomposition on the flank frame, perpendicular-preferring like
                        // the single-edge squarer.
                        double ex = fb.X - fa.X, ey = fb.Y - fa.Y;
                        if (Math.Sqrt(ex * ex + ey * ey) <= Epsilon) continue;
                        double vx = ux, vy = uy;
                        if (Math.Abs(-ex * vy + ey * vx) > Math.Abs(ex * vx + ey * vy))
                            (vx, vy) = (-vy, vx);
                        double along = ex * vx + ey * vy;
                        double px = ex - along * vx, py = ey - along * vy;
                        double perpendicular = Math.Sqrt(px * px + py * py);

                        var replacements = new List<List<Coordinate>>();
                        if (perpendicular <= Epsilon || !OffFrame(fa, fb))
                            replacements.Add([]);                            // straight chord
                        else if (Math.Abs(along) > Epsilon)
                        {
                            replacements.Add([new Coordinate(fa.X + along * vx, fa.Y + along * vy)]);
                            replacements.Add([new Coordinate(fa.X + px, fa.Y + py)]);
                            // A long shallow cut cannot be one corner (the corner would displace
                            // the boundary by the fragment's full rise); its lawful frame
                            // decomposition is a staircase at HANDLE scale — treads above the
                            // audit's short-turn threshold, risers within the displacement
                            // budget, every corner square. Fewest risers that fit the budget:
                            // the simplest lawful geometry.
                            const double treadMinFt = 2.3;
                            int riserCount = (int)Math.Ceiling(
                                perpendicular / maxDisplacementFt - 1e-9);
                            int riserCap = (int)Math.Floor(Math.Abs(along) / treadMinFt + 1e-9);
                            if (riserCount >= 2 && riserCount <= riserCap)
                            {
                                double sx = along * vx / riserCount, sy = along * vy / riserCount;
                                double qx = px / riserCount, qy = py / riserCount;
                                List<Coordinate> Staircase(bool treadFirst)
                                {
                                    var corners = new List<Coordinate>();
                                    double x = fa.X, y = fa.Y;
                                    for (int step = 0; step < riserCount; step++)
                                    {
                                        if (treadFirst) { x += sx; y += sy; }
                                        else { x += qx; y += qy; }
                                        corners.Add(new Coordinate(x, y));
                                        if (treadFirst) { x += qx; y += qy; }
                                        else { x += sx; y += sy; }
                                        if (step < riserCount - 1)
                                            corners.Add(new Coordinate(x, y));
                                    }
                                    return corners;
                                }
                                replacements.Add(Staircase(treadFirst: true));
                                replacements.Add(Staircase(treadFirst: false));
                            }
                        }
                        Polygon? best = null;
                        foreach (var inserted in replacements)
                        {
                            var path = new List<Coordinate> { fa };
                            path.AddRange(inserted);
                            path.Add(fb);
                            if (path.Count < 3 && fInterior.Count == 0) continue;
                            bool reverses = Reverses(fFlankStart, fa, path[1])
                                || Reverses(path[^2], fb, fFlankEnd);
                            for (int knee = 1; knee < path.Count - 1 && !reverses; knee++)
                                reverses = Reverses(path[knee - 1], path[knee], path[knee + 1]);
                            if (reverses) { trace?.Invoke("x:rev"); continue; }
                            double displacement = fInterior.Count == 0 ? 0 : fInterior
                                .Max(vertex => DistanceToPath(vertex, path));
                            foreach (var corner in inserted)
                                displacement = Math.Max(
                                    displacement, DistanceToPath(corner, fChain));
                            if (displacement > maxDisplacementFt)
                                { trace?.Invoke($"x:disp={displacement:F2}"); continue; }
                            // Rebuild the open ring: the kept stretch of the ring, in order,
                            // with the replacement path spliced between fa and fb.
                            var repairedPoints = SpliceRun(
                                points, (start + f0) % count, f1 - f0, inserted);
                            var candidate = RebuildRing(polygon, ringIndex, repairedPoints);
                            if (candidate == null || !candidate.IsValid
                                || candidate.Area <= Epsilon)
                                { trace?.Invoke("x:invalid"); continue; }
                            if (PolygonDifference(candidate, zone).Area > allowedOutside)
                                { trace?.Invoke($"x:out={PolygonDifference(candidate, zone).Area:F3}"); continue; }
                            if (neighbors.Sum(other =>
                                    PolygonIntersection(candidate, other.Geometry).Area)
                                > allowedOverlap) { trace?.Invoke("x:ovl"); continue; }
                            if (best == null || candidate.Area > best.Area) best = candidate;
                        }
                        if (best != null) return best;
                    }
                }
            }
            return null;
        }

        static bool Reverses(Coordinate a, Coordinate b, Coordinate c)
        {
            double ix = b.X - a.X, iy = b.Y - a.Y, ox = c.X - b.X, oy = c.Y - b.Y;
            double cross = Math.Abs(ix * oy - iy * ox);
            double dot = ix * ox + iy * oy;
            return dot < 0 && cross <= Math.Sin(angleTolerance)
                * Math.Sqrt(ix * ix + iy * iy) * Math.Sqrt(ox * ox + oy * oy);
        }

        static double DistanceToPath(Coordinate point, IReadOnlyList<Coordinate> path)
        {
            double distance = double.MaxValue;
            for (int i = 0; i < path.Count - 1; i++)
                distance = Math.Min(distance, new NetTopologySuite.Geometries.LineSegment(
                    path[i], path[i + 1]).Distance(point));
            return distance;
        }

        static List<Coordinate> SpliceRun(
            List<Coordinate> points, int start, int length, List<Coordinate> inserted)
        {
            int count = points.Count;
            var result = new List<Coordinate>();
            // Walk the ring once starting just after the run, so the kept stretch is contiguous:
            // b, flank..., flankStart, a, then the inserted corner(s).
            for (int step = start + length; step <= start + count; step++)
            {
                if (step == start + count) break;
                result.Add(points[step % count]);
            }
            result.Add(points[start % count]);
            result.AddRange(inserted);
            return result;
        }

        static Polygon? RebuildRing(Polygon polygon, int ringIndex, List<Coordinate> openRing)
        {
            try
            {
                var closed = openRing.Select(point => point.Copy()).ToList();
                closed.Add(closed[0].Copy());
                var replacement = GeometryFactory.CreateLinearRing(closed.ToArray());
                var exterior = ringIndex == 0
                    ? replacement
                    : (LinearRing)polygon.ExteriorRing.Copy();
                var holes = Enumerable.Range(0, polygon.NumInteriorRings)
                    .Select(index => index == ringIndex - 1
                        ? replacement
                        : (LinearRing)polygon.GetInteriorRingN(index).Copy())
                    .ToArray();
                return GeometryFactory.CreatePolygon(exterior, holes);
            }
            catch
            {
                return null;
            }
        }
    }

    /// <summary>
    /// Restores exact pre-rotation coordinates for vertices the dissolve did not move. The
    /// rotation round-trip perturbs every coordinate by floating-point dust (~1e-13 ft at model
    /// scale), which is enough to unmatch shared linework the coverage validator demands be
    /// vertex-exact; a genuinely moved vertex sits at least the jog step (>1e-6 ft) from any
    /// original and is never pinned.
    /// </summary>
    private static Polygon PinUnmovedVertices(Polygon candidate, Polygon original)
    {
        const double pinTolerance = 1e-9;
        var originals = original.Coordinates;
        Coordinate Pin(Coordinate point)
        {
            foreach (var source in originals)
                if (Math.Abs(source.X - point.X) <= pinTolerance
                    && Math.Abs(source.Y - point.Y) <= pinTolerance)
                    return new Coordinate(source.X, source.Y);
            return new Coordinate(point.X, point.Y);
        }
        LinearRing PinRing(LineString ring) =>
            GeometryFactory.CreateLinearRing(ring.Coordinates.Select(Pin).ToArray());
        return GeometryFactory.CreatePolygon(
            PinRing(candidate.ExteriorRing),
            Enumerable.Range(0, candidate.NumInteriorRings)
                .Select(index => PinRing(candidate.GetInteriorRingN(index))).ToArray());
    }

    /// <summary>
    /// Squares clip/snap-manufactured off-frame edges so the strict audit judges the geometry the
    /// fit MEANT instead of the arithmetic debris the cut left behind. Returns null when nothing
    /// needed repair. Every room entering zone-fit already passed the canonical editability audit,
    /// so an off-frame edge in the fitted polygon is fit output by construction — the cut of a
    /// zone segment across a rail corner, or a zone line a fraction of a degree off the rails —
    /// never detector-proposed geometry. The repair replaces such an edge with its own axis
    /// decomposition along an anchor-scale adjacent edge: two frame-aligned edges through
    /// whichever corner point keeps the room inside the zone (preferring the larger room when
    /// both do). The budget is the boundary DISPLACEMENT the repair introduces — the edge's
    /// perpendicular deviation from the axis — so a long zone cut a hair off frame is repairable
    /// while a genuine corner chamfer is not. Nothing is exempted downstream: the full strict
    /// audit, containment, neighbor-overlap, and shared-edge laws all re-judge the squared
    /// polygon, and a repair that still fails falls back exactly as an unrepaired one would.
    /// </summary>
    internal static Polygon? SquareFitArtifacts(
        Polygon fitted, Geometry zone, List<(string Id, Polygon Geometry)> neighbors,
        double maxDisplacementFt)
    {
        // The audit's own frame tolerance: an edge this close to its neighbour's axis (mod 90) is
        // already lawful and must not be touched. The anchor floor is the audit's own: only an
        // edge long enough to speak for the frame may define the axis.
        const double angleTolerance = TakeoffEditability.AngleTolerance;
        const double anchorMinFt = TakeoffEditability.FrameAnchorMinFt;
        const int maxRepairs = 16;
        double allowedOutside = PolygonDifference(fitted, zone).Area + Epsilon;
        double allowedOverlap = neighbors
            .Sum(other => PolygonIntersection(fitted, other.Geometry).Area) + Epsilon;
        var current = fitted;
        bool changed = false;
        for (int repair = 0; repair < maxRepairs; repair++)
        {
            var next = SquareOne(current);
            if (next == null) break;
            current = next;
            changed = true;
        }
        return changed ? current : null;

        Polygon? SquareOne(Polygon polygon)
        {
            var rings = new List<LineString> { polygon.ExteriorRing };
            rings.AddRange(Enumerable.Range(0, polygon.NumInteriorRings)
                .Select(polygon.GetInteriorRingN));
            for (int ringIndex = 0; ringIndex < rings.Count; ringIndex++)
            {
                var points = rings[ringIndex].Coordinates
                    .Take(rings[ringIndex].NumPoints - 1).ToList();
                int count = points.Count;
                if (count < 4) continue;
                for (int i = 0; i < count; i++)
                {
                    var a = points[i];
                    var b = points[(i + 1) % count];
                    double ex = b.X - a.X, ey = b.Y - a.Y;
                    double edgeLength = Math.Sqrt(ex * ex + ey * ey);
                    if (edgeLength <= Epsilon) continue;

                    // The axis is defined by the longer adjacent edge — a repair needs at least one
                    // anchor-scale neighbour to speak for the frame.
                    var previous = points[(i + count - 1) % count];
                    var following = points[(i + 2) % count];
                    double ix = a.X - previous.X, iy = a.Y - previous.Y;
                    double ox = following.X - b.X, oy = following.Y - b.Y;
                    double incoming = Math.Sqrt(ix * ix + iy * iy);
                    double outgoing = Math.Sqrt(ox * ox + oy * oy);
                    if (Math.Max(incoming, outgoing) < anchorMinFt) continue;
                    double ux, uy;
                    if (incoming >= outgoing) { ux = ix / incoming; uy = iy / incoming; }
                    else { ux = ox / outgoing; uy = oy / outgoing; }

                    // Off-frame test, mod 90, on the audit's own tolerance.
                    double difference = Math.Abs(
                        Math.Atan2(ey, ex) - Math.Atan2(uy, ux)) % (Math.PI / 2);
                    difference = Math.Min(difference, Math.PI / 2 - difference);
                    if (difference <= angleTolerance) continue;

                    // Decompose along whichever axis of the anchor's frame leaves the smaller
                    // perpendicular remainder — an edge tilted off the PERPENDICULAR axis squares
                    // onto that axis, not onto the anchor's own direction.
                    if (Math.Abs(-ex * uy + ey * ux) > Math.Abs(ex * ux + ey * uy))
                        (ux, uy) = (-uy, ux);

                    double along = ex * ux + ey * uy;
                    double px = ex - along * ux, py = ey - along * uy;
                    double perpendicular = Math.Sqrt(px * px + py * py);
                    if (Math.Abs(along) <= Epsilon || perpendicular <= Epsilon) continue;
                    // The budget: how far the repair may move the boundary.
                    if (perpendicular > maxDisplacementFt) continue;

                    Polygon? best = null;
                    foreach (var corner in new[]
                             {
                                 new Coordinate(a.X + along * ux, a.Y + along * uy),
                                 new Coordinate(a.X + px, a.Y + py),
                             })
                    {
                        // A repair may not manufacture a reversal: if the path doubles back at
                        // either end of the inserted corner, this candidate is debris of its own.
                        if (Reverses(previous, a, corner) || Reverses(a, corner, b)
                            || Reverses(corner, b, following)) continue;
                        var repairedPoints = points.Take(i + 1)
                            .Append(corner).Concat(points.Skip(i + 1)).ToList();
                        var candidate = Rebuild(polygon, ringIndex, repairedPoints);
                        if (candidate == null || !candidate.IsValid || candidate.Area <= Epsilon)
                            continue;
                        if (PolygonDifference(candidate, zone).Area > allowedOutside) continue;
                        // The outward corner-restore may land on a neighbour; that candidate would
                        // only die at the overlap law later, taking the whole fit with it.
                        if (neighbors.Sum(other =>
                                PolygonIntersection(candidate, other.Geometry).Area) > allowedOverlap)
                            continue;
                        if (best == null || candidate.Area > best.Area) best = candidate;
                    }
                    if (best != null) return best;
                }
            }
            return null;
        }

        static bool Reverses(Coordinate a, Coordinate b, Coordinate c)
        {
            double ix = b.X - a.X, iy = b.Y - a.Y, ox = c.X - b.X, oy = c.Y - b.Y;
            double cross = Math.Abs(ix * oy - iy * ox);
            double dot = ix * ox + iy * oy;
            return dot < 0 && cross <= Math.Sin(angleTolerance)
                * Math.Sqrt(ix * ix + iy * iy) * Math.Sqrt(ox * ox + oy * oy);
        }

        static Polygon? Rebuild(Polygon polygon, int ringIndex, List<Coordinate> openRing)
        {
            try
            {
                var closed = openRing.Select(point => point.Copy()).ToList();
                closed.Add(closed[0].Copy());
                var replacement = GeometryFactory.CreateLinearRing(closed.ToArray());
                var exterior = ringIndex == 0
                    ? replacement
                    : (LinearRing)polygon.ExteriorRing.Copy();
                var holes = Enumerable.Range(0, polygon.NumInteriorRings)
                    .Select(index => index == ringIndex - 1
                        ? replacement
                        : (LinearRing)polygon.GetInteriorRingN(index).Copy())
                    .ToArray();
                return GeometryFactory.CreatePolygon(exterior, holes);
            }
            catch
            {
                return null;
            }
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

    private static void RunClosureTrust(PromotionState state)
    {
        if (state.HeuristicClosureAt == null) return;
        int held = 0;
        foreach (var room in state.Result.Rooms.OrderBy(item => item.Id, StringComparer.Ordinal).ToList())
        {
            var (runs, vertices) = TakeoffEvidenceFidelity.HeuristicClosureComplexity(
                room, state.DistanceToWallInk, state.ZoneGeometry.Boundary,
                state.HeuristicClosureAt, state.Options.CellFt);
            state.Log?.Invoke($"[promotion] closure-trust room={room.Id} runs={runs} vertices={vertices}");
            if (runs <= vertices) continue;
            state.Result.Rooms.Remove(room);
            MoveToRejectedResidue(state.Result, [room]);
            state.RejectionDetails[$"closure/{room.Id}"] =
                $"heuristic closure runs {runs} > polygon vertices {vertices}";
            held++;
        }
        if (held == 0) return;
        state.Rejections["closure:overstitched"] = held;
        state.Result.TotalSqft = state.Result.Rooms.Sum(room => room.RawSqft);
    }

    private static void RunEditability(PromotionState state)
    {
        int rejected = RejectUneditable(state.Result);
        if (rejected > 0) state.Rejections["editability:final"] = rejected;
    }

    private static void RunDisposition(PromotionState state)
    {
        RestoreHeldCandidateGeometry(state.Result, state.EvidencePartition);
        state.HeldRooms = state.Result.Residues
            .Count(residue => residue.Reason == ResidueReason.Rejected);
        int heldComponents = HoldUnclaimedZoneComponents(state);
        state.HeldRooms += heldComponents;
        if (heldComponents > 0)
            state.Rejections["zone-component:held"] = heldComponents;
        RebuildResiduesInsideZone(state.Result, state.ZoneGeometry);
        int filled = FillInteriorResidueGaps(state.Result, state.ZoneGeometry);
        if (filled > 0) state.Rejections["disposition:interior-gap-filled"] = filled;
    }

    /// <summary>
    /// Rejoins an internal Excluded component to an existing non-Excluded owner. Held wins when
    /// several owners qualify. The zone-edge refusal
    /// leaves the exterior narrow band untouched; choosing the longest shared boundary resolves
    /// multi-room junction nuclei without changing any Accepted geometry or inventing a room.
    /// </summary>
    internal static int FillInteriorResidueGaps(TakeoffResult result, Geometry zone)
    {
        var held = result.Residues
            .Where(residue => residue.Reason != ResidueReason.Excluded).ToList();
        var excluded = result.Residues
            .Where(residue => residue.Reason == ResidueReason.Excluded).ToList();
        int filled = 0;
        foreach (var hole in excluded)
        {
            Geometry geometry = ToGeometry(hole);
            double zoneContact = Intersection(geometry.Boundary, zone.Boundary).Length;
            if (geometry is not Polygon polygon || zoneContact > Epsilon)
                continue;
            var owners = held.Select(residue => (residue, geometry: (Polygon)ToGeometry(residue)))
                .Select(item => (item.residue, item.geometry,
                    shared: Intersection(polygon.Boundary, item.geometry.Boundary).Length))
                .Where(item => item.shared > Epsilon)
                .OrderBy(item => item.residue.Reason == ResidueReason.Rejected ? 0 : 1)
                .ThenByDescending(item => item.shared)
                .ThenBy(item => item.residue.Id, StringComparer.Ordinal).ToList();
            Geometry? joined = owners.Count == 0 ? null : OverlayNGRobust.Overlay(
                owners[0].geometry, polygon, SpatialFunction.Union);
            if (joined is not Polygon completed || !completed.IsValid
                || Math.Abs(completed.Area - owners[0].geometry.Area - polygon.Area) > Epsilon)
                continue;

            var owner = owners[0].residue;
            owner.RawSqft = completed.Area;
            owner.Polygon = Coordinates(completed.ExteriorRing, true);
            owner.Holes = Enumerable.Range(0, completed.NumInteriorRings)
                .Select(index => Coordinates(completed.GetInteriorRingN(index), false)).ToList();
            result.Residues.Remove(hole);
            filled++;
        }
        return filled;
    }

    private static int HoldUnclaimedZoneComponents(PromotionState state)
    {
        var claimed = state.Result.Rooms.Select(room => (Geometry)ToPolygon(room))
            .Concat(state.Result.Residues
                .Where(residue => residue.Reason != ResidueReason.Excluded)
                .Select(ToGeometry)).ToList();
        Geometry claimedGeometry = claimed.Count == 0
            ? GeometryFactory.CreatePolygon()
            : Polygonal(OverlayNGRobust.Union(claimed));
        int held = 0;
        foreach (var component in PolygonParts(state.ZoneGeometry))
        {
            if (component.Area < state.Options.MinimumPromotedRoomSqft
                || (!claimedGeometry.IsEmpty
                    && Intersection(component, claimedGeometry).Area > Epsilon))
                continue;
            var label = component.InteriorPoint;
            var candidate = Clone(new RoomResult {
                Id = $"ZONE-COMPONENT-HELD:{held + 1}",
                LabelX = label.X,
                LabelY = label.Y,
            }, component);
            if (!TakeoffEditability.Evaluate(ToLevel(state.Result, [candidate]))
                    .IsStrictlyEditable)
                continue;
            AddResidues(state.Result.Residues, candidate.Id, ResidueReason.Rejected,
                component, 0);
            held++;
        }
        return held;
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
        var legality = MeasureDispositionLegality(result, state.ZoneGeometry);
        bool strict = TakeoffEditability.Evaluate(ToLevel(result, result.Rooms)).IsStrictlyEditable;
        bool contained = legality.OutsideZoneSqft <= Epsilon;
        if (!strict || !contained || closureError > AccountingEpsilonSqft
            || legality.GapSqft > Epsilon || legality.OverlapSqft > Epsilon)
            throw new InvalidOperationException(
                $"zone promotion violated a binding law: strict={strict} contained={contained} " +
                $"closure={closureError:F9}sf gap={legality.GapSqft:F9}sf " +
                $"overlap={legality.OverlapSqft:F9}sf " +
                $"outside={legality.OutsideZoneSqft:F9}sf");
        // The disposition is settled: surviving rooms are accepted, Rejected residues are the held
        // rooms. Marking the result makes ToTsv persist that fact as a ROOM column (SHIMS.md #3).
        result.DispositionsResolved = true;
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
            legality.GapSqft,
            legality.OverlapSqft,
            legality.OutsideZoneSqft,
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

    internal static (double GapSqft, double OverlapSqft, double OutsideZoneSqft)
        MeasureDispositionLegality(TakeoffResult result, Geometry zoneGeometry)
    {
        var dispositions = result.Rooms.Select(room => (Geometry)ToPolygon(room))
            .Concat(result.Residues.Select(ToGeometry)).ToList();
        Geometry union = dispositions.Count == 0
            ? GeometryFactory.CreatePolygon()
            : Polygonal(OverlayNGRobust.Union(dispositions));
        return (
            PolygonDifference(zoneGeometry, union).Area,
            Math.Max(0, dispositions.Sum(geometry => geometry.Area) - union.Area),
            PolygonDifference(union, zoneGeometry).Area);
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

    private static void RestoreHeldCandidateGeometry(
        TakeoffResult result, IReadOnlyList<RoomResult> candidates)
    {
        var candidateById = candidates.ToDictionary(room => room.Id, StringComparer.Ordinal);
        foreach (var residue in result.Residues
                     .Where(item => item.Reason == ResidueReason.Rejected))
        {
            if (!candidateById.TryGetValue(residue.Id, out var candidate)) continue;
            var polygon = ToPolygon(candidate);
            residue.RawSqft = polygon.Area;
            residue.LabelX = candidate.LabelX;
            residue.LabelY = candidate.LabelY;
            residue.MeanCeilingFt = candidate.MeanCeilingFt;
            residue.Polygon = Coordinates(polygon.ExteriorRing, true);
            residue.Holes = Enumerable.Range(0, polygon.NumInteriorRings)
                .Select(index => Coordinates(polygon.GetInteriorRingN(index), false)).ToList();
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

    private const double MinimumDetachedNeckSqft = 10;

    internal static int DetachNarrowNecks(
        TakeoffResult result, double radiusFt, double minimumRoomSqft,
        Action<string>? log = null)
    {
        if (radiusFt <= 0 || minimumRoomSqft <= 0) return 0;
        var buffer = new BufferParameters { JoinStyle = JoinStyle.Mitre };
        static List<double[]> Collapse(List<double[]> points)
        {
            bool changed;
            do
            {
                changed = false;
                for (int index = 0; index < points.Count && points.Count >= 3; index++)
                {
                    var previous = points[(index + points.Count - 1) % points.Count];
                    var current = points[index];
                    var next = points[(index + 1) % points.Count];
                    double ax = current[0] - previous[0], ay = current[1] - previous[1];
                    double bx = next[0] - current[0], by = next[1] - current[1];
                    double lengths = Math.Sqrt(ax * ax + ay * ay) * Math.Sqrt(bx * bx + by * by);
                    if (lengths > Epsilon
                        && Math.Abs(ax * by - ay * bx)
                        > Math.Sin(TakeoffEditability.AngleTolerance) * lengths)
                        continue;
                    points.RemoveAt(index);
                    changed = true;
                    break;
                }
            } while (changed);
            return points;
        }
        int detachedCount = 0;
        foreach (var room in result.Rooms.OrderBy(item => item.Id, StringComparer.Ordinal).ToList())
        {
            var polygon = ToPolygon(room);
            var cores = PolygonParts(polygon.Buffer(-radiusFt, buffer)).ToList();
            if (cores.Count < 2) continue;

            var label = GeometryFactory.CreatePoint(new Coordinate(room.LabelX, room.LabelY));
            var owner = cores.OrderBy(core => core.Distance(label)).First();
            Geometry detached = Polygonal(OverlayNGRobust.Union(cores
                .Where(core => !ReferenceEquals(core, owner))
                .Select(core => core.Buffer(radiusFt, buffer).Intersection(polygon))));
            var mainGeometry = PolygonDifference(polygon, detached).Buffer(0);
            var mainParts = PolygonParts(mainGeometry).ToList();
            var main = mainParts.FirstOrDefault(part => part.IsValid && part.Covers(label));
            if (main != null && mainParts.Count > 1)
                detached = Polygonal(OverlayNGRobust.Union(
                    mainParts.Where(part => !ReferenceEquals(part, main)).Cast<Geometry>()
                        .Prepend(detached)));
            if (detached.Area < MinimumDetachedNeckSqft)
            {
                log?.Invoke($"[promotion] frame-local neck refused room={room.Id} " +
                            $"held={detached.Area:F1}sf < {MinimumDetachedNeckSqft:F1}sf");
                continue;
            }
            if (main == null || !main.IsValid)
            {
                log?.Invoke($"[promotion] frame-local neck refused room={room.Id} " +
                            $"main={mainGeometry.GeometryType}/{mainGeometry.Area:F1}sf " +
                            $"label={mainGeometry.IsValid && mainGeometry.Covers(label)}");
                continue;
            }

            var replacement = Clone(room, main);
            replacement.Polygon = Collapse(replacement.Polygon);
            replacement.Holes = replacement.Holes.Select(Collapse).ToList();
            main = ToPolygon(replacement);
            replacement = Clone(room, main);
            detached = PolygonDifference(polygon, main);
            if (main.Area < minimumRoomSqft || !main.Covers(label)) continue;
            var together = result.Rooms
                .Select(candidate => ReferenceEquals(candidate, room) ? replacement : candidate)
                .ToList();
            var audit = TakeoffEditability.Evaluate(ToLevel(result, together));
            if (!audit.IsStrictlyEditable)
            {
                string violations = string.Join(",", audit.Rooms
                    .Where(item => !item.IsStrictlyEditable)
                    .SelectMany(item => item.Violations.Select(violation =>
                        $"{item.RoomId}:{violation.Kind}:{violation.Measured:F2}")));
                log?.Invoke($"[promotion] frame-local neck refused room={room.Id} " +
                            $"editability={violations}");
                continue;
            }

            result.Rooms[result.Rooms.IndexOf(room)] = replacement;
            AddResidues(result.Residues, $"{room.Id}~neck", ResidueReason.Rejected,
                detached, room.MeanCeilingFt);
            detachedCount++;
            log?.Invoke($"[promotion] frame-local detached neck room={room.Id} " +
                        $"accepted={main.Area:F1}sf held={detached.Area:F1}sf");
        }
        result.TotalSqft = result.Rooms.Sum(room => room.RawSqft);
        return detachedCount;
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

    internal static IReadOnlyList<ZoneDomainHeldCandidate> NormalizeDomainRefloodHeldCandidates(
        IReadOnlyList<ZoneDomainHeldCandidate> candidates,
        TakeoffResult accepted)
    {
        if (candidates.Count == 0) return candidates;
        Geometry acceptedGeometry = accepted.Rooms.Count == 0
            ? GeometryFactory.CreatePolygon()
            : OverlayNGRobust.Union(
                accepted.Rooms.Select(room => (Geometry)ToPolygon(room)));
        var normalized = new List<ZoneDomainHeldCandidate>();
        foreach (var candidate in candidates)
        {
            if (candidate.Polygons.Count == 0) continue;
            var room = new RoomResult {
                Id = candidate.Id,
                RawSqft = candidate.AreaSqft,
                Polygon = candidate.Polygons[0]
                    .Select(point => new[] { point[0], point[1] }).ToList(),
                Holes = candidate.Polygons.Skip(1).Select(hole => hole
                    .Select(point => new[] { point[0], point[1] }).ToList()).ToList(),
            };
            Polygon original;
            try { original = ToPolygon(room); }
            catch (InvalidOperationException) { continue; }
            Geometry remainder = acceptedGeometry.IsEmpty
                || Intersection(original, acceptedGeometry).Area <= Epsilon
                    ? original
                    : PolygonDifference(original, acceptedGeometry);
            if (remainder is not Polygon polygon || polygon.IsEmpty || !polygon.IsValid) continue;
            var clipped = Clone(room, polygon);
            clipped.LabelX = polygon.InteriorPoint.X;
            clipped.LabelY = polygon.InteriorPoint.Y;
            if (!TakeoffEditability.Evaluate(ToLevel(accepted, [clipped])).IsStrictlyEditable)
                continue;
            normalized.Add(new ZoneDomainHeldCandidate(
                candidate.Id, polygon.Area,
                new[] { clipped.Polygon }.Concat(clipped.Holes).ToList()));
        }
        return normalized;
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
