using Pe.Revit.FamilyFoundry;
using Pe.Revit.FamilyFoundry.Apply;
using Pe.Revit.FamilyFoundry.Capture;
using Pe.Shared.RevitData.Families;

namespace Pe.Revit.Tests;

internal static class FamilyFoundryRoundtripHarness {
    public static FamilyModelRoundtripArtifact RunFamilyModelRoundtrip(
        Application application,
        string fixtureRelativePath,
        string testName
    ) {
        var fixturePath = Path.Combine(Path.GetDirectoryName(typeof(FamilyFoundryRoundtripHarness).Assembly.Location)!,
            "Fixtures", "FamilyModel", fixtureRelativePath);
        var parsed = FamilyModelJson.Parse(File.ReadAllText(fixturePath));
        Assert.That(parsed.Value, Is.Not.Null,
            string.Join(Environment.NewLine, parsed.Diagnostics.Select(diagnostic => diagnostic.Message)));
        Assert.That(parsed.Diagnostics, Is.Empty);
        var authored = parsed.Value!;
        var outputDirectory = RevitFamilyFixtureHarness.CreateTemporaryOutputDirectory(testName);

        Document? buildA = null;
        Document? reopenedA = null;
        Document? buildB = null;
        Document? reopenedB = null;
        try {
            var first = FamilyModelBuild.Build(application, authored);
            buildA = first.Document;
            Assert.That(first.Receipt?.Converged, Is.True, "The authored build must converge before saving.");
            var savedAPath = RevitFamilyFixtureHarness.SaveDocumentCopy(buildA, outputDirectory, "A");
            RevitFamilyFixtureHarness.CloseDocument(buildA);
            buildA = null;

            reopenedA = RevitFamilyFixtureHarness.OpenFamilyDocument(application, savedAPath);
            // This is the black-box boundary: capture receives only the reopened RFA, never authored/compiler state.
            var captured = reopenedA.CaptureFamilyModel();
            var second = FamilyModelBuild.Build(application, captured);
            buildB = second.Document;
            Assert.That(second.Receipt?.Converged, Is.True, "The captured build must converge before saving.");
            var savedBPath = RevitFamilyFixtureHarness.SaveDocumentCopy(buildB, outputDirectory, "B");
            RevitFamilyFixtureHarness.CloseDocument(buildB);
            buildB = null;

            reopenedB = RevitFamilyFixtureHarness.OpenFamilyDocument(application, savedBPath);
            var artifact = new FamilyModelRoundtripArtifact(
                authored,
                captured,
                savedAPath,
                savedBPath,
                reopenedA,
                reopenedB);
            reopenedA = null;
            reopenedB = null;
            return artifact;
        } finally {
            RevitFamilyFixtureHarness.CloseDocument(buildA);
            RevitFamilyFixtureHarness.CloseDocument(reopenedA);
            RevitFamilyFixtureHarness.CloseDocument(buildB);
            RevitFamilyFixtureHarness.CloseDocument(reopenedB);
        }
    }

    /// <summary>
    ///     The run directory for intent-oracle SVG galleries. `.artifacts` is outside version control, so
    ///     galleries accumulate there. The date is read at call time; it is never a baked-in constant.
    ///     `PE_FF_ORACLE_GALLERY_DIR` wins when set, taken verbatim: under
    ///     `test fresh` the test assembly runs from a shadow copy in %TEMP% that carries its own
    ///     Pe.Tools.slnx, so walking up from the assembly finds the copy's root and the gallery lands in a
    ///     directory nobody looks at. The walk stays as the fallback for in-place lanes.
    /// </summary>
    public static string OracleGalleryDirectory() {
        var pinned = Environment.GetEnvironmentVariable("PE_FF_ORACLE_GALLERY_DIR");
        if (!string.IsNullOrWhiteSpace(pinned)) {
            _ = Directory.CreateDirectory(pinned);
            return pinned;
        }

        var root = FindRepoRoot() ?? Path.GetTempPath();
        var directory = Path.Combine(root, ".artifacts", "runs", $"family-oracle-{DateTime.Now:yyyyMMdd}");
        _ = Directory.CreateDirectory(directory);
        return directory;
    }

    private static string? FindRepoRoot() {
        var assemblyDirectory = Path.GetDirectoryName(typeof(FamilyFoundryRoundtripHarness).Assembly.Location);
        foreach (var candidateRoot in new[] { assemblyDirectory, Directory.GetCurrentDirectory() }) {
            if (string.IsNullOrWhiteSpace(candidateRoot))
                continue;

            var directory = new DirectoryInfo(candidateRoot);
            while (directory != null) {
                if (File.Exists(Path.Combine(directory.FullName, "Pe.Tools.slnx")))
                    return directory.FullName;

                directory = directory.Parent;
            }
        }

        return null;
    }

    public static IReadOnlyList<(string TypeName, TProbe Result)> EvaluateRoundtripStates<TProbe>(
        Document familyDocument,
        IReadOnlyList<RevitFamilyFixtureHarness.FamilyTypeState> states,
        Func<Document, TProbe> probe
    ) =>
        RevitFamilyFixtureHarness.EvaluateLengthDrivenStates(familyDocument, states, probe);

    public static IReadOnlyList<RevitFamilyFixtureHarness.FamilyTypeState> CreateExistingTypeStates(
        Document familyDocument) =>
        familyDocument.FamilyManager.Types
            .Cast<FamilyType>()
            .OrderBy(type => type.Name, StringComparer.Ordinal)
            .Select(type => new RevitFamilyFixtureHarness.FamilyTypeState(
                type.Name,
                new Dictionary<string, double>(StringComparer.Ordinal)))
            .ToList();
}
