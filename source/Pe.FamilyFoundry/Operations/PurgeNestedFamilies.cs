using Pe.Extensions.FamDocument;
using Pe.Global.PolyFill;

namespace Pe.FamilyFoundry.Operations;

public class PurgeNestedFamilies : DocOperation<DefaultOperationSettings> {
    public PurgeNestedFamilies(DefaultOperationSettings settings) : base(settings) {
    }

    public override string Description => "Delete unused nested families from the family";

    public override OperationLog Execute(FamilyDocument doc,
        FamilyProcessingContext processingContext,
        OperationContext groupContext) {
        var logs = new List<LogEntry>();

        var allFamilies = new FilteredElementCollector(doc)
            .OfClass(typeof(Family))
            .Cast<Family>()
            .Where(f => f.Name != "")
            .Where(f => GetBuiltInCategory(f.FamilyCategory) != BuiltInCategory.OST_LevelHeads)
            .Where(f => GetBuiltInCategory(f.FamilyCategory) != BuiltInCategory.OST_SectionHeads)
            .ToList();
        if (allFamilies.Count == 0) return new OperationLog(this.Name, logs);

        var usedFamilyNames = new FilteredElementCollector(doc)
            .OfClass(typeof(FamilyInstance))
            .Cast<FamilyInstance>()
            .Where(fi => fi.Symbol?.Family != null)
            .Select(fi => fi.Symbol.Family.Name)
            .ToHashSet();

        var unusedFamilies = allFamilies.Where(f => !usedFamilyNames.Contains(f.Name)).ToList();
        if (unusedFamilies.Count == 0) return new OperationLog(this.Name, logs);

        foreach (var family in unusedFamilies) {
            var familyName = family.Name?.Trim() ?? "";
            try {
                var dependentCount = family.GetDependentElements(null).Count;
                if (dependentCount > 100) continue; // skip anomalies

                _ = doc.Document.Delete(family.Id);
                logs.Add(new LogEntry(familyName).Success("Deleted"));
            } catch (Exception ex) {
                logs.Add(new LogEntry(familyName).Error(ex));
            }
        }

        return new OperationLog(this.Name, logs);
    }

    private static BuiltInCategory GetBuiltInCategory(Category? category) {
        if (category == null) return BuiltInCategory.INVALID;

        var rawValue = category.Id.Value();
        var builtInCategory = (BuiltInCategory)rawValue;
        return Enum.IsDefined(typeof(BuiltInCategory), builtInCategory)
            ? builtInCategory
            : BuiltInCategory.INVALID;
    }
}