namespace Pe.Shared.RevitData.Ducts;

/// <summary>Revit-free Darcy-Weisbach/Colebrook physics in SI internally, with feet/CFM/in-wg at the public boundary.</summary>
public static class DuctPressurePhysics {
    /// <summary>Pa per inch of water at 60 F, the unit used by ducts.snapshot (not the 4 C conventional water column).</summary>
    public const double PascalsPerInchWater = 248.84;

    /// <summary>
    /// Actual flow area in ft2 and hydraulic diameter 4A/P in feet (ASHRAE Fundamentals, Duct Design, Hydraulic Diameter).
    /// Flat oval uses two semicircular ends with straight parallel sides. Invalid dimensions return null.
    /// </summary>
    public static (double AreaFt2, double DiameterFt)? Section(DuctShape shape, double? diameterIn, double? widthIn, double? heightIn) {
        if (shape == DuctShape.Round && Positive(diameterIn)) {
            var d = diameterIn!.Value / 12;
            return (Math.PI * d * d / 4, d);
        }
        if (!Positive(widthIn) || !Positive(heightIn)) return null;
        var w = widthIn!.Value / 12;
        var h = heightIn!.Value / 12;
        if (shape == DuctShape.Rectangular) return (w * h, 2 * w * h / (w + h));
        if (shape != DuctShape.Oval) return null;
        var dmin = Math.Min(w, h);
        var straight = Math.Max(w, h) - dmin;
        var area = Math.PI * dmin * dmin / 4 + straight * dmin;
        return (area, 4 * area / (Math.PI * dmin + 2 * straight));
    }

    /// <summary>
    /// Darcy friction factor. Laminar f=64/Re below 2300; Colebrook is iterated to convergence above 4000.
    /// The unstable transition interval linearly interpolates the two endpoints and is flagged by Solve.
    /// ASHRAE Fundamentals Duct Design, Darcy and Colebrook equations; no explicit turbulent approximation is used.
    /// </summary>
    public static double FrictionFactor(double reynoldsNumber, double relativeRoughness) {
        if (!Nonnegative(reynoldsNumber) || !Nonnegative(relativeRoughness))
            throw new ArgumentOutOfRangeException(nameof(reynoldsNumber), "Re and relative roughness must be finite and nonnegative.");
        if (reynoldsNumber == 0) return 0;
        if (reynoldsNumber < 2300) return 64 / reynoldsNumber;
        if (reynoldsNumber < 4000) {
            var t = (reynoldsNumber - 2300) / 1700;
            return (1 - t) * 64 / 2300 + t * FrictionFactor(4000, relativeRoughness);
        }
        var inverseSqrt = 7.0;
        for (var i = 0; i < 100; i++) {
            var next = -2 * Math.Log10(relativeRoughness / 3.7 + 2.51 * inverseSqrt / reynoldsNumber);
            if (next <= 0) throw new ArgumentOutOfRangeException(nameof(relativeRoughness), "Roughness exceeds the Colebrook domain.");
            if (Math.Abs(next - inverseSqrt) < 1e-12) return 1 / (next * next);
            inverseSqrt = next;
        }
        throw new InvalidOperationException("Colebrook did not converge.");
    }

    /// <summary>
    /// Calculate straight loss for a known nonnegative flow. Noncircular laminar flow uses a hydraulic-diameter
    /// approximation (not an exact Poiseuille solution); Solve names that assumption. Expected missing inputs are handled by Solve.
    /// </summary>
    public static DuctFriction Straight(DuctShape shape, double? diameterIn, double? widthIn, double? heightIn,
        double lengthFt, double flowCfm, double roughnessFt, double densityKgPerM3, double viscosityPaS) {
        var section = Section(shape, diameterIn, widthIn, heightIn)
            ?? throw new ArgumentException("A supported shape with positive finite dimensions is required.", nameof(shape));
        if (!Nonnegative(lengthFt) || !Nonnegative(flowCfm) || !Nonnegative(roughnessFt)
            || !Positive(densityKgPerM3) || !Positive(viscosityPaS) || roughnessFt / section.DiameterFt >= 1)
            throw new ArgumentOutOfRangeException(nameof(flowCfm), "Length, flow and roughness must be finite and nonnegative; air properties positive; roughness less than Dh.");
        var velocityFpm = flowCfm / section.AreaFt2;
        var velocityMS = velocityFpm * 0.3048 / 60;
        var re = densityKgPerM3 * velocityMS * section.DiameterFt * 0.3048 / viscosityPaS;
        var f = FrictionFactor(re, roughnessFt / section.DiameterFt);
        var vp = densityKgPerM3 * velocityMS * velocityMS / 2 / PascalsPerInchWater;
        var gradient = f / section.DiameterFt * vp;
        return new(velocityFpm, re, f, section.DiameterFt, vp, gradient * 100, gradient * lengthFt);
    }

    internal static bool Nonnegative(double value) => !double.IsNaN(value) && !double.IsInfinity(value) && value >= 0;
    internal static bool Positive(double? value) => value is > 0 && !double.IsInfinity(value.Value);
}
