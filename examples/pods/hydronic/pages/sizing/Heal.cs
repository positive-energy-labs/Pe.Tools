public sealed class Heal : PeScriptContainer
{
    public override void Execute()
    {
        var edits = Arg<Newtonsoft.Json.Linq.JArray>("edits");
        var prepared = edits.Select(edit => {
            var uid = (string)edit["uniqueId"];
            var pipe = doc.GetElement(uid) as Autodesk.Revit.DB.Plumbing.Pipe;
            if (pipe == null) throw new Exception("Pipe no longer exists: " + uid);
            var diameter = (double)edit["diameter"];
            var expected = (double)edit["expected"];
            if (double.IsNaN(diameter) || double.IsInfinity(diameter) || diameter <= 0)
                throw new Exception("Diameter must be positive, in mm: " + uid);
            var parameter = pipe.get_Parameter(BuiltInParameter.RBS_PIPE_DIAMETER_PARAM);
            if (parameter == null || parameter.IsReadOnly) throw new Exception("Diameter is not writable: " + uid);
            if (Math.Abs(parameter.AsDouble() * 304.8 - expected) > 0.11)
                throw new Exception("Diameter changed. Read the system again: " + uid);
            return new { pipe, parameter, diameter, expected };
        }).ToList();
        foreach (var edit in prepared)
        {
            ThrowIfCancelled();
            if (!edit.parameter.Set(edit.diameter / 304.8)) throw new Exception("Diameter refused: " + edit.pipe.UniqueId);
        }
        doc.Regenerate();
        var rows = prepared.Select(edit => new {
            elementId = edit.pipe.Id.Value, uniqueId = edit.pipe.UniqueId,
            before = edit.expected, after = edit.parameter.AsDouble() * 304.8
        }).ToList();
        if (rows.Where((row, i) => Math.Abs(row.after - prepared[i].diameter) > 0.11).Any())
            throw new Exception("Revit did not keep the requested diameters.");
        Result(new { rows });
    }
}
