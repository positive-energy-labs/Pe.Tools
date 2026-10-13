// Read-only. Walks one run: the selection's system if something is selected, otherwise the system with the most
// elements. Reports each fitting with connector flow and the loss parameter it carries, or null when it carries none.

public sealed class InspectRun : PeScriptContainer
{
    public override void Execute()
    {
        if (doc == null) { Result(new { error = "No active document." }); return; }

        var system = FromSelection() ?? Probe.DuctSystems(doc)
            .OrderByDescending(s => s.DuctNetwork?.Size ?? 0)
            .FirstOrDefault();
        if (system == null) { Result(new { unavailable = "This document has no duct systems." }); return; }

        var fittings = (system.DuctNetwork?.Cast<Element>() ?? Enumerable.Empty<Element>())
            .OfType<FamilyInstance>()
            .Where(fi => fi.Category?.Id.Value == (long)BuiltInCategory.OST_DuctFitting)
            .Take(Probe.MaxFittingsPerRun)
            .Select(fi => new
            {
                id = Probe.IdOf(fi),
                name = Probe.NameOf(fi),
                loss = Probe.LossParameter(fi)?.AsDouble(),
                lossParameter = Probe.LossParameter(fi)?.Definition.Name,
                connectors = Probe.Connectors(fi).Select(c => new { direction = c.Direction.ToString(), flow = SafeFlow(c) }).ToList()
            })
            .ToList();

        ThrowIfCancelled();
        Result(new
        {
            system = new { id = Probe.IdOf(system), name = system.Name },
            fittingCount = fittings.Count,
            withLoss = fittings.Count(f => f.loss.HasValue),
            fittings,
            note = fittings.Any(f => f.loss.HasValue) ? null : "No fitting in this system exposes a loss parameter named in checks.json."
        });
    }

    private MechanicalSystem FromSelection()
    {
        foreach (var id in selection)
        {
            var e = doc.GetElement(id);
            if (e is MechanicalSystem ms) return ms;
            if (e is MEPCurve mc && mc.MEPSystem is MechanicalSystem s) return s;
            if (e is FamilyInstance fi)
            {
                var c = Probe.Connectors(fi).Select(x => x.MEPSystem).OfType<MechanicalSystem>().FirstOrDefault();
                if (c != null) return c;
            }
        }
        return null;
    }

    private static double? SafeFlow(Connector c)
    {
        try { return c.Flow; } catch { return null; }
    }
}
