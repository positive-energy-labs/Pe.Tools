using Pe.Revit.Extensions.FamDocument;
using Pe.Revit.FamilyFoundry;
using Pe.Revit.FamilyFoundry.Aggregators.Snapshots;
using Pe.Revit.FamilyFoundry.OperationSettings;
using Pe.Revit.FamilyFoundry.Resolution;
using Pe.Revit.FamilyFoundry.Serialization;
using Pe.Revit.FamilyFoundry.Snapshots;
using Pe.Shared.SettingsCatalog.Manifests.FamilyFoundry;
using Pe.Tools.Commands.FamilyFoundry;

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
            var savedFamilyPath = RevitFamilyFixtureHarness.GetExpectedSavedFamilyPath(result.OutputFolderPath!, familyDocument);
            var compiled = AuthoredParamDrivenSolidsCompiler.Compile(profile.ParamDrivenSolids ?? new AuthoredParamDrivenSolidsSettings());

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
            var sourceSnapshot = CollectFamilySnapshot(sourceDocument);
            var authored = sourceSnapshot.ParamDrivenSolids ?? new AuthoredParamDrivenSolidsSettings();
            var profile = ProjectToProfile(sourceSnapshot);
            var sourceCategory = sourceDocument.OwnerFamily?.FamilyCategory
                ?? throw new InvalidOperationException("Source family category was not available.");
            var replayDocument = RevitFamilyFixtureHarness.CreateFamilyDocument(
                application,
                (BuiltInCategory)sourceCategory.Id.IntegerValue,
                replayFamilyName);

            try {
                var outputDirectory = RevitFamilyFixtureHarness.CreateTemporaryOutputDirectory(testName);
                var result = ProcessRoundtrip(replayDocument, profile, testName, outputDirectory);
                var savedFamilyPath = RevitFamilyFixtureHarness.GetExpectedSavedFamilyPath(result.OutputFolderPath!, replayDocument);
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

    public static FamilySnapshot CollectFamilySnapshot(Document doc) {
        if (!doc.IsFamilyDocument)
            throw new InvalidOperationException("Expected a family document.");

        var famDoc = new FamilyDocument(doc);
        var familyName = Path.GetFileNameWithoutExtension(doc.PathName);
        if (string.IsNullOrWhiteSpace(familyName))
            familyName = doc.Title ?? "Unnamed";

        var snapshot = new FamilySnapshot { FamilyName = familyName };

        var paramCollector = new ParamSectionCollector();
        if (((IFamilyDocCollector)paramCollector).ShouldCollect(snapshot))
            ((IFamilyDocCollector)paramCollector).Collect(snapshot, famDoc);

        var lookupCollector = new LookupTableSectionCollector();
        if (lookupCollector.ShouldCollect(snapshot))
            lookupCollector.Collect(snapshot, famDoc);

        var refPlaneCollector = new RefPlaneSectionCollector();
        if (refPlaneCollector.ShouldCollect(snapshot))
            refPlaneCollector.Collect(snapshot, famDoc);

        var extrusionCollector = new ExtrusionSectionCollector();
        if (extrusionCollector.ShouldCollect(snapshot))
            extrusionCollector.Collect(snapshot, famDoc);

        return snapshot;
    }

    public static FFManagerSettings ProjectToProfile(FamilySnapshot snapshot) {
        var authored = snapshot.ParamDrivenSolids ?? new AuthoredParamDrivenSolidsSettings();
        var parameterSnapshots = snapshot.Parameters?.Data ?? [];
        var exportedParams = FamilyParamProfileAdapter.ProjectSnapshotsToProfile(parameterSnapshots);
        var compiledSolids = AuthoredParamDrivenSolidsCompiler.Compile(authored);
        var additionalReferences = KnownParamPlanBuilder.CollectReferencedParameterNames(compiledSolids.RefPlanesAndDims)
            .Concat(KnownParamPlanBuilder.CollectReferencedParameterNames(compiledSolids.InternalExtrusions))
            .Concat(KnownParamPlanBuilder.CollectReferencedParameterNames(compiledSolids.Connectors))
            .ToList();
        var referencedSnapshotDefinitions = KnownParamPlanBuilder.BuildFamilyDefinitionsFromSnapshots(
            parameterSnapshots,
            additionalReferences);
        var resolvedFamilyParams = KnownParamPlanBuilder.MergeFamilyParamDefinitions(
            exportedParams.AddFamilyParams,
            referencedSnapshotDefinitions);
        var requiredApsParameterNames = exportedParams.SetKnownParams.GetAllReferencedParameterNames()
            .Concat(additionalReferences)
            .Where(KnownParamResolver.IsPeParameterName)
            .Distinct(StringComparer.Ordinal)
            .OrderBy(name => name, StringComparer.Ordinal)
            .ToList();

        return new FFManagerSettings {
            ExecutionOptions = new ExecutionOptions { SingleTransaction = false, OptimizeTypeOperations = true },
            FilterFamilies = new BaseProfileSettings.FilterFamiliesSettings {
                IncludeUnusedFamilies = true,
                IncludeCategoriesEqualing = [],
                IncludeNames = new IncludeFamilies { Equaling = ["__CURRENT_FAMILY__"] },
                ExcludeNames = new ExcludeFamilies()
            },
            FilterApsParams = new BaseProfileSettings.FilterApsParamsSettings {
                IncludeNames = new IncludeSharedParameter { Equaling = requiredApsParameterNames },
                ExcludeNames = new ExcludeSharedParameter()
            },
            AddFamilyParams = resolvedFamilyParams,
            SetLookupTables = new SetLookupTablesSettings {
                Tables = snapshot.LookupTables?.Data?.Select(CloneLookupTable).ToList() ?? []
            },
            SetKnownParams = exportedParams.SetKnownParams,
            ParamDrivenSolids = authored
        };
    }

    private static LookupTableDefinition CloneLookupTable(LookupTableDefinition table) => new() {
        Schema = table.Schema with {
            Columns = table.Schema.Columns
                .Select(column => column with { })
                .ToList()
        },
        Rows = table.Rows
            .Select(row => row with {
                ValuesByColumn = new Dictionary<string, string>(row.ValuesByColumn, StringComparer.Ordinal)
            })
            .ToList()
    };

    public static IReadOnlyList<(string TypeName, TProbe Result)> EvaluateRoundtripStates<TProbe>(
        Document familyDocument,
        IReadOnlyList<RevitFamilyFixtureHarness.FamilyTypeState> states,
        Func<Document, TProbe> probe
    ) =>
        RevitFamilyFixtureHarness.EvaluateLengthDrivenStates(familyDocument, states, probe);

    public static IReadOnlyList<RevitFamilyFixtureHarness.FamilyTypeState> CreateExistingTypeStates(Document familyDocument) =>
        familyDocument.FamilyManager.Types
            .Cast<FamilyType>()
            .OrderBy(type => type.Name, StringComparer.Ordinal)
            .Select(type => new RevitFamilyFixtureHarness.FamilyTypeState(
                type.Name,
                new Dictionary<string, double>(StringComparer.Ordinal)))
            .ToList();

    public static FFManagerProcessFamiliesActionResult ProcessRoundtrip(
        Document familyDocument,
        FFManagerSettings profile,
        string profileName,
        string outputDirectory
    ) {
        var result = CmdFFManager.ProcessFamiliesCore(
            familyDocument,
            profile,
            profileName,
            new LoadAndSaveOptions {
                OpenOutputFilesOnCommandFinish = false,
                LoadFamily = false,
                SaveFamilyToInternalPath = true,
                SaveFamilyToOutputDir = true
            },
            outputDirectory);

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
