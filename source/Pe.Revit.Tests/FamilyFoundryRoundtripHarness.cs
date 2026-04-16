using Pe.Revit.FamilyFoundry;
using Pe.Revit.FamilyFoundry.Apply;
using Pe.Revit.FamilyFoundry.Plans;
using Pe.Revit.FamilyFoundry.Serialization;
using Pe.Revit.FamilyFoundry.Capture;
using Pe.Revit.FamilyFoundry.Profiles;
using Pe.Revit.FamilyFoundry.Snapshots;

namespace Pe.Revit.Tests;

internal static class FamilyFoundryRoundtripHarness {
    public static RoundtripArtifact RunProfileFixtureRoundtrip(
        Autodesk.Revit.ApplicationServices.Application application,
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
        Autodesk.Revit.ApplicationServices.Application application,
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

    public static FFManagerProfile ProjectToProfile(FamilySnapshot snapshot) {
        var sharedParameterNames = snapshot.Parameters?.Data?
                                       .Select(parameter => parameter.SharedGuid.HasValue
                                           ? parameter.Name?.Trim()
                                           : null)
                                       .Where(name => !string.IsNullOrWhiteSpace(name))
                                       .Select(name => name!)
                                       .ToHashSet(StringComparer.Ordinal)
                                   ?? [];

        return FamilySnapshotProfileProjector.ProjectToProfile(
            snapshot,
            "__CURRENT_FAMILY__",
            name => sharedParameterNames.Contains(name));
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
        Autodesk.Revit.ApplicationServices.Application application,
        string savedFamilyPath
    ) =>
        application.OpenDocumentFile(savedFamilyPath)
        ?? throw new InvalidOperationException($"Failed to open saved family '{savedFamilyPath}'.");
}
