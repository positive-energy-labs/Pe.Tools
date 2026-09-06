using Pe.Revit.Extensions.FamDocument;

namespace Pe.Revit.FamilyFoundry.Operations;

/// <summary>Create the named family types that do not exist yet. `EnsureDefaultType` first (gotcha 11).</summary>
public sealed class CreateFamilyTypes(string[] names) : DocOperation<DefaultOperationSettings>(new DefaultOperationSettings()) {
    public override string Description => $"Create family types: {string.Join(", ", names)}";

    public override OperationLog Execute(FamilyDocument famDoc, FamilyProcessingContext processingContext, OperationContext groupContext) {
        var fm = famDoc.FamilyManager;
        var existing = fm.Types.Cast<FamilyType>().Select(t => t.Name).ToHashSet(StringComparer.Ordinal);
        var logs = new List<LogEntry>();
        foreach (var name in names) {
            if (existing.Contains(name)) { logs.Add(new LogEntry(name).Skip("Already exists.")); continue; }
            try {
                _ = fm.NewType(name);
                logs.Add(new LogEntry(name).Success("Created."));
            } catch (Exception ex) { logs.Add(new LogEntry(name).Error(ex)); }
        }
        return new OperationLog(this.Name, logs);
    }
}
