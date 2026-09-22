using Pe.Revit.Extensions.FamDocument;
using Pe.Revit.FamilyFoundry.Capture;

namespace Pe.Revit.FamilyFoundry.Operations;

/// <summary>Delete the exact native elements identified by the captured state used in reconciliation.</summary>
public sealed class DeleteByName(string section, object[] entries) : DocOperation<DefaultOperationSettings>(new DefaultOperationSettings()) {
    public override string Description => $"Delete {entries.Length} {section}";

    public override OperationLog Execute(FamilyDocument doc, FamilyProcessingContext ctx, OperationContext g) {
        var capture = new FamilyModelCapturer(doc);
        // Resolve the whole batch before deleting: positional line names can move and deletions can cascade.
        var targets = entries.SelectMany(entry => FindElements(doc, capture, section, entry)).Select(e => e.Id).Distinct().ToList();
        var logs = new List<LogEntry>();
        foreach (var id in targets) {
            if (doc.Document.GetElement(id) is null) continue;
            _ = doc.Document.Delete(id);
            logs.Add(new LogEntry($"{section}:{id}").Success("Deleted captured element."));
        }
        return new OperationLog(this.Name, logs);
    }

    public static IReadOnlyList<Element> FindElements(Document doc, string section, object entry) =>
        FindElements(doc, new FamilyModelCapturer(doc), section, entry);

    private static IReadOnlyList<Element> FindElements(Document doc, FamilyModelCapturer capture, string section, object entry) {
        if (section is not ("refPlanes" or "datums" or "refLines")) return capture.FindElements(entry);
        Element? element = section == "refLines" ? FamilyRefs.FindRefLine(doc, (string)entry) : FamilyRefs.FindPlane(doc, (string)entry);
        return element is not null ? [element] : throw new InvalidOperationException($"{section} '{entry}' was not found.");
    }
}
