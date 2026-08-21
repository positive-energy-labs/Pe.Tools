using Pe.Revit.FamilyFoundry;
using Pe.Revit.FamilyFoundry.Apply;
using Pe.Revit.FamilyFoundry.Capture;
using Pe.Revit.FamilyFoundry.Profiles;
using Pe.Revit.FamilyFoundry.Resolution;
using Pe.Shared.RevitData.Families;

namespace Pe.Revit.Tests;

internal static class FamilyFoundryRoundtripHarness {
    public static FamilyModelRoundtripArtifact RunFamilyModelRoundtrip(
        Application application,
        string fixtureRelativePath,
        string testName
    ) {
        var fixturePath = RevitFamilyFixtureHarness.GetProfileFixturePath(fixtureRelativePath);
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
            var modelDirectory = Path.GetDirectoryName(fixturePath);
            buildA = FamilyModelBuilder.Build(application, authored, modelDirectory).Document;
            var savedAPath = RevitFamilyFixtureHarness.SaveDocumentCopy(buildA, outputDirectory, "A");
            RevitFamilyFixtureHarness.CloseDocument(buildA);
            buildA = null;

            reopenedA = RevitFamilyFixtureHarness.OpenFamilyDocument(application, savedAPath);
            // This is the black-box boundary: capture receives only the reopened RFA, never authored/compiler state.
            var captured = reopenedA.CaptureFamilyModel();
            buildB = FamilyModelBuilder.Build(application, captured, modelDirectory).Document;
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

    public static RoundtripArtifact RunProfileFixtureRoundtrip(
        Application application,
        string fixtureFileName,
        BuiltInCategory familyCategory,
        string familyName,
        string testName
    ) {
        var familyDocument = RevitFamilyFixtureHarness.CreateFamilyDocument(application, familyCategory, familyName);
        try {
            var profile = RevitFamilyFixtureHarness.LoadProfileFixture(fixtureFileName);
            var outputDirectory = RevitFamilyFixtureHarness.CreateTemporaryOutputDirectory(testName);
            var result = ProcessRoundtrip(familyDocument, profile, testName, outputDirectory);
            var savedFamilyPath =
                RevitFamilyFixtureHarness.GetExpectedSavedFamilyPath(result.OutputFolderPath!, familyDocument);
            var compiled =
                AuthoredParamDrivenSolidsCompiler.Compile(profile.ParamDrivenSolids ??
                                                          new AuthoredParamDrivenSolidsSettings());

            RevitFamilyFixtureHarness.CloseDocument(familyDocument);
            familyDocument = null!;

            var savedDocument = OpenSavedFamilyDocument(application, savedFamilyPath);
            return new RoundtripArtifact(
                profile,
                profile.ParamDrivenSolids ?? new AuthoredParamDrivenSolidsSettings(),
                compiled,
                result.Contexts[0],
                savedFamilyPath,
                null,
                savedDocument);
        } finally {
            RevitFamilyFixtureHarness.CloseDocument(familyDocument);
        }
    }

    public static RoundtripArtifact RunSnapshotApplyRoundtrip(
        Application application,
        string familyFixtureFileName,
        string replayFamilyName,
        string testName
    ) {
        var sourceDocument = RevitFamilyFixtureHarness.OpenFamilyFixture(application, familyFixtureFileName);
        try {
            var sourceSnapshot = sourceDocument.CaptureFamilySnapshot();
            var authored = sourceSnapshot.AuthoredParamDrivenSolids ?? new AuthoredParamDrivenSolidsSettings();
            var profile = ProjectToProfile(sourceSnapshot);
            var sourceCategory = sourceDocument.OwnerFamily?.FamilyCategory
                                 ?? throw new InvalidOperationException("Source family category was not available.");
            var replayDocument = RevitFamilyFixtureHarness.CreateFamilyDocument(
                application,
                (BuiltInCategory)sourceCategory.Id.Value(),
                replayFamilyName);

            try {
                var outputDirectory = RevitFamilyFixtureHarness.CreateTemporaryOutputDirectory(testName);
                var result = ProcessRoundtrip(replayDocument, profile, testName, outputDirectory);
                var savedFamilyPath =
                    RevitFamilyFixtureHarness.GetExpectedSavedFamilyPath(result.OutputFolderPath!, replayDocument);
                var compiled = AuthoredParamDrivenSolidsCompiler.Compile(authored);

                RevitFamilyFixtureHarness.CloseDocument(replayDocument);
                replayDocument = null!;

                var savedDocument = OpenSavedFamilyDocument(application, savedFamilyPath);
                return new RoundtripArtifact(
                    profile,
                    authored,
                    compiled,
                    result.Contexts[0],
                    savedFamilyPath,
                    sourceDocument,
                    savedDocument);
            } finally {
                RevitFamilyFixtureHarness.CloseDocument(replayDocument);
            }
        } catch {
            RevitFamilyFixtureHarness.CloseDocument(sourceDocument);
            throw;
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

    public static FFManagerProfile ProjectToProfile(FamilySnapshot snapshot) =>
        FamilySnapshotProfileProjector.ProjectToProfile(snapshot, "__CURRENT_FAMILY__");

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

    public static FamilyProfileApplyResult ProcessRoundtrip(
        Document familyDocument,
        FFManagerProfile profile,
        string profileName,
        string outputDirectory
    ) {
        var result = familyDocument.ApplyFamilyProfile(
            profile,
            profileName,
            new LoadAndSaveOptions {
                OpenOutputFilesOnCommandFinish = false,
                LoadFamily = false,
                SaveFamilyToInternalPath = true,
                SaveFamilyToOutputDir = true
            },
            OutputStorage.ExactDir(outputDirectory));

        Assert.That(result.Success, Is.True, result.Error);
        Assert.That(result.Contexts, Has.Count.EqualTo(1));
        Assert.That(result.OutputFolderPath, Is.Not.Null.And.Not.Empty);
        Assert.That(result.Contexts[0].PostProcessSnapshot, Is.Not.Null);
        return result;
    }

    private static Document OpenSavedFamilyDocument(
        Application application,
        string savedFamilyPath
    ) =>
        application.OpenDocumentFile(savedFamilyPath)
        ?? throw new InvalidOperationException($"Failed to open saved family '{savedFamilyPath}'.");
}
