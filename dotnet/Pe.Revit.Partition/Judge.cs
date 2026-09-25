namespace Pe.Revit.Partition;

/// <summary>
///     Layer 2: engineering judgment over layer 1's faces (size, confidence, conditioned-space rules). One face in, one
///     disposition out, first match wins. Geometry never changes here.
/// </summary>
public static class Judge {
    // FOOTGUN: widest envelope band (outer face to zone edge) counted as excluded wall. Duryee Level 1's thirteen
    // bands measure 0.23 to 1.26 ft (the 6693266 west bay is 1.0 ft); project-a live's widest is 1.46 ft. A wider
    // band means the person drew the zone off the wall, and it is held with its width.
    public const double BandHoldFt = 2.5;

    // FOOTGUN: smallest rail-bounded face kept as a room. Duryee's closets are 11, 20 and 22 sf; under this is a
    // chase or a junction scrap even when every edge is on a rail.
    private const double MinRailRoomSqft = 6.0;

    public static (Disposition Disposition, string? Reason) Dispose(FaceFacts f, double levelZ, Knobs knobs) {
        if (f.Kind == FaceKind.Band)
            return f.BandWidthFt is { } w && w > BandHoldFt ? (Disposition.Held, $"envelope-band-{w:0.0}ft") : (Disposition.Excluded, Reasons.Wall);
        if (f.Kind == FaceKind.Contested) return (Disposition.Held, Reasons.NativeOverlap);
        if (f.Proposal is null && f.OwnEdgeEmpty) return (Disposition.Held, Reasons.ZoneEdgeOnly);
        if (f.FloorZ is not { } fz || Math.Abs(fz - levelZ) > knobs.FloorTolFt) return (Disposition.Held, Reasons.NoFloor);
        if (f.CeilingZ is not { } cz) return (Disposition.Held, Reasons.NoCeiling);
        if (cz - fz < knobs.MinHeadroomFt) return (Disposition.Void, Reasons.LowHeadroom);
        // A face bounded only by rails, bars and the zone edge is a room however small, down to a closet's floor.
        if (f.Shape.Area < MinRailRoomSqft) return (Disposition.Held, Reasons.TooSmallTiny);
        if (f.Shape.Area < knobs.MinRoomSqft && f.FloatingFt > Solve.SampleFt) return (Disposition.Held, Reasons.TooSmallFloating);
        if (f.Narrow) return (Disposition.Held, Reasons.TooNarrow);
        if (f.Proposal is null && f.Backed < knobs.InkBackedAcceptMin) return (Disposition.Held, Reasons.Unbacked);
        return (Disposition.Accepted, null);
    }
}
