namespace Pe.Revit.Takeoff;

internal sealed class PreparedLevelTakeoffDetection
{
    private readonly PreparedTakeoffDetection detection;
    private readonly string provenance;
    private readonly IReadOnlyList<string> flags;

    internal PreparedLevelTakeoffDetection(
        PreparedTakeoffDetection detection, string provenance, IReadOnlyList<string> flags)
    {
        this.detection = detection;
        this.provenance = provenance;
        this.flags = flags;
    }

    internal TakeoffResult Detect(bool[]? zoneMask, Action<string> log)
    {
        var result = this.detection.Detect(zoneMask, log);
        result.ProfileProvenance = this.provenance;
        result.LevelFlags.AddRange(this.flags);
        return result;
    }

    internal TakeoffResult Detect(ZoneScope zone, Action<string> log) =>
        this.Detect(zone, log, out _);

    internal TakeoffResult Detect(ZoneScope zone, Action<string> log, out int whiteoutCells)
    {
        var result = this.detection.Detect(zone, log, out whiteoutCells);
        result.ProfileProvenance = this.provenance;
        result.LevelFlags.AddRange(this.flags);
        return result;
    }
}

// Mechanism thresholds for evidence-derived level policy. Defaults are calibrated against the
// project-a parity set and project-b falsification set; none depend on project or level names.
public sealed class LevelProfileThresholds
{
    public double EvidenceStoryCapFt = 30;
    public double CeilingCoverageMin = 0.5;
    public double HabitableFractionMin = 0.01;
    public double SlopedCeilingGradientMin = 3.0;
    public double SlopedCeilingFractionMin = 0.35;
    public double DoubleHeightHeadroomFt = 16;
    public double DoubleHeightFractionMin = 0.02;
    public double CeilingStepFt = 2.5;
    public double CeilingStepNearInkFt = 1.5;
    public double CeilingStepInkLiftMin = 1.3;
}

public sealed class LevelProfile
{
    public double CeilingCoverage;
    public double HabitableFraction;
    public double SlopedCeilingFraction;
    public double DoubleHeightFraction;
    public double CeilingStepInkLift;
    public bool NoHabitableDomain;
    public List<string> Flags = new();
    public TakeoffOptions Options = new();

    public string Provenance
    {
        get
        {
            var ic = CultureInfo.InvariantCulture;
            string F(double value) => value.ToString("F4", ic);
            return $"ceilingCoverage={F(this.CeilingCoverage)} habitableFraction={F(this.HabitableFraction)} " +
                   $"slopedCeilingFraction={F(this.SlopedCeilingFraction)} doubleHeightFraction={F(this.DoubleHeightFraction)} " +
                   $"ceilingStepInkLift={F(this.CeilingStepInkLift)} requireCeiling={this.Options.RequireCeiling.ToString().ToLowerInvariant()} " +
                   $"sealDoorHeads={this.Options.SealDoorHeads.ToString().ToLowerInvariant()} " +
                   $"sealWallRunGaps={this.Options.SealWallRunGaps.ToString().ToLowerInvariant()} " +
                   $"minHeadroomFt={F(this.Options.MinHeadroomFt)} ceilingCloseFt={F(this.Options.CeilingCloseFt)} " +
                   $"storyCapFt={F(this.Options.StoryCapFt)} " +
                   $"seed={this.Options.SeedSource}";
        }
    }

    internal void ApplyPolicyTo(TakeoffOptions target)
    {
        var inferred = this.Options;
        target.MinHeadroomFt = inferred.MinHeadroomFt;
        target.RequireCeiling = inferred.RequireCeiling;
        target.SealDoorHeads = inferred.SealDoorHeads;
        target.SealWallRunGaps = inferred.SealWallRunGaps;
        target.StoryCapFt = inferred.StoryCapFt;
        target.CeilingCloseFt = inferred.CeilingCloseFt;
        target.SeedSource = inferred.SeedSource;
        this.Options = target;
    }
}

public static class TakeoffPolicy
{
    public static LevelProfile InferLevelProfile(DetectSnapshot snap) =>
        InferLevelProfile(snap, new LevelProfileThresholds());

