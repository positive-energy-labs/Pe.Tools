namespace Pe.Revit.Takeoff;

/// <summary>
/// What one zone's raster looks like before anyone tries to partition it: how big it is, how much
/// ink it holds, how that ink is distributed. Pure grid arithmetic — no Revit, no geometry engine —
/// so it is cheap enough to compute for every zone on every run and land in the artifact.
/// </summary>
/// <param name="ZoneSqft">Area of the masked cells.</param>
/// <param name="InkSqft">Area of the ink cells inside the mask.</param>
/// <param name="InkRatio">In-zone ink cells over zone cells; a wall-density proxy.</param>
/// <param name="InkClusterCells">
/// Sizes, largest first, of 8-connected in-zone ink clusters that FLOAT — clusters that never touch
/// the zone boundary ink ring. Stairs, fixtures and roof framing show up here; walls do not.
/// </param>
/// <param name="EdgeBandInkFraction">
/// Fraction of in-zone ink sitting within the census probe band of the zone mask boundary.
/// </param>
public sealed record ZoneCensus(
    double ZoneSqft,
    double InkSqft,
    double InkRatio,
    IReadOnlyList<int> InkClusterCells,
    double EdgeBandInkFraction)
{
    /// <summary>
    /// The band the census measures against. Deliberately a constant, not
    /// <see cref="TakeoffOptions.EdgeBandFt"/>: a census is a measurement, so it must stay
    /// comparable across runs that vary the recombination policy band.
    /// </summary>
    public const double ProbeEdgeBandFt = 2.0;

    public static ZoneCensus Compute(
        bool[] ink, bool[] zoneMask, int w, int h, double cellFt,
        double edgeBandFt = ProbeEdgeBandFt)
    {
        int n = w * h;
        if (ink.Length != n) throw new ArgumentException($"ink disagrees with {w}x{h}", nameof(ink));
        if (zoneMask.Length != n)
            throw new ArgumentException($"zoneMask disagrees with {w}x{h}", nameof(zoneMask));
        if (!(cellFt > 0)) throw new ArgumentOutOfRangeException(nameof(cellFt));
        double cellArea = cellFt * cellFt;
        int zoneCells = 0, inkCells = 0;
        for (int i = 0; i < n; i++)
        {
            if (!zoneMask[i]) continue;
            zoneCells++;
            if (ink[i]) inkCells++;
        }
        if (zoneCells == 0) return new ZoneCensus(0, 0, 0, [], 0);

        var distance = BoundaryDistanceCells(zoneMask, w, h);
        double bandCells = edgeBandFt / cellFt + 1e-4;
        int bandInk = 0;
        for (int i = 0; i < n; i++)
            if (zoneMask[i] && ink[i] && distance[i] <= bandCells) bandInk++;

        var floating = InkHygiene.Clusters(ink, zoneMask, w, h)
            .Where(cluster => !cluster.TouchesZoneBoundary)
            .Select(cluster => cluster.Cells.Count)
            .OrderByDescending(size => size)
            .ToList();

        return new ZoneCensus(
            zoneCells * cellArea,
            inkCells * cellArea,
            (double)inkCells / zoneCells,
            floating,
            inkCells == 0 ? 0 : (double)bandInk / inkCells);
    }

    /// <summary>
    /// Chamfer distance, in cells, from every cell to the nearest non-zone cell. Computed on a
    /// one-cell padded grid so the raster edge counts as outside — a zone clipped by the crop must
    /// not read as boundary-free.
    /// </summary>
    private static float[] BoundaryDistanceCells(bool[] zoneMask, int w, int h)
    {
        int paddedW = w + 2, paddedH = h + 2;
        var padded = new bool[paddedW * paddedH];
        for (int y = 0; y < h; y++)
        for (int x = 0; x < w; x++)
            padded[(y + 1) * paddedW + (x + 1)] = !zoneMask[y * w + x];
        for (int x = 0; x < paddedW; x++)
        {
            padded[x] = true;
            padded[(paddedH - 1) * paddedW + x] = true;
        }
        for (int y = 0; y < paddedH; y++)
        {
            padded[y * paddedW] = true;
            padded[y * paddedW + paddedW - 1] = true;
        }
        var paddedDistance = Detector.Chamfer(padded, paddedW, paddedH, invert: false);
        var distance = new float[w * h];
        for (int y = 0; y < h; y++)
        for (int x = 0; x < w; x++)
            distance[y * w + x] = paddedDistance[(y + 1) * paddedW + (x + 1)];
        return distance;
    }
}

public enum ZoneTriageAction { Solve, HoldWhole }

/// <summary>
/// Pre-solve verdict for one zone. <see cref="ZoneTriageAction.HoldWhole"/> means the solver never
/// runs: the zone emits zero rooms and its whole area as one held residue. That is abstention, not
/// failure — the accounting law still closes, and <see cref="Reason"/> is the visible explanation.
/// </summary>
public sealed record ZoneTriageVerdict(ZoneTriageAction Action, string Reason)
{
    public static readonly ZoneTriageVerdict Solve = new(ZoneTriageAction.Solve, "");

    public bool IsHold => this.Action == ZoneTriageAction.HoldWhole;
}

/// <summary>
/// Turns a <see cref="ZoneCensus"/> into a solve/hold decision. Every threshold is a
/// <see cref="TakeoffOptions"/> knob and every knob defaults to off, so triage is inert until an
/// experiment turns it on.
/// </summary>
public static class ZoneTriage
{
    public static ZoneTriageVerdict Evaluate(ZoneCensus census, TakeoffOptions options)
    {
        if (census == null) throw new ArgumentNullException(nameof(census));
        if (options == null) throw new ArgumentNullException(nameof(options));
        // No cell of the raster falls inside this zone — a zone thinner than the grid, or one
        // declared outside the captured crop. There is literally nothing to partition, so this
        // holds unconditionally, ahead of and independent of every tunable. It is NOT a small
        // zone: Attic Level#03 is 5,609 geometric sf with an empty mask, and calling that
        // "small-zone" would attribute a raster failure to a policy threshold.
        if (census.ZoneSqft <= 0)
            return new ZoneTriageVerdict(ZoneTriageAction.HoldWhole, "no-raster");
        // Small zones are mechanical-equipment pockets and stair/chase slivers: the watershed has
        // nothing to partition and wanders. Hold them whole.
        if (options.SmallZoneSqft > 0 && census.ZoneSqft <= options.SmallZoneSqft)
            return new ZoneTriageVerdict(ZoneTriageAction.HoldWhole, "small-zone");
        return ZoneTriageVerdict.Solve;
    }
}
