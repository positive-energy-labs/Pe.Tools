using Newtonsoft.Json;
using Newtonsoft.Json.Linq;
using NUnit.Framework;
using Pe.Revit.Partition;
using Pe.Revit.Space;

namespace Pe.Partition.Tests;

// network.py reads this projection. Bench owns fixture loading and solving; both evaluation
// views receive the same input and answer, including proposals, holes and the selected knobs.
[TestFixture]
public sealed class RailsRun {
    internal static void Write(string directory, string name, PartitionInput input, PartitionAnswer answer, string? networkDirectory) {
        var rails = Rails.From(input);
        Directory.CreateDirectory(directory);
        File.WriteAllText(Path.Combine(directory, "input.json"), JsonConvert.SerializeObject(input));
        File.WriteAllText(Path.Combine(directory, "rails.json"), JsonConvert.SerializeObject(rails));
        if (networkDirectory is null) return;
        var net = Rails.Network(rails, input.ZoneLoops, OpeningEvidence.From(input));

        var zoneGeom = Solve.GeometryOf(input.ZoneLoops).EnvelopeInternal;
        zoneGeom.ExpandBy(6);
        bool Near(double[] p) => Enumerable.Range(0, p.Length / 2).Any(k => zoneGeom.Contains(p[2 * k], p[(2 * k) + 1]));
        var doc = new JObject {
            ["name"] = name,
            ["ms"] = answer.Ms,
            ["zone"] = JToken.FromObject(input.ZoneLoops),
            ["rails"] = JToken.FromObject(rails.Where(r => Near([.. r.A, .. r.B])).Select(r => new { r.A, r.B, r.ThicknessFt, r.Source })),
            ["segments"] = JToken.FromObject(net.Segments.Select(s => new { s.A, s.B, Kind = s.Kind.ToString(), s.Out })),
            ["openings"] = JToken.FromObject(net.Openings.Select(o => new { o.A, o.B, o.WidthFt, Kind = o.Kind.ToString(), o.DoorPieces, o.HeaderFraction, o.WallFraction })),
            ["rooms"] = JToken.FromObject(answer.Rooms.Select(r => new { r.Loop, r.Holes, Disposition = r.Disposition.ToString(), r.Reason, r.AreaSqft })),
            ["accounting"] = JToken.FromObject(answer.Accounting),
            ["ink"] = JToken.FromObject(input.Knee.Elements.SelectMany(e => e.Pieces.Where(Near).Select(p => new {
                c = e.Handle.Kind == PrimKind.Curve2D ? e.Handle.Layer : e.Handle.Category, p }))),
        };
        File.WriteAllText(Path.Combine(networkDirectory, name + ".json"), doc.ToString(Formatting.None));
    }

    [Test]
    public void Captured_zone_holes_reach_solver_accounting_without_rewriting_the_capture() {
        var stamp = new Stamp("doc", 0, Stamp.HostInternalFt, DateTime.UnixEpoch, [], true, new Resolved([], [], [], [], []));
        var knee = new SliceAnswer(stamp, new Searched(0, 0, 0, 0, 0), [], 0, 0);
        var locked = new RoomProposal(RoomProposal.LockedPrefix + "room", "kept", "", [[1, 1, 3, 1, 3, 3, 1, 3]]);
        var level = new PartitionInput(knee, knee, [], 42, Knobs.Default, [], "authored", [locked]);
        var zone = JObject.Parse("""
            {"Outer":[[100,200],[120,200],[120,220],[100,220]],
             "Holes":[[[104,205],[108,205],[108,211],[104,211]]]}
            """);
        var input = Bench.WithZone(level, zone);
        var answer = Solve.RunRails(input, RecordedProbes.For(null).For(input));
        Assert.That(answer.Accounting.ZoneSqft, Is.EqualTo(376).Within(1e-6), "400 sqft minus a literal 4 by 6 hole");
        Assert.That(input.ZoneLoops[1], Is.EqualTo(new double[] {104, 205, 108, 205, 108, 211, 104, 211}), "host XY feet stay untranslated");
        Assert.That(input.LevelZ, Is.EqualTo(42));
        Assert.That(input.Proposals.Single(), Is.SameAs(locked), "zone selection does not rewrite locked proposals");
        Assert.That(level.ZoneLoops, Is.Empty, "selection must not mutate the captured level");
    }
}
