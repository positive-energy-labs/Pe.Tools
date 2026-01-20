using Pe.Extensions.FamDocument;
using System.ComponentModel;
using System.ComponentModel.DataAnnotations;

namespace Pe.FamilyFoundry.Operations;

public class PurgeReferencePlanes : DocOperation<PurgeReferencePlanesSettings> {
    public PurgeReferencePlanes(PurgeReferencePlanesSettings settings) : base(settings) { }

    public override string Description =>
        "Deletes reference planes in the Family which are not used by anything important";

    public override OperationLog Execute(FamilyDocument doc,
        FamilyProcessingContext processingContext,
        OperationContext groupContext) {
        var logs = new List<LogEntry>();

        bool deletedAny;
        do
            deletedAny = this.DeleteUnusedReferencePlanes(doc, logs);
        while (deletedAny);

        return new OperationLog(this.Name, logs);
    }

    private bool DeleteUnusedReferencePlanes(FamilyDocument doc, List<LogEntry> logs) {
        var deleteCount = 0;

        var referencePlanes = new FilteredElementCollector(doc)
            .OfClass(typeof(ReferencePlane))
            .Cast<ReferencePlane>()
            .ToList();

        foreach (var refPlane in referencePlanes) {
            var planeName = refPlane.Name ?? $"RefPlane_{refPlane.Id}";

            if (this.IsImportantPlane(refPlane)) continue;

            var dependentElements = this.GetRelevantDependentElements(doc, refPlane);
            if (dependentElements.Count != 0) continue;

            try {
                _ = doc.Document.Delete(refPlane.Id);
                logs.Add(new LogEntry(planeName).Success("Deleted"));
                deleteCount++;
            } catch (Exception ex) {
                logs.Add(new LogEntry(planeName).Skip(ex.Message));
            }
        }

        return deleteCount > 0;
    }

    private bool IsImportantPlane(ReferencePlane refPlane) {
        if (refPlane.Pinned) return true;

        var isRefParam = refPlane.GetOrderedParameters()
            .FirstOrDefault(p => p.Definition.Name == "Is Reference");

        if (isRefParam == null) return false;

        var value = isRefParam.AsValueString();
        return value is not ("Not a Reference" or "Weak Reference");
    }

    private List<Element> GetRelevantDependentElements(FamilyDocument doc, ReferencePlane refPlane) {
        var dependentIds = refPlane.GetDependentElements(null);
        if (dependentIds == null || dependentIds.Count == 0) return [];

        var dependentElements = dependentIds
            .Where(id => id != refPlane.Id)
            .Select(doc.Document.GetElement)
            .Where(e => e != null)
            .ToList();

        if (this.Settings.SafeDelete) return dependentElements;

        // In unsafe mode, only keep dimensions that have parameter labels
        return dependentElements
            .Where(e => e is not Dimension dim || this.HasParameterLabel(dim))
            .ToList();
    }

    /// <summary>
    ///     Returns true if the dimension has a parameter label (is important).
    /// </summary>
    private bool HasParameterLabel(Dimension dimension) {
        try {
            return dimension.FamilyLabel != null;
        } catch {
            return true; // If we can't determine, assume it's important
        }
    }
}

public class PurgeReferencePlanesSettings : IOperationSettings {
    [Description(
        "If true, a reference plane will only be deleted if it has NO dependent elements. " +
        "If false, only dimensions with parameter labels are considered important dependencies.")]
    [Required]
    public bool SafeDelete { get; init; } = true;

    public bool Enabled { get; init; } = true;
}