using Pe.Revit.Extensions.FamDocument;
using Pe.Revit.Global.PolyFill;

namespace Pe.FamilyFoundry.Operations;

public class PurgeModelLines(DefaultOperationSettings settings) : DocOperation<DefaultOperationSettings>(settings) {
    public override string Description => "Delete unused model lines from the family";

    public override OperationLog Execute(FamilyDocument famDoc,
        FamilyProcessingContext processingContext,
        OperationContext groupContext) {
        // make settings later?
        var deleteGroupedLines = true;
        var deleteAlignedLines = true;

        var lines = new FilteredElementCollector(famDoc)
            .WhereElementIsNotElementType()
            .OfCategory(BuiltInCategory.OST_Lines)
            .OfClass(typeof(CurveElement))
            .OfType<CurveElement>()
            .Distinct()
            .Select(e => {
                var element = famDoc.Document.GetElement(e.Id);
                var groupId = element?.GroupId.Value() ?? -1;
                var alignments = e.GetDependentElements(new ElementClassFilter(typeof(Dimension)))
                    .Select(d => famDoc.Document.GetElement(d))
                    .OfType<Dimension>()
                    .Where(d => d is not AngularDimension)
                    .Where(d => d is not SpotDimension)
#if REVIT2025 || REVIT2026
                    .Where(d => d is not LinearDimension)
                    .Where(d => d is not RadialDimension)
                    .Where(d => d is not ArcLengthDimension)
#endif
                    .ToList();

                return (Line: e, GroupId: groupId, Alignments: alignments);
            })
            .ToList();

        var (grouped, aligned, other) = (0, 0, 0);
        var deletedIds = new HashSet<ElementId>();

        foreach (var entry in lines) {
            try {
                var line = entry.Line;
                if (deletedIds.Contains(line.Id)) continue;
                var groupId = entry.GroupId;
                var alignments = entry.Alignments;

                var shouldDeleteGrouped = deleteGroupedLines && groupId > 0;
                var shouldDeleteAligned = deleteAlignedLines && alignments.Count != 0;
                var isOther = !(groupId > 0) && alignments.Count == 0;
                // Keep "other" line deletion tied to purge intent; do nothing when all deletion flags are off.
                var shouldDeleteOther = isOther && (deleteGroupedLines || deleteAlignedLines);
                var shouldDelete = shouldDeleteGrouped || shouldDeleteAligned || shouldDeleteOther;
                if (!shouldDelete) continue;

                var deleted = famDoc.Document.Delete(line.Id);
                foreach (var id in deleted) deletedIds.Add(id);
                if (shouldDeleteAligned) aligned++;
                else if (shouldDeleteGrouped) grouped++;
                else other++;
            } catch (Autodesk.Revit.Exceptions.InvalidObjectException) {
                // Element was cascade-deleted when a group mate was deleted
            }
        }


        List<LogEntry> logs = [
            new LogEntry("Grouped").Success($"Deleted {grouped} grouped lines"),
            new LogEntry("Aligned").Success($"Deleted {aligned} aligned lines"),
            new LogEntry("Other").Success($"Deleted {other} other lines")
        ];


        return new OperationLog(this.Name, logs);
    }
}