namespace Pe.Revit.Extensions.FamDocument;

/// <summary>
///     Three counts that predict how long a Family Foundry pass takes on this family. Fitted 2026-09-08 on all 81 Old_Template
///     mechanical families (proxy swarm, `.artifacts/runs/famclose-20260907/proxy/`): r 0.92 on log time, median error 1.25x,
///     against a run-to-run ceiling of 0.96. Geometry drives the cost; the parameter graph does not (associations r 0.28,
///     geometry sinks r 0.01), so this is deliberately not derived from <see cref="ParameterDependencyGraph"/>, which exists to
///     name the elements in a posted failure. One collector pass, about 6 ms. Diagnostic only: nothing schedules or refuses on it.
/// </summary>
public sealed record FamilyComplexity(int SketchPlanes, int Elements, int Types) {
    // ponytail: coefficients from one category and one plan; refit when a second corpus is measured (FamilyWallTimeProxyProbe).
    /// <summary>A ranking, not a promise: ln(ms) = 0.9276 ln(1+sketchPlanes) + 1.4362 ln(1+elements) + 0.5204 ln(1+types) - 5.4443.</summary>
    public double PredictedSeconds =>
        Math.Exp(0.9276 * Math.Log(1 + this.SketchPlanes) + 1.4362 * Math.Log(1 + this.Elements) + 0.5204 * Math.Log(1 + this.Types) - 5.4443) / 1000;

    public override string ToString() =>
        $"sketchPlanes={this.SketchPlanes} elements={this.Elements} types={this.Types} predictedSeconds={this.PredictedSeconds:F1}";

    public static FamilyComplexity Measure(FamilyDocument document) {
        var elements = new FilteredElementCollector(document.Document).WhereElementIsNotElementType().ToElements();
        return new FamilyComplexity(elements.Count(element => element is SketchPlane), elements.Count, document.FamilyManager.Types.Size);
    }
}
