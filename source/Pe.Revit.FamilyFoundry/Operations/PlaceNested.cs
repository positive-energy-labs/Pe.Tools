using Autodesk.Revit.DB.Structure;
using Pe.Revit.Extensions.FamDocument;
using Pe.Shared.RevitData.Families;

namespace Pe.Revit.FamilyFoundry.Operations;

/// <summary>
///     Place nested family instances on a host plane (or `line:&lt;Name&gt;.end`, position only), lock the
///     instance's named reference planes to host planes (`GetReferenceByName` + `NewAlignment`, the puck
///     method) and associate instance parameters to host parameters. The nested family must already be loaded
///     by name (VERDICTS-R1 §5); otherwise the entry is refused.
/// </summary>
public sealed class PlaceNested((string Slug, FamilyModelNested Spec)[] nested, FamilyModel model) : DocOperation<DefaultOperationSettings>(new DefaultOperationSettings()) {
    public override string Description => $"Place {nested.Length} nested instances: {string.Join(", ", nested.Select(n => n.Slug))}";

    public override OperationLog Execute(FamilyDocument doc, FamilyProcessingContext ctx, OperationContext g) {
        var logs = new List<LogEntry>();
        foreach (var (slug, spec) in nested) {
            try {
                _ = Place(doc, slug, spec, logs);
            } catch (Exception ex) { logs.Add(new LogEntry(slug).Error(ex)); }
        }
        return new OperationLog(this.Name, logs);
    }

    internal static FamilyInstance Place(FamilyDocument doc, string slug, FamilyModelNested spec, List<LogEntry> logs) {
        var symbol = new FilteredElementCollector(doc).OfClass(typeof(FamilySymbol)).Cast<FamilySymbol>()
                                 .FirstOrDefault(s => s.Family.Name == spec.Family && s.Name == spec.Type)
                             ?? throw new InvalidOperationException($"Nested family '{spec.Family}' type '{spec.Type}' is not loaded in this family; load it first.");
        if (!symbol.IsActive) symbol.Activate();

        FamilyInstance instance;
        if (spec.Host.StartsWith("line:", StringComparison.Ordinal)) {
            var lineName = spec.Host[5..spec.Host.LastIndexOf('.')];
            var line = FamilyRefs.FindRefLine(doc, lineName) ?? throw new InvalidOperationException($"Reference line '{lineName}' is not in this family.");
            var curve = (Line)line.GeometryCurve;
            var point = spec.Host.EndsWith(".end", StringComparison.Ordinal) ? curve.GetEndPoint(1) : curve.GetEndPoint(0);
            // ponytail: gotcha 27, the end work plane is not publicly constructible; position only, hosted on the line's sketch plane
            instance = doc.Document.FamilyCreate.NewFamilyInstance(point, symbol, line.SketchPlane.GetPlane().Normal, line, StructuralType.NonStructural);
        } else {
            var (hostReference, plane) = FamilyRefs.Resolve(doc, spec.Host);
            instance = symbol.Family.FamilyPlacementType == FamilyPlacementType.WorkPlaneBased
                ? doc.Document.FamilyCreate.NewFamilyInstance(hostReference, plane.Origin, plane.XVec, symbol)
                : FamilyRefs.FindLevel(doc, spec.Host) is { } level
                    ? doc.Document.FamilyCreate.NewFamilyInstance(plane.Origin, symbol, level, StructuralType.NonStructural)
                    : doc.Document.FamilyCreate.NewFamilyInstance(plane.Origin, symbol,
                        doc.Document.GetElement(hostReference.ElementId), StructuralType.NonStructural);
        }
        doc.Document.Regenerate();

        foreach (var align in spec.Align ?? []) {
            var (hostRef, hostPlane) = FamilyRefs.Resolve(doc, align.To);
            var nestedRef = instance.GetReferenceByName(align.Instance)
                            ?? throw new InvalidOperationException($"'{spec.Family}' exposes no '{align.Instance}' reference; set its Is Reference name.");
            FamilyRefs.Align(doc, FamilyRefs.ViewForPlaneCreation(doc, hostPlane.Normal), hostRef, nestedRef);
        }
        foreach (var (target, source) in spec.Associate ?? []) {
            var p = instance.LookupParameter(target) ?? throw new InvalidOperationException($"'{spec.Family}' has no parameter '{target}'.");
            FamilyRefs.Associate(doc, p, source, logs, slug);
        }
        if (spec.Visible is { } visible) {
            var parameter = instance.get_Parameter(BuiltInParameter.IS_VISIBLE_PARAM)
                            ?? throw new InvalidOperationException($"'{spec.Family}' has no IS_VISIBLE_PARAM.");
            FamilyRefs.Associate(doc, parameter, visible, logs, slug);
        }
        logs.Add(new LogEntry(slug).Success($"Placed {spec.Family}:{spec.Type} on {spec.Host}, {spec.Align?.Count ?? 0} alignments."));
        return instance;
    }
}
