using Pe.Revit.Extensions.FamDocument;
using Pe.Revit.FamilyFoundry.OperationGroups;
using Pe.Revit.FamilyFoundry.OperationSettings;

namespace Pe.Revit.FamilyFoundry.Operations;

/// <summary>
///     Cleans up placeholder family types introduced only to enable downstream type creation.
/// </summary>
internal sealed class FinalizeFamilyTypes(SetKnownParamsSettings settings, KnownParamsSharedState sharedState)
    : DocOperation<SetKnownParamsSettings>(settings) {
    private const string PlaceholderTypeName = "Default";

    public override string Description =>
        "Delete placeholder default family types that were auto-created only to enable authored type creation.";

    public override OperationLog Execute(
        FamilyDocument famDoc,
        FamilyProcessingContext processingContext,
        OperationContext groupContext
    ) {
        var logs = new List<LogEntry>();
        if (!sharedState.CreatedDefaultPlaceholderType) {
            logs.Add(new LogEntry("Finalize family types").Skip("No placeholder default family type was auto-created."));
            return new OperationLog(this.Name, logs);
        }

        var referencedTypeNames = this.Settings.GetReferencedFamilyTypeNames();
        if (referencedTypeNames.Contains(PlaceholderTypeName)) {
            logs.Add(new LogEntry("Finalize family types").Skip("Placeholder type name is explicitly referenced by the profile."));
            return new OperationLog(this.Name, logs);
        }

        var fm = famDoc.FamilyManager;
        var placeholderType = fm.Types
            .Cast<FamilyType>()
            .FirstOrDefault(type => string.Equals(type.Name, PlaceholderTypeName, StringComparison.Ordinal));
        if (placeholderType == null) {
            logs.Add(new LogEntry("Finalize family types").Skip("Placeholder default family type was already absent."));
            return new OperationLog(this.Name, logs);
        }

        var preferredType = fm.Types
            .Cast<FamilyType>()
            .Where(type => !string.Equals(type.Name, PlaceholderTypeName, StringComparison.Ordinal))
            .OrderBy(type => referencedTypeNames.Contains(type.Name) ? 0 : 1)
            .ThenBy(type => type.Name, StringComparer.Ordinal)
            .FirstOrDefault();
        if (preferredType == null) {
            logs.Add(new LogEntry("Finalize family types").Skip("No authored family type exists to replace the placeholder default."));
            return new OperationLog(this.Name, logs);
        }

        try {
            fm.CurrentType = placeholderType;
            fm.DeleteCurrentType();
            fm.CurrentType = preferredType;
            logs.Add(new LogEntry("Finalize family types")
                .Success($"Deleted placeholder family type '{PlaceholderTypeName}' and set current type to '{preferredType.Name}'."));
        } catch (Exception ex) {
            logs.Add(new LogEntry("Finalize family types").Error(ex));
        }

        return new OperationLog(this.Name, logs);
    }
}
