using Pe.Revit.Extensions.FamDocument;
using Pe.Revit.FamilyFoundry.Helpers;
using Pe.Revit.FamilyFoundry.OperationSettings;
using Pe.Revit.FamilyFoundry.Resolution;

namespace Pe.Revit.FamilyFoundry.Operations;

/// <summary>
///     Recreates constrained extrusions from canonical reference-plane specs.
///     V1 fully supports constrained rectangles and circles.
/// </summary>
public class MakeConstrainedExtrusions(MakeConstrainedExtrusionsSettings settings)
    : DocOperation<MakeConstrainedExtrusionsSettings>(settings) {
    public override string Description => "Create canonical reference-plane-constrained extrusions";

    public override OperationLog Execute(
        FamilyDocument doc,
        FamilyProcessingContext processingContext,
        OperationContext groupContext
    ) {
        var logs = new List<LogEntry>();
        logs.AddRange(FamilyTypeDrivenValueGuard.ValidateLengthDrivenParameters(
            doc,
            KnownParamPlanBuilder.CollectReferencedParameterNames(this.Settings),
            this.Name));
        if (logs.Any(entry => entry.Status == LogStatus.Error))
            return new OperationLog(this.Name, logs);

        foreach (var spec in this.Settings.Rectangles) {
            var key = $"Rectangle extrusion: {spec.Name}";
            _ = ConstrainedExtrusionFactory.CreateRectangle(doc.Document, spec, logs, key);
        }

        foreach (var circle in this.Settings.Circles) {
            var key = $"Circle extrusion: {circle.Name}";
            _ = ConstrainedExtrusionFactory.CreateCircle(doc.Document, circle, logs, key);
        }

        return new OperationLog(this.Name, logs);
    }
}