    public static LevelProfile InferLevelProfile(DetectSnapshot snap, LevelProfileThresholds thresholds)
    {
        if (snap == null) throw new ArgumentNullException(nameof(snap));
        if (thresholds == null) throw new ArgumentNullException(nameof(thresholds));
        var hf = snap.Field ?? throw new ArgumentException("snapshot has no heightfield", nameof(snap));
        int W = hf.W, H = hf.H, n = W * H;
        if (hf.FloorZ.Length != n || hf.CeilZ.Length != n || snap.SeedInk.Length != n)
            throw new ArgumentException($"snapshot arrays disagree with {W}x{H}", nameof(snap));

        var defaults = new TakeoffOptions { CellFt = hf.CellFt };
        var obstruction = Detector.BuildObstruction(hf, snap.SeedInk, snap.LevelElevation, defaults, _ => { });
        var boundedFloor = Detector.InkBoundedFloor(
            hf, obstruction, snap.LevelElevation, defaults.FloorTolFt);
        int boundedCount = 0, ceilingCount = 0, habitableCount = 0;
        double maxCeilingAboveLevel = defaults.StoryCapFt;
        for (int i = 0; i < n; i++)
        {
            if (!boundedFloor[i]) continue;
            boundedCount++;
            if (float.IsNaN(hf.CeilZ[i]) || hf.CeilZ[i] <= hf.FloorZ[i]) continue;
            maxCeilingAboveLevel = Math.Max(maxCeilingAboveLevel, hf.CeilZ[i] - snap.LevelElevation);
            if (hf.CeilZ[i] < snap.LevelElevation + defaults.StoryCapFt) ceilingCount++;
            if (hf.CeilZ[i] - hf.FloorZ[i] >= defaults.MinHeadroomFt) habitableCount++;
        }

        var sloped = new bool[n];
        var ceilingStep = new bool[n];
        void Pair(int a, int b)
        {
            if (float.IsNaN(hf.CeilZ[a]) || float.IsNaN(hf.CeilZ[b])) return;
            double delta = Math.Abs(hf.CeilZ[a] - hf.CeilZ[b]);
            if (delta / hf.CellFt >= thresholds.SlopedCeilingGradientMin) sloped[a] = sloped[b] = true;
            if (delta >= thresholds.CeilingStepFt) ceilingStep[a] = ceilingStep[b] = true;
        }
        for (int y = 0; y < H; y++)
            for (int x = 0; x < W; x++)
            {
                int i = y * W + x;
                if (x + 1 < W) Pair(i, i + 1);
                if (y + 1 < H) Pair(i, i + W);
            }

        int realCeilingFloorCount = 0, slopedCount = 0, doubleHeightCount = 0, stepCount = 0;
        for (int i = 0; i < n; i++)
        {
            if (!boundedFloor[i] || float.IsNaN(hf.CeilZ[i])) continue;
            realCeilingFloorCount++;
            if (sloped[i]) slopedCount++;
            if (hf.CeilZ[i] - hf.FloorZ[i] > thresholds.DoubleHeightHeadroomFt) doubleHeightCount++;
            if (ceilingStep[i]) stepCount++;
        }

        var distanceToInk = Detector.Chamfer(obstruction, W, H, invert: false);
        double nearCells = thresholds.CeilingStepNearInkFt / hf.CellFt;
        int floorNearInk = 0, stepNearInk = 0;
        for (int i = 0; i < n; i++)
        {
            if (!boundedFloor[i] || distanceToInk[i] > nearCells + 1e-4) continue;
            floorNearInk++;
            if (ceilingStep[i]) stepNearInk++;
        }
        double inkBaseRate = (double)floorNearInk / Math.Max(1, boundedCount);
        double stepPrecision = (double)stepNearInk / Math.Max(1, stepCount);

        var profile = new LevelProfile {
            CeilingCoverage = (double)ceilingCount / Math.Max(1, boundedCount),
            HabitableFraction = (double)habitableCount / Math.Max(1, boundedCount),
            SlopedCeilingFraction = (double)slopedCount / Math.Max(1, realCeilingFloorCount),
            DoubleHeightFraction = (double)doubleHeightCount / Math.Max(1, boundedCount),
            CeilingStepInkLift = inkBaseRate > 0 ? stepPrecision / inkBaseRate : 0,
            NoHabitableDomain = boundedCount == 0
                                || (double)habitableCount / boundedCount < thresholds.HabitableFractionMin,
            Options = new TakeoffOptions { CellFt = hf.CellFt },
        };

        bool attic = profile.SlopedCeilingFraction >= thresholds.SlopedCeilingFractionMin;
        bool flat = profile.CeilingCoverage >= thresholds.CeilingCoverageMin;
        if (flat)
        {
            profile.Options.RequireCeiling = true;
            profile.Options.SealDoorHeads = true;
            // Flat coverage keeps wall-run sealing even when the sloped fraction trips the attic
            // branch: a story with vaulted great-rooms is still a story of walled rooms, and
            // disarming sealing there starves whole wings of closure (Main Level, measured:
            // ML05/ML09 went from 0 accepted rooms to solving once sealing was restored). Only a
            // level that is attic-like AND lacks flat coverage is a true attic, where run sealing
            // manufactures walls out of roof-plane noise (Attic 01, measured: -9 rooms).
            profile.Options.SealWallRunGaps = true;
        }
        if (!flat && !profile.NoHabitableDomain)
            profile.Flags.Add("low-ceiling-evidence");
        if (attic)
        {
            profile.Options.SealDoorHeads = true;
            profile.Options.SealWallRunGaps = flat;
            profile.Options.MinHeadroomFt = 3.5;
            profile.Options.CeilingCloseFt = 3;
            profile.Options.StoryCapFt = Math.Ceiling(maxCeilingAboveLevel);
        }
        else if (profile.DoubleHeightFraction >= thresholds.DoubleHeightFractionMin)
        {
            profile.Options.StoryCapFt = Math.Ceiling(maxCeilingAboveLevel);
        }

        // TODO: LevelProfile region-cores rule silently subsumed by the Hybrid SeedSource default —
        // make the rule or the default explicit (owed since 2026-08-14; do not just rediscover it).
        // COLLISION (2026-08-14 fan-out): TakeoffOptions.SeedSource now defaults to Hybrid, and this
        // rule only ever upgrades TO Hybrid — it never asks for RegionCores back. So the "below-grade
        // or non-flat levels use region cores" domain rule is silently subsumed by the default: every
        // level arrives Hybrid regardless. The composite A/B numbers were measured that way (knob
        // override forced Hybrid everywhere), so they are honest — but either this rule or the default
        // should be made explicit rather than left to override order.
        bool regionCores = snap.LevelElevation < 0 || !flat;
        if (!regionCores && profile.CeilingStepInkLift >= thresholds.CeilingStepInkLiftMin)
            profile.Options.SeedSource = TakeoffSeedSource.Hybrid;
        if (profile.NoHabitableDomain)
            profile.Flags.Add("no-habitable-domain");
        return profile;
    }

