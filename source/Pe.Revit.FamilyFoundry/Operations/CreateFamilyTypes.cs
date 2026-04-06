using Pe.Revit.Extensions.FamDocument;
using Pe.Revit.FamilyFoundry.OperationGroups;
using Pe.Revit.FamilyFoundry.OperationSettings;

namespace Pe.Revit.FamilyFoundry.Operations;

/// <summary>
///     Creates missing family types referenced in SetKnownParamsSettings.PerTypeAssignmentsTable columns.
///     Runs as a DocOperation (once per family) to create all missing types upfront.
/// </summary>
internal class CreateFamilyTypes(SetKnownParamsSettings settings, KnownParamsSharedState sharedState)
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

        sharedState.CreatedDefaultPlaceholderType = HasOnlyImplicitDefaultPlaceholder(
            fm,
            referencedTypeNames);

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

    private static bool HasOnlyImplicitDefaultPlaceholder(
        FamilyManager fm,
        IReadOnlyCollection<string> referencedTypeNames
    ) {
        if (fm.Types.Size == 0)
            return true;

        var familyTypes = fm.Types.Cast<FamilyType>().ToList();
        if (familyTypes.Count != 1)
            return false;

        var soleType = familyTypes[0];
        if (string.IsNullOrWhiteSpace(soleType.Name))
            return true;

        return string.Equals(soleType.Name, "Default", StringComparison.Ordinal)
               && !referencedTypeNames.Contains("Default");
    }
}
