using Pe.Extensions.FamDocument;
using Pe.FamilyFoundry.OperationSettings;

namespace Pe.FamilyFoundry.Operations;

/// <summary>
///     Creates missing family types referenced in SetKnownParamsSettings.PerTypeAssignmentsTable columns.
///     Runs as a DocOperation (once per family) to create all missing types upfront.
/// </summary>
public class CreateFamilyTypes(SetKnownParamsSettings settings)
    : DocOperation<SetKnownParamsSettings>(settings) {
    public override string Description =>
        "Create missing family types that are referenced in PerTypeAssignmentsTable columns.";

    public override OperationLog Execute(
        FamilyDocument famDoc,
        FamilyProcessingContext processingContext,
        OperationContext groupContext
    ) {
        var fm = famDoc.FamilyManager;

        var referencedTypeNames = this.Settings.GetReferencedFamilyTypeNames();

        if (referencedTypeNames.Count == 0) {
            return new OperationLog(this.Name, [
                new LogEntry("No types referenced").Skip("No PerTypeAssignmentsTable type columns found")
            ]);
        }

        // Get existing type names
        var existingTypeNames = fm.Types
            .Cast<FamilyType>()
            .Select(t => t.Name)
            .ToHashSet(StringComparer.Ordinal);

        // Find missing types
        var missingTypeNames = referencedTypeNames
            .Where(typeName => !existingTypeNames.Contains(typeName))
            .OrderBy(name => name, StringComparer.Ordinal)
            .ToList();

        if (missingTypeNames.Count == 0) {
            return new OperationLog(this.Name, [
                new LogEntry("All types exist").Skip("All referenced types already exist")
            ]);
        }

        // Ensure at least one type exists before creating new ones
        _ = famDoc.EnsureDefaultType();

        // Create missing types
        var logs = new List<LogEntry>();
        foreach (var typeName in missingTypeNames) {
            try {
                _ = fm.NewType(typeName);
                logs.Add(new LogEntry(typeName).Success($"Created family type '{typeName}'"));
            } catch (Exception ex) {
                logs.Add(new LogEntry(typeName).Error(ex));
            }
        }

        return new OperationLog(this.Name, logs);
    }
}