    internal static TakeoffResult Detect(
        DetectSnapshot snap, LevelProfile profile, Action<string> log, bool[]? zoneMask = null)
    {
        var field = DetectionField(snap, profile);
        TakeoffResult result;
        if (profile.NoHabitableDomain)
        {
            log($"[profile] level='{snap.LevelName}' no habitable domain; candidates=0");
            result = new TakeoffResult { LevelName = snap.LevelName, LevelElevation = snap.LevelElevation };
        }
        else
        {
            result = Detector.Detect(
                field, snap.SeedInk, snap.LevelName, snap.LevelElevation, profile.Options, log, zoneMask);
        }
        result.ProfileProvenance = profile.Provenance;
        result.LevelFlags.AddRange(profile.Flags.Select(flag => $"level:{snap.LevelName}:{flag}"));
        return result;
    }

    internal static PreparedLevelTakeoffDetection PrepareDetection(
        DetectSnapshot snap, LevelProfile profile, Action<string> log)
    {
        if (profile.NoHabitableDomain)
            throw new InvalidOperationException(
                $"level '{snap.LevelName}' has no habitable domain to prepare");
        var detection = Detector.Prepare(
            DetectionField(snap, profile), snap.SeedInk, snap.LevelName, snap.LevelElevation,
            profile.Options, log);
        return new PreparedLevelTakeoffDetection(
            detection,
            profile.Provenance,
            profile.Flags.Select(flag => $"level:{snap.LevelName}:{flag}").ToList());
    }

    /// <summary>
    /// Per-cell seal attribution for the level exactly as this profile's knobs would seal it — the
    /// same heightfield <see cref="PrepareDetection"/> detects against, so the raster is the real
    /// closure decision and not a re-derivation under different options.
    /// </summary>
    public static byte[] SealClasses(DetectSnapshot snap, LevelProfile profile) =>
        Detector.SealClasses(
            DetectionField(snap, profile), snap.SeedInk, snap.LevelElevation, profile.Options);

    private static Heightfield DetectionField(DetectSnapshot snap, LevelProfile profile)
    {
        if (profile.Options.CeilingCloseFt <= snap.CapturedCeilingCloseFt() + 1e-9)
            return snap.Field;
        var field = new Heightfield {
            W = snap.Field.W, H = snap.Field.H,
            MinX = snap.Field.MinX, MinY = snap.Field.MinY, CellFt = snap.Field.CellFt,
            FloorZ = snap.Field.FloorZ, CeilZ = (float[])snap.Field.CeilZ.Clone(),
        };
        Heightfield.CloseCeilingGaps(field, profile.Options.CeilingCloseFt);
        return field;
    }

}
