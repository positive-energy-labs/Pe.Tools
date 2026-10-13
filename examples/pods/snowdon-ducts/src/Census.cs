// Read-only. Lists duct systems with element counts and flow, and the warnings that mention duct elements.
// Every number is read from the open document; nothing is remembered between runs.

public sealed class Census : PeScriptContainer
{
    public override void Execute()
    {
        if (doc == null) { Result(new { error = "No active document." }); return; }

        var systems = new List<object>();
        foreach (var s in Probe.DuctSystems(doc).OrderBy(s => s.Name).Take(Probe.MaxSystems))
        {
            ThrowIfCancelled();
            var elements = s.DuctNetwork?.Cast<Element>().ToList() ?? new List<Element>();
            systems.Add(new
            {
                id = Probe.IdOf(s),
                name = s.Name,
                type = doc.GetElement(s.GetTypeId())?.Name,
                elementCount = elements.Count,
                fittingCount = elements.Count(e => e.Category?.Id.Value == (long)BuiltInCategory.OST_DuctFitting),
                baseEquipment = s.BaseEquipment == null ? null : Probe.NameOf(s.BaseEquipment)
            });
        }

        var ductIds = new HashSet<long>(new FilteredElementCollector(doc).OfCategory(BuiltInCategory.OST_DuctCurves).ToElementIds().Select(i => i.Value));
        var warnings = doc.GetWarnings()
            .Where(w => w.GetFailingElements().Any(i => ductIds.Contains(i.Value)))
            .Take(50)
            .Select(w => new { text = w.GetDescriptionText(), elementIds = w.GetFailingElements().Select(i => i.Value).ToArray() })
            .ToList();

        Result(new
        {
            document = doc.Title,
            revitVersion,
            systemCount = Probe.DuctSystems(doc).Count(),
            listed = systems.Count,
            systems,
            ductWarnings = warnings
        });
    }
}
