using Pe.Revit.Extensions.FamDocument;
using Pe.Revit.FamilyFoundry.Reconcile;
using Pe.Shared.RevitData.Families;

namespace Pe.Revit.FamilyFoundry.Operations;

/// <summary>
///     Delete the current-document elements a section's entries describe. Planes and lines resolve by Name;
///     slug sections resolve by the same identity projection the diff used (a dimension by its label and
///     references, a form by its sketch plane, a nested instance by family+type, an array by its label, a
///     connector by domain and `on` plane). The `Before` objects come from the captured current document.
/// </summary>
public sealed class DeleteByName(string section, object[] entries) : DocOperation<DefaultOperationSettings>(new DefaultOperationSettings()) {
    public override string Description => $"Delete {entries.Length} {section}";

    public override OperationLog Execute(FamilyDocument doc, FamilyProcessingContext ctx, OperationContext g) {
        var logs = new List<LogEntry>();
        // Resolve before deleting: a positional line key changes when an earlier line disappears.
        var targets = entries.Select(entry => (Entry: entry, Element: Find(doc, section, entry))).ToArray();
        foreach (var (entry, element) in targets) {
            var key = Describe(entry);
            try {
                if (element is null) { logs.Add(new LogEntry(key).Skip("Not found in the document.")); continue; }
                _ = doc.Document.Delete(element.Id);
                logs.Add(new LogEntry(key).Success("Deleted."));
            } catch (Exception ex) { logs.Add(new LogEntry(key).Error(ex)); }
        }
        return new OperationLog(this.Name, logs);
    }

    private static string Describe(object entry) => entry switch {
        string s => s, FamilyModelDim d => $"dim {d.Label ?? string.Join("|", d.Between)}", FamilyModelForm f => $"form on {f.SketchPlane}",
        FamilyModelNested n => $"{n.Family}:{n.Type}", FamilyModelArray a => $"array {a.Label}", FamilyModelConnector c => FamilyReconciler.ConnectorKey(c),
        FamilyModelDetail x => $"detail {x.Family ?? "curves"} in {x.View}", _ => entry.GetType().Name
    };

    // ponytail: name-and-shape lookup; the capture line's element map replaces this when it lands.
    public static Element? Find(Document doc, string section, object entry) => section switch {
        "refPlanes" or "datums" => FamilyRefs.FindPlane(doc, (string)entry),
        "refLines" => FamilyRefs.FindRefLine(doc, (string)entry),
        "dimensions" => new FilteredElementCollector(doc).OfClass(typeof(Dimension)).Cast<Dimension>().FirstOrDefault(d => Matches(doc, d, (FamilyModelDim)entry)),
        "forms" => new FilteredElementCollector(doc).OfClass(typeof(Extrusion)).Cast<Extrusion>().FirstOrDefault(e => e.Sketch?.SketchPlane?.Name == ((FamilyModelForm)entry).SketchPlane && !IsStub(e)),
        "nested" => PlaceNested.Find(doc, (FamilyModelNested)entry),
        "arrays" => new FilteredElementCollector(doc).OfClass(typeof(LinearArray)).Cast<LinearArray>().FirstOrDefault(a => a.Label?.Definition.Name == ((FamilyModelArray)entry).Label.Replace("param:", "")),
        "connectors" => new FilteredElementCollector(doc).OfClass(typeof(ConnectorElement)).Cast<ConnectorElement>().FirstOrDefault(c => Matches(doc, c, (FamilyModelConnector)entry)),
        "details" => ((FamilyModelDetail)entry).Family is { } family
            ? new FilteredElementCollector(doc).OfClass(typeof(FamilyInstance)).Cast<FamilyInstance>().FirstOrDefault(i => i.Symbol.Family.Name == family)
            : null,
        _ => null
    };

    // ponytail: a connector stub is a one-inch cube; a form that small is never authored geometry
    private static bool IsStub(Extrusion e) {
        var box = e.get_BoundingBox(null);
        return box is not null && (box.Max - box.Min).GetLength() < 0.2;
    }

    private static bool Matches(Document doc, Dimension d, FamilyModelDim spec) {
        if (spec.Label is { } label) return d.FamilyLabel?.Definition.Name == label;
        var names = Enumerable.Range(0, d.References.Size).Select(i => doc.GetElement(d.References.get_Item(i))?.Name).ToHashSet(StringComparer.Ordinal);
        return names.SetEquals(spec.Between);
    }

    private static bool Matches(Document doc, ConnectorElement c, FamilyModelConnector spec) {
        if (c.Domain.ToString() != $"Domain{spec.Domain}" && !c.Domain.ToString().EndsWith(spec.Domain.ToString(), StringComparison.Ordinal)) return false;
        var (_, plane) = FamilyRefs.Resolve(doc, spec.On);
        var origin = c.Origin;
        return Math.Abs(Math.Abs(c.CoordinateSystem.BasisZ.Normalize().DotProduct(plane.Normal.Normalize())) - 1) < 1e-4
               && Math.Abs((origin - plane.Origin).DotProduct(plane.Normal.Normalize())) < 0.2; // stub depth tolerance
    }
}
