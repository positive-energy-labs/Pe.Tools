// MUTATES THE MODEL. Refuses unless the document title carries a sandbox marker (checks.json: sandboxTitleMarkers).
// The key keeps its historical name; the experiment is a copy-only annotation. For each duct it writes the computed
// velocity (fpm) and calculated size into the built-in Comments parameter, then looks every duct up again and reports
// how many Comments now hold the written text. Comments is writable on every duct, so this works on any sample.
// The script owns its transaction (the Page requests NoTransaction).

public sealed class CoefficientExperiment : PeScriptContainer
{
    public const int MaxDucts = 500;
    public const string Prefix = "Pe: ";

    public override void Execute()
    {
        if (doc == null) { Result(new { error = "No active document." }); return; }
        if (!Probe.IsSandbox(doc))
        {
            Result(new { refused = $"'{doc.Title}' is not marked as a copy. Open a disposable copy of the sample and retry." });
            return;
        }

        var ducts = new FilteredElementCollector(doc).OfClass(typeof(Duct)).Cast<Duct>().Take(MaxDucts).ToList();
        if (ducts.Count == 0)
        {
            Result(new { unavailable = "This document has no ducts. Nothing was changed." });
            return;
        }

        var planned = new List<(ElementId id, string before, string text)>();
        foreach (var d in ducts)
        {
            ThrowIfCancelled();
            var comments = d.get_Parameter(BuiltInParameter.ALL_MODEL_INSTANCE_COMMENTS);
            if (comments == null || comments.IsReadOnly) continue;
            planned.Add((d.Id, comments.AsString() ?? "", Prefix + Describe(d)));
        }

        using (var t = new Transaction(doc, "Snowdon duct annotation experiment"))
        {
            t.Start();
            foreach (var p in planned)
                if (p.before != p.text) doc.GetElement(p.id).get_Parameter(BuiltInParameter.ALL_MODEL_INSTANCE_COMMENTS).Set(p.text);
            t.Commit();
        }

        // Independent readback: look each duct up again rather than trusting the parameter just set.
        var changed = planned.Count(p =>
            p.before != p.text &&
            doc.GetElement(p.id).get_Parameter(BuiltInParameter.ALL_MODEL_INSTANCE_COMMENTS)?.AsString() == p.text);
        var already = planned.Count(p => p.before == p.text);
        var sample = planned.Take(3).Select(p => new
        {
            ductId = p.id.Value,
            before = p.before,
            readback = doc.GetElement(p.id).get_Parameter(BuiltInParameter.ALL_MODEL_INSTANCE_COMMENTS)?.AsString()
        }).ToList();

        Result(new
        {
            parameter = "Comments",
            examined = ducts.Count,
            writable = planned.Count,
            changed,
            alreadyCurrent = already,
            applied = planned.Count > 0 && changed + already == planned.Count,
            sample
        });
    }

    private static string Describe(Duct d)
    {
        var size = d.get_Parameter(BuiltInParameter.RBS_CALCULATED_SIZE)?.AsString();
        var v = d.get_Parameter(BuiltInParameter.RBS_VELOCITY);
        var fpm = v != null && v.HasValue
            ? UnitUtils.ConvertFromInternalUnits(v.AsDouble(), UnitTypeId.FeetPerMinute).ToString("0")
            : null;
        return $"{(string.IsNullOrEmpty(size) ? "size n/a" : size)}, {(fpm == null ? "velocity n/a" : fpm + " fpm")}";
    }
}
