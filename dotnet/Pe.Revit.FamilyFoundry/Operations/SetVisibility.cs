using Pe.Revit.Extensions.FamDocument;
using Pe.Shared.RevitData.Families;

namespace Pe.Revit.FamilyFoundry.Operations;

/// <summary>Associate `IS_VISIBLE_PARAM` of a form, nested instance or detail to a Yes/No family parameter (live-proven).</summary>
public sealed class SetVisibility((string Slug, string Section, string Parameter)[] bindings, FamilyModel model) : DocOperation<DefaultOperationSettings>(new DefaultOperationSettings()) {
    public static void ApplyViews(GenericForm form, FamilyModelVisibilityViews? desired) {
        if (desired is null) return;
        var visibility = form.GetVisibility();
        if (desired.PlanRcp is { } plan) visibility.IsShownInPlanRCPCut = plan;
        if (desired.FrontBack is { } front) visibility.IsShownInFrontBack = front;
        if (desired.LeftRight is { } side) visibility.IsShownInLeftRight = side;
        if (desired.OnlyWhenCut is { } cut && visibility.IsShownOnlyWhenCut != cut) visibility.IsShownOnlyWhenCut = cut;
        if (desired.Coarse is { } coarse) visibility.IsShownInCoarse = coarse;
        if (desired.Medium is { } medium) visibility.IsShownInMedium = medium;
        if (desired.Fine is { } fine) visibility.IsShownInFine = fine;
        form.SetVisibility(visibility);
    }

    public override string Description => $"Bind visibility of {bindings.Length} elements";

    public override OperationLog Execute(FamilyDocument doc, FamilyProcessingContext ctx, OperationContext g) {
        var logs = new List<LogEntry>();
        foreach (var (slug, section, parameter) in bindings) {
            try {
                var elements = DeleteByName.FindElements(doc, section, section switch {
                    "forms" => model.Forms[slug], "nested" => model.Nested[slug], _ => model.Details[slug]
                });
                foreach (var element in elements) {
                    var visible = element.get_Parameter(BuiltInParameter.IS_VISIBLE_PARAM) ?? throw new InvalidOperationException("No IS_VISIBLE_PARAM.");
                    FamilyRefs.Associate(doc, visible, parameter, logs, slug);
                }
            } catch (Exception ex) { logs.Add(new LogEntry(slug).Error(ex)); }
        }
        return new OperationLog(this.Name, logs);
    }
}
