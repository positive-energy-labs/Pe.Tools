using Pe.Revit.Extensions.FamDocument;
using Pe.Shared.RevitData.Families;

namespace Pe.Revit.FamilyFoundry.Operations;

/// <summary>Create named reference planes: normal, numeric seed from the origin, `Is Reference`, subcategory.</summary>
public sealed class MakeRefPlanes((string Name, FamilyModelRefPlane Spec)[] planes) : DocOperation<DefaultOperationSettings>(new DefaultOperationSettings()) {
    public override string Description => $"Create {planes.Length} reference planes: {string.Join(", ", planes.Select(p => p.Name))}";

    public override OperationLog Execute(FamilyDocument doc, FamilyProcessingContext ctx, OperationContext g) {
        var logs = new List<LogEntry>();
        foreach (var (name, spec) in planes) {
            try {
                if (FamilyRefs.FindPlane(doc, name) is not null) { logs.Add(new LogEntry(name).Skip("Already exists.")); continue; }
                var normal = FamilyRefs.Direction(spec.Normal);
                var (bubble, free, cut) = FamilyRefs.PlaneEndpoints(normal, normal * FamilyRefs.Feet(doc, spec.At));
                var view = FamilyRefs.ViewForPlaneCreation(doc, normal);
                var rp = doc.Document.FamilyCreate.NewReferencePlane(bubble, free, cut, view);
                rp.Name = name;
                _ = rp.get_Parameter(BuiltInParameter.ELEM_REFERENCE_NAME)?.Set((int)Strength(spec.IsReference ?? RefStrength.NotAReference));
                if (spec.Subcategory is { } sub) {
                    var parent = doc.Document.Settings.Categories.get_Item(BuiltInCategory.OST_CLines);
                    var category = parent.SubCategories.Cast<Category>().FirstOrDefault(c => c.Name == sub) ?? doc.Document.Settings.Categories.NewSubcategory(parent, sub);
                    _ = rp.get_Parameter(BuiltInParameter.CLINE_SUBCATEGORY)?.Set(category.Id);
                }
                logs.Add(new LogEntry(name).Success($"Created {spec.Normal} @ {spec.At}."));
            } catch (Exception ex) { logs.Add(new LogEntry(name).Error(ex)); }
        }
        return new OperationLog(this.Name, logs);
    }

    /// <summary>ELEM_REFERENCE_NAME integer set, by name of the enum member (RpStrength in the snapshots mirrors it).</summary>
    internal static int Strength(RefStrength s) => s switch {
        RefStrength.Left => 0, RefStrength.CenterLeftRight => 1, RefStrength.Right => 2, RefStrength.Front => 3,
        RefStrength.CenterFrontBack => 4, RefStrength.Back => 5, RefStrength.Bottom => 6, RefStrength.CenterElevation => 7,
        RefStrength.Top => 8, RefStrength.StrongReference => 13, RefStrength.WeakReference => 14, _ => 12
    };
}
