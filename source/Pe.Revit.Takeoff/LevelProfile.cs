namespace Pe.Revit.Takeoff;

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
        var boundedFloor = InkBoundedFloor(hf, obstruction, snap.LevelElevation, defaults.FloorTolFt);
        var floor = new bool[n];
        int boundedCount = 0, floorCount = 0, ceilingCount = 0, habitableCount = 0;
        double maxCeilingAboveLevel = defaults.StoryCapFt;
        for (int i = 0; i < n; i++)
        {
            floor[i] = !float.IsNaN(hf.FloorZ[i])
                       && Math.Abs(hf.FloorZ[i] - snap.LevelElevation) <= defaults.FloorTolFt;
            if (floor[i]) floorCount++;
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
            if (!floor[i] || float.IsNaN(hf.CeilZ[i])) continue;
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
            if (!floor[i] || distanceToInk[i] > nearCells + 1e-4) continue;
            floorNearInk++;
            if (ceilingStep[i]) stepNearInk++;
        }
        double inkBaseRate = (double)floorNearInk / Math.Max(1, floorCount);
        double stepPrecision = (double)stepNearInk / Math.Max(1, stepCount);

        var profile = new LevelProfile {
            CeilingCoverage = (double)ceilingCount / Math.Max(1, boundedCount),
            HabitableFraction = (double)habitableCount / Math.Max(1, boundedCount),
            SlopedCeilingFraction = (double)slopedCount / Math.Max(1, realCeilingFloorCount),
            DoubleHeightFraction = (double)doubleHeightCount / Math.Max(1, floorCount),
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
            profile.Options.SealWallRunGaps = !attic;
        }
        if (!flat && !profile.NoHabitableDomain)
            profile.Flags.Add("low-ceiling-evidence");
        if (attic)
        {
            profile.Options.SealDoorHeads = true;
            profile.Options.SealWallRunGaps = false;
            profile.Options.MinHeadroomFt = 3.5;
            profile.Options.CeilingCloseFt = 3;
            profile.Options.StoryCapFt = Math.Ceiling(maxCeilingAboveLevel);
        }
        else if (profile.DoubleHeightFraction >= thresholds.DoubleHeightFractionMin)
        {
            profile.Options.StoryCapFt = Math.Ceiling(maxCeilingAboveLevel);
        }

        bool regionCores = snap.LevelElevation < 0 || !flat;
        if (!regionCores && profile.CeilingStepInkLift >= thresholds.CeilingStepInkLiftMin)
            profile.Options.SeedSource = TakeoffSeedSource.Hybrid;
        if (profile.NoHabitableDomain)
            profile.Flags.Add("no-habitable-domain");
        return profile;
    }

    internal static TakeoffResult Detect(DetectSnapshot snap, LevelProfile profile, Action<string> log)
    {
        var field = snap.Field;
        if (profile.Options.CeilingCloseFt > snap.CapturedCeilingCloseFt() + 1e-9)
        {
            field = new Heightfield {
                W = snap.Field.W, H = snap.Field.H,
                MinX = snap.Field.MinX, MinY = snap.Field.MinY, CellFt = snap.Field.CellFt,
                FloorZ = snap.Field.FloorZ, CeilZ = (float[])snap.Field.CeilZ.Clone(),
            };
            Heightfield.CloseCeilingGaps(field, profile.Options.CeilingCloseFt);
        }
        TakeoffResult result;
        if (profile.NoHabitableDomain)
        {
            log($"[profile] level='{snap.LevelName}' no habitable domain; candidates=0");
            result = new TakeoffResult { LevelName = snap.LevelName, LevelElevation = snap.LevelElevation };
        }
        else
        {
            result = Detector.Detect(
                field, snap.SeedInk, snap.LevelName, snap.LevelElevation, profile.Options, log);
        }
        result.ProfileProvenance = profile.Provenance;
        result.LevelFlags.AddRange(profile.Flags.Select(flag => $"level:{snap.LevelName}:{flag}"));
        return result;
    }

    private static bool[] InkBoundedFloor(Heightfield hf, bool[] obstruction, double levelElevation, double floorTolFt)
    {
        int W = hf.W, H = hf.H, n = W * H;
        var outside = new bool[n];
        var queue = new Queue<int>();
        void Add(int i)
        {
            if (obstruction[i] || outside[i]) return;
            outside[i] = true;
            queue.Enqueue(i);
        }
        for (int x = 0; x < W; x++) { Add(x); Add((H - 1) * W + x); }
        for (int y = 1; y + 1 < H; y++) { Add(y * W); Add(y * W + W - 1); }
        while (queue.Count > 0)
        {
            int i = queue.Dequeue(), x = i % W, y = i / W;
            if (x > 0) Add(i - 1);
            if (x + 1 < W) Add(i + 1);
            if (y > 0) Add(i - W);
            if (y + 1 < H) Add(i + W);
        }

        var domain = new bool[n];
        for (int i = 0; i < n; i++)
            domain[i] = !outside[i] && !float.IsNaN(hf.FloorZ[i])
                        && Math.Abs(hf.FloorZ[i] - levelElevation) <= floorTolFt;
        return domain;
    }
}
