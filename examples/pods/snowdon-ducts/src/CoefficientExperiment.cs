// MUTATES THE MODEL. Refuses unless the document title carries a sandbox marker (checks.json: sandboxTitleMarkers).
// Picks the first discovered fitting that exposes a writable loss parameter, changes it by ExperimentDelta, and
// reads it back from a fresh element lookup. When no fitting qualifies it reports "unavailable" and changes nothing.

public sealed class CoefficientExperiment : PeScriptContainer
{
    public override void Execute()
    {
        if (doc == null) { Result(new { error = "No active document." }); return; }
        if (!Probe.IsSandbox(doc))
        {
            Result(new { refused = $"'{doc.Title}' is not marked as a copy. Open a disposable copy of the sample and retry." });
            return;
        }

        var target = Probe.Fittings(doc)
            .Select(fi => new { fi, p = Probe.LossParameter(fi) })
            .FirstOrDefault(x => x.p != null && !x.p.IsReadOnly);
        if (target == null)
        {
            Result(new { unavailable = "No duct fitting in this document exposes a writable loss parameter. Nothing was changed." });
            return;
        }

        var id = target.fi.Id;
        var name = target.p.Definition.Name;
        var before = target.p.AsDouble();
        using (var t = new Transaction(doc, "Snowdon coefficient experiment"))
        {
            t.Start();
            target.p.Set(before + Probe.ExperimentDelta);
            t.Commit();
        }

        // Independent readback: look the element up again rather than trusting the parameter just set.
        var after = doc.GetElement(id).LookupParameter(name)?.AsDouble();
        Result(new
        {
            fittingId = id.Value,
            fitting = Probe.NameOf(target.fi),
            parameter = name,
            before,
            requested = before + Probe.ExperimentDelta,
            readback = after,
            applied = after.HasValue && System.Math.Abs(after.Value - (before + Probe.ExperimentDelta)) < 1e-9
        });
    }
}
