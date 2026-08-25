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
/// set. The seam exists because one global value is demonstrably wrong across a mixed building —
/// a knob that helps one zone and hurts another is not a bad constant; it is a constant asked to
/// answer a question that depends on the zone. It currently carries NO live rules: the sparse-wall
/// absorb rule (keyed on <see cref="ZoneCensus.InkRatio"/>) was falsified twice — measured −6
/// rooms at the 2.5 ft drift budget (DECISIONS 2026-08-14), and inkRatio itself does not separate
/// zones on framing-clean ink (DECISIONS 2026-08-16). The earned successor keys on
/// <see cref="ZoneCensus.EdgeBandInkFraction"/> (attic-scoped, round-2 slate); until a rule lands,
/// an armed policy adapts nothing and reports nothing.
/// </summary>
public static class ZonePolicy
{
    public static ZonePolicyResult Adapt(
        ZoneCensus census, ZonePartitionStats stats, TakeoffOptions baseline)
    {
        if (census == null) throw new ArgumentNullException(nameof(census));
        if (stats == null) throw new ArgumentNullException(nameof(stats));
        if (baseline == null) throw new ArgumentNullException(nameof(baseline));
        var none = (IReadOnlyDictionary<string, string>)
            new SortedDictionary<string, string>(StringComparer.Ordinal);
        if (!baseline.AdaptivePolicy) return new ZonePolicyResult(baseline, none);
        // Armed, but no live rules exist (see class doc): adapt nothing, attribute nothing.
        return new ZonePolicyResult(baseline, none);
    }
}
