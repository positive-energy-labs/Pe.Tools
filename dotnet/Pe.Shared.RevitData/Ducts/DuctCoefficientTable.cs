namespace Pe.Shared.RevitData.Ducts;

/// <summary>
/// One sourced round-fitting coefficient. Junction AreaRatio is Ab/Ac with As=Ac; FlowRatio is Qb/Qc.
/// Elbow area ratio is outlet/inlet. RadiusOverDiameter is null for junctions, where the source has no bend-radius axis.
/// Junction C uses common-inlet velocity; elbow C uses local duct velocity. These rows do not apply to converging flow.
/// </summary>
public sealed record DuctCoefficientRow(string Id, PressurePartType PartType, FittingPath Path, double AngleDegrees,
    double? RadiusOverDiameter, double AreaRatio, double FlowRatio, double Coefficient, bool CommonVelocity, string Source);

/// <summary>A bounded interpolation of sourced rows; C retains the table's stated reference velocity.</summary>
public sealed record DuctCoefficientMatch(string Id, double Coefficient, bool CommonVelocity, string Source);

/// <summary>
/// Small, explicit subset of ASHRAE's Principles of HVAC 9th-edition fitting supplement.
/// Smooth round elbows: fitting 3-1 p10. Diverging simple round tee/wye: fitting 5-23 pp38-39, Ac=As and Ab/Ac=0.5.
/// Linear interpolation is only along the junction flow axis; no extrapolation or substitution across construction classes.
/// </summary>
public static class DuctCoefficientTable {
    /// <summary>Primary source, with each row carrying the fitting and page anchor.</summary>
    public const string Source = "https://xp20.ashrae.org/SupplementalFiles/PHVAC9/Fitting_Loss_Coefficients.pdf";

    /// <summary>The exact implemented numeric rows, available to Pea and the route for inspection.</summary>
    public static IReadOnlyList<DuctCoefficientRow> Rows { get; } = Array.AsReadOnly(CreateRows().ToArray());

    private static IEnumerable<DuctCoefficientRow> CreateRows() {
        var radii = new[] { .5, .75, 1, 1.5, 2, 2.5 };
        var elbow = new[] { .71, .33, .22, .15, .13, .12 };
        var angles = new[] { 30.0, 45, 60, 90 };
        var correction = new[] { .45, .60, .78, 1 };
        for (var a = 0; a < angles.Length; a++)
        for (var r = 0; r < radii.Length; r++)
            yield return new($"3-1:{a}:{r}", PressurePartType.Elbow, FittingPath.Bend, angles[a], radii[r], 1, 1,
                elbow[r] * correction[a], false, Source + "#page=10 fitting 3-1, smooth radius die-stamped round elbow; angle correction applied");
        var q = new[] { .1, .2, .3, .4, .5, .6, .7, .8, .9 };
        var tee = new[] { .97, 1, 1.1, 1.2, 1.4, 1.5, 1.8, 2.1, 2.5 };
        var wye = new[] { .71, .52, .41, .38, .40, .45, .59, .78, 1 };
        var vsOverVc = new[] { 0.0, .1, .2, .3, .4, .5, .6, .8, 1 };
        var main = new[] { .40, .32, .26, .20, .14, .10, .06, .02, 0 };
        foreach (var kind in new[] { PressurePartType.Tee, PressurePartType.LateralTee }) {
            var angle = kind == PressurePartType.Tee ? 90 : 45;
            for (var i = 0; i < q.Length; i++)
                yield return new($"5-23:{kind}:branch:{i}", kind, FittingPath.Branch, angle, null, .5, q[i],
                    kind == PressurePartType.Tee ? tee[i] : wye[i], true,
                    Source + (kind == PressurePartType.Tee ? "#page=39" : "#page=38") + " fitting 5-23, Ac=As, Ab/Ac=0.5, common velocity reference");
            for (var i = 0; i < vsOverVc.Length; i++)
                yield return new($"5-23:{kind}:straight:{i}", kind, FittingPath.Straight, angle, null, .5, 1 - vsOverVc[i], main[i], true,
                    Source + "#page=38 fitting 5-23 main, Ac=As; Vs/Vc=1-Qb/Qc, common velocity reference");
        }
    }

    /// <summary>Return null for absent construction/geometry or values outside the sourced domain; the caller must name its fallback.</summary>
    public static DuctCoefficientMatch? Lookup(PressurePartType kind, FittingPath path, double? angle, double? radius,
        double areaRatio, double straightAreaRatio, double flowRatio, bool converging, int outlets, FittingConstruction construction) {
        if (!angle.HasValue || double.IsNaN(flowRatio)) return null;
        if (kind == PressurePartType.Elbow && (construction != FittingConstruction.SmoothRound || outlets != 1)) return null;
        if (kind is PressurePartType.Tee or PressurePartType.LateralTee &&
            (construction != FittingConstruction.SimpleJunction || converging || outlets != 2 || Math.Abs(straightAreaRatio - 1) > .002)) return null;
        var rows = Rows.Where(r => r.PartType == kind && r.Path == path && Math.Abs(r.AngleDegrees - angle.Value) < .1
                && Math.Abs(r.AreaRatio - areaRatio) < .002
                && (!r.RadiusOverDiameter.HasValue || radius.HasValue && Math.Abs(r.RadiusOverDiameter.Value - radius.Value) < .001))
            .OrderBy(r => r.FlowRatio).ToList();
        if (rows.Count == 0) return null;
        if (kind == PressurePartType.Elbow) return new(rows[0].Id, rows[0].Coefficient, false, rows[0].Source);
        if (flowRatio < rows[0].FlowRatio || flowRatio > rows[rows.Count - 1].FlowRatio) return null;
        var lower = rows.Last(r => r.FlowRatio <= flowRatio);
        var upper = rows.First(r => r.FlowRatio >= flowRatio);
        if (lower == upper) return new(lower.Id, lower.Coefficient, true, lower.Source);
        var t = (flowRatio - lower.FlowRatio) / (upper.FlowRatio - lower.FlowRatio);
        return new(lower.Id + "/" + upper.Id, lower.Coefficient + t * (upper.Coefficient - lower.Coefficient), true,
            lower.Source + "; linear flow interpolation to " + upper.Id);
    }
}
