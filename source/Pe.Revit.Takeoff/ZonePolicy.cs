namespace Pe.Revit.Takeoff;

/// <summary>
/// What the detector's raw partition looks like for one zone, before any promotion stage has judged
/// it. Together with <see cref="ZoneCensus"/> this is everything a per-zone policy is allowed to
/// read: both are measurements taken BEFORE the gate chain, so no rule can tune itself on the
/// verdict it is trying to influence.
/// </summary>
public sealed record ZonePartitionStats(
    int RawRooms,
    double MedianRawRoomSqft,
    double RoomsPer1000Sqft)
{
    public static ZonePartitionStats Of(TakeoffResult raw, double zoneSqft)
    {
        if (raw == null) throw new ArgumentNullException(nameof(raw));
        var areas = raw.Rooms.Select(room => room.RawSqft).OrderBy(area => area).ToList();
        double median = areas.Count == 0 ? 0
            : areas.Count % 2 == 1 ? areas[areas.Count / 2]
            : (areas[areas.Count / 2 - 1] + areas[areas.Count / 2]) / 2;
        return new ZonePartitionStats(
            areas.Count,
            median,
            zoneSqft <= 0 ? 0 : areas.Count * 1000.0 / zoneSqft);
    }
}

/// <summary>
/// One zone's effective options plus the deviations that produced them. <see cref="AdaptedKnobs"/>
/// lists ONLY what differs from the run's declared options, so an artifact carrying it stays
/// attributable: the run-level optionsHash says what was asked for, this says what this one zone
/// actually got, and an unadapted zone says nothing at all.
/// </summary>
public sealed record ZonePolicyResult(
    TakeoffOptions Options,
    IReadOnlyDictionary<string, string> AdaptedKnobs);

/// <summary>
/// Per-zone knob adaptation: pure, and inert unless <see cref="TakeoffOptions.AdaptivePolicy"/> is
/// set. It exists because one global value is demonstrably wrong across a mixed building — the
/// 2026-08-14 sweep found absorb 0.30 cracks Lower Level#08 while bulldozing good rooms elsewhere,
/// a net −3 rooms. A knob that helps one zone and hurts another is not a bad constant; it is a
/// constant asked to answer a question that depends on the zone.
/// </summary>
public static class ZonePolicy
{
    /// <summary>
    /// Rule — sparse wall network. <see cref="ZoneCensus.InkRatio"/> is in-zone ink over zone area:
    /// how much of the zone is drawn on at all. Where it is high, the watershed's partition
    /// boundaries are backed by real wall ink, and absorbing a small room into its neighbour
    /// destroys a room the drawing actually asserts. Where it is low the network is too thin to
    /// certify anything, so the partition is mostly invented and the small cells it invents should
    /// merge back. That is exactly the split the measurement shows: across the 25 solved projectA
    /// zones, every zone that GAINS a room under absorb 0.30 sits at ink ratio ≤ 0.056 (Lower 08
    /// 0.036 +2, Lower 09 0.056 +1) and every zone that LOSES one sits at ≥ 0.12 (Upper 03 0.121
    /// −1, Upper 07 0.139 −1, Upper 02 0.151 −2, Attic 01 0.207 −2). The 0.09 threshold sits in
    /// the empty middle; anything in (0.079, 0.097] selects the same zones, and on outcomes alone
    /// the safe interval is wider still — (0.056, 0.121).
    /// </summary>
    public static ZonePolicyResult Adapt(
        ZoneCensus census, ZonePartitionStats stats, TakeoffOptions baseline)
    {
        if (census == null) throw new ArgumentNullException(nameof(census));
        if (stats == null) throw new ArgumentNullException(nameof(stats));
        if (baseline == null) throw new ArgumentNullException(nameof(baseline));
        var none = (IReadOnlyDictionary<string, string>)
            new SortedDictionary<string, string>(StringComparer.Ordinal);
        if (!baseline.AdaptivePolicy) return new ZonePolicyResult(baseline, none);

        var adapted = baseline.Clone();
        var deviations = new SortedDictionary<string, string>(StringComparer.Ordinal);

        // The raw-room floor keeps the rule off zones that merely happen to be sparsely drawn: a
        // big open room reads as low ink too (Upper 10, ratio 0.050, one room, 100% conversion),
        // and there is no lattice there to absorb. A rule that fires where it cannot act is noise
        // in the artifact even when it is harmless.
        if (census.InkRatio < baseline.SparseWallInkRatio
            && stats.RawRooms >= baseline.SparseWallMinRawRooms
            && baseline.AbsorbNeighborSharedPerimeterFraction
               != baseline.SparseWallAbsorbSharedPerimeterFraction)
        {
            adapted.AbsorbNeighborSharedPerimeterFraction =
                baseline.SparseWallAbsorbSharedPerimeterFraction;
            deviations["AbsorbNeighborSharedPerimeterFraction"] =
                $"{baseline.AbsorbNeighborSharedPerimeterFraction:0.###}->" +
                $"{adapted.AbsorbNeighborSharedPerimeterFraction:0.###} " +
                $"(sparse-wall-network: inkRatio {census.InkRatio:0.###}, {stats.RawRooms} raw rooms)";
        }

        return new ZonePolicyResult(adapted, deviations);
    }
}
