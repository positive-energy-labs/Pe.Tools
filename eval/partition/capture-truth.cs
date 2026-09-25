// Truth capture for the partition bench (rails brief, W3). A pea script, read-only. Not run tonight.
//
// kaitpw draws the correct rooms as plain Filled Regions (any type, no PE role written) on a plan view
// named "Rooms Truth - <level>" (one view per level, duplicate the zoning plan, draw, never partition it).
// This script returns every such view with its role-less regions as flat x,y loops in host feet, the same
// frame as PartitionInput and the fixture answers. Save with eval/partition/truth-save.py, which writes one
// .private/fixtures/<project>/truth/<level>.json per view.
//
//   pea script execute --file eval/partition/capture-truth.cs --permission-mode ReadOnly --actor human `
//       --bridge-session-id <bridge> --open-document-id <openId> > .artifacts/tmp/truth-raw.json
//   python eval/partition/truth-save.py .artifacts/tmp/truth-raw.json <project> [<fixture root>]
using Autodesk.Revit.DB;
using System.Collections.Generic;
using System.Linq;
var Prefixes = new[] { "Rooms Truth - ", "Room Truth - " };   // kaitpw named the first one singular
var role = new Guid("b7e0c1d4-51aa-4a01-9f4e-2f6f1a0c9001");   // TakeoffCarriers.RoleGuid: ours carry it, truth does not
var views = new List<object>();
foreach (var view in new FilteredElementCollector(doc).OfClass(typeof(ViewPlan)).Cast<ViewPlan>()
             .Where(v => !v.IsTemplate && Prefixes.Any(p => v.Name.StartsWith(p))))
{
    var rooms = new List<object>();
    foreach (var fr in new FilteredElementCollector(doc, view.Id).OfClass(typeof(FilledRegion)).Cast<FilledRegion>())
    {
        if (!string.IsNullOrEmpty(fr.get_Parameter(role)?.AsString())) continue;
        var loops = fr.GetBoundaries().Select(loop => loop.SelectMany(curve => {
            var t = curve.Tessellate();
            return t.Take(t.Count - 1).SelectMany(p => new[] { p.X, p.Y });
        }).ToArray()).Where(l => l.Length >= 6).ToList();
        if (loops.Count > 0) rooms.Add(new { elementId = fr.Id.Value, loops });
    }
    views.Add(new {
        view = view.Name, level = view.Name.Substring(Prefixes.First(p => view.Name.StartsWith(p)).Length), levelZ = view.GenLevel?.Elevation,
        document = doc.PathName, capturedUtc = DateTime.UtcNow, rooms
    });
}
Result(new { views });
