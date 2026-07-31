using Newtonsoft.Json;
using Pe.Revit.Takeoff.Rhvac;

namespace Pe.Revit.Tests.LibraryBehavior.NoDocumentRuntime;

// The real-candidate eval runner: builds candidates from the committed takeoff TSV snapshot
// (eval/rhvac/project-a/takeoff/rooms_*.tsv + conventions.json, see Rhvac/README.md "Eval harness")
// and scores them against the committed oracle. Skips when no TSVs exist, so CI stays green
// without a snapshot. The one eval test allowed to write files: candidate.rooms.json (inspection
// artifact) and scorecard.{json,txt} land in the fixture dir and all are gitignored.
public sealed class RhvacProjectAEvalRun
{
    [Test]
    [Explicit("Operational eval gate; the committed bootstrap candidate intentionally fails.")]
    public void Score_current_candidate()
    {
        var fixtureDir = RhvacEvalTests.FindFixtureDir();
        var takeoffDir = Path.Combine(fixtureDir, "takeoff");
        var tsvPaths = Directory.Exists(takeoffDir)
            ? Directory.GetFiles(takeoffDir, "rooms_*.tsv")
            : Array.Empty<string>();
        if (tsvPaths.Length == 0)
            Assert.Ignore($"No takeoff TSVs at {takeoffDir}; run a takeoff first (Rhvac/README.md).");

        var profileName = Environment.GetEnvironmentVariable("PE_EVAL_PROFILE") ?? "bootstrap";
        var levels = tsvPaths
            .Select(path => RhvacCandidateBuilder.ParseTsv(File.ReadAllText(path)))
            .OrderBy(level => level.Elevation)
            .ToList();
        var conventions = RhvacCandidateBuilder.LoadConventions(Path.Combine(fixtureDir, "conventions.json"));
        var candidates = RhvacCandidateBuilder.Build(levels, conventions);
        File.WriteAllText(
            Path.Combine(fixtureDir, "candidate.rooms.json"),
            JsonConvert.SerializeObject(candidates, Formatting.Indented)
        );

        var card = RhvacEval.Score(
            candidates,
            RhvacEval.LoadOracle(Path.Combine(fixtureDir, "oracle.extract.json")),
            RhvacEval.LoadMap(Path.Combine(fixtureDir, "room-map.json")),
            RhvacEval.LoadTolerances(Path.Combine(fixtureDir, "tolerances.json"), profileName)
        );

        File.WriteAllText(Path.Combine(fixtureDir, "scorecard.json"), card.ToJson());
        var text = card.ToText();
        File.WriteAllText(Path.Combine(fixtureDir, "scorecard.txt"), text);
        TestContext.Out.WriteLine(text);
        Assert.That(
            card.Pass,
            Is.True,
            $"project-a eval failed profile '{profileName}'. Read {Path.Combine(fixtureDir, "scorecard.txt")}."
        );
    }
}
