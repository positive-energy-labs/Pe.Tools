using Pe.Extensions.FamDocument;
using Pe.FamilyFoundry.Helpers;
using Pe.FamilyFoundry.OperationSettings;

namespace Pe.FamilyFoundry.Operations;

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
