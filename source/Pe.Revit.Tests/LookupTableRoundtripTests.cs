using Pe.Revit.FamilyFoundry.Aggregators.Snapshots;
using Pe.Revit.FamilyFoundry.OperationSettings;

namespace Pe.Revit.Tests;

[TestFixture]
public sealed class LookupTableRoundtripTests {
    private const BuiltInCategory TestFamilyCategory = BuiltInCategory.OST_GenericModel;
    private const string LookupTypeName = "LookupTypeA";
    private const string LookupKeyParameterName = "LookupKey";
    private const string LookupKeyColumnName = "LookupKey";
    private const string LookupTableName = "LookupRoundtripTable";
    private const string LookupKeyValue = "1";

    [Test]
    public void Snapshot_projection_roundtrips_embedded_lookup_tables_and_size_lookup_formulas(UIApplication uiApplication) {
        var application = uiApplication.Application;
        var outputDirectory = RevitFamilyFixtureHarness.CreateTemporaryOutputDirectory(
            nameof(Snapshot_projection_roundtrips_embedded_lookup_tables_and_size_lookup_formulas));

        Document? sourceDocument = null;
        Document? replayDocument = null;
        Document? savedDocument = null;

        try {
            sourceDocument = RevitFamilyFixtureHarness.CreateFamilyDocument(
                application,
                TestFamilyCategory,
                "FF-LookupRoundtrip-Source");
            SeedLookupFamily(sourceDocument);
            sourceDocument = RevitFamilyFixtureHarness.ReopenDocument(
                application,
                sourceDocument,
                outputDirectory,
                "lookup-roundtrip-source");

            var sourceTables = RevitFamilyFixtureHarness.ExportFamilySizeTables(
                sourceDocument,
                Path.Combine(outputDirectory, "source-lookups"));
            var sourceTable = sourceTables.Single(table => string.Equals(table.TableName, LookupTableName, StringComparison.Ordinal));

            var snapshot = FamilyFoundryRoundtripHarness.CollectFamilySnapshot(sourceDocument);
            Assert.Multiple(() => {
                Assert.That(snapshot.LookupTables?.Data, Has.Count.EqualTo(1));
                Assert.That(snapshot.Parameters?.Data, Is.Not.Empty);
            });

            var capturedTable = snapshot.LookupTables!.Data.Single();
            Assert.Multiple(() => {
                Assert.That(capturedTable.Schema.Name, Is.EqualTo(LookupTableName));
                Assert.That(capturedTable.Schema.Columns[0].Name, Is.EqualTo(LookupKeyColumnName));
                Assert.That(capturedTable.Schema.Columns[0].Role, Is.EqualTo(LookupTableColumnRole.LookupKey));
                Assert.That(capturedTable.Rows, Has.Count.EqualTo(1));
            });

            var profile = FamilyFoundryRoundtripHarness.ProjectToProfile(snapshot);
            Assert.That(profile.SetLookupTables.Tables, Has.Count.EqualTo(1));
            Assert.That(
                profile.SetKnownParams.GlobalAssignments.Any(assignment =>
                    assignment.Kind == ParamAssignmentKind.Formula &&
                    assignment.Value.Contains("size_lookup(", StringComparison.OrdinalIgnoreCase)),
                Is.True,
                "Expected projected profile to carry size_lookup formulas.");

            replayDocument = RevitFamilyFixtureHarness.CreateFamilyDocument(
                application,
                TestFamilyCategory,
                "FF-LookupRoundtrip-Replay");
            var result = FamilyFoundryRoundtripHarness.ProcessRoundtrip(
                replayDocument,
                profile,
                nameof(Snapshot_projection_roundtrips_embedded_lookup_tables_and_size_lookup_formulas),
                outputDirectory);
            var savedFamilyPath = RevitFamilyFixtureHarness.GetExpectedSavedFamilyPath(
                result.OutputFolderPath!,
                replayDocument);

            RevitFamilyFixtureHarness.CloseDocument(replayDocument);
            replayDocument = null;

            savedDocument = application.OpenDocumentFile(savedFamilyPath)
                ?? throw new InvalidOperationException($"Failed to open saved lookup roundtrip family '{savedFamilyPath}'.");

            var savedTables = RevitFamilyFixtureHarness.ExportFamilySizeTables(
                savedDocument,
                Path.Combine(outputDirectory, "saved-lookups"));
            var savedTable = savedTables.Single(table => string.Equals(table.TableName, LookupTableName, StringComparison.Ordinal));

            Assert.That(savedTable.Rows, Is.EqualTo(sourceTable.Rows), "Expected the embedded lookup CSV to roundtrip unchanged.");

            var parameterProbes = RevitFamilyFixtureHarness.CollectFamilyParameterProbes(savedDocument)
                .Where(probe => !string.IsNullOrWhiteSpace(probe.Formula))
                .ToDictionary(probe => probe.Name, probe => probe.Formula!, StringComparer.Ordinal);

            using (var transaction = new Transaction(savedDocument, "Verify lookup roundtrip values")) {
                _ = transaction.Start();

                foreach (var lookupCase in BuildRoundtripCases()) {
                    var lookupCarrierParameterName = LookupTableTestSupport.GetLookupCarrierParameterName(lookupCase);
                    Assert.That(parameterProbes, Does.ContainKey(lookupCarrierParameterName));
                    Assert.That(parameterProbes[lookupCarrierParameterName], Does.Contain("size_lookup("));

                    var valueSnapshot = RevitFamilyFixtureHarness.CaptureParameterSnapshots(
                        savedDocument,
                        lookupCase.ParameterName,
                        [LookupTypeName]).Single();
                    Assert.That(valueSnapshot.HasValue, Is.True, $"Expected '{lookupCase.ParameterName}' to evaluate after replay.");
                }

                _ = transaction.RollBack();
            }

            var lookupArtifactFiles = Directory.GetFiles(
                Path.Combine(result.OutputFolderPath!, savedDocument.OwnerFamily.Name, "snapshot-lookuptables-post"),
                "*.csv",
                SearchOption.TopDirectoryOnly);
            Assert.That(lookupArtifactFiles, Is.Not.Empty, "Expected post-snapshot lookup CSV artifacts to be written.");
        } finally {
            RevitFamilyFixtureHarness.CloseDocument(savedDocument);
            RevitFamilyFixtureHarness.CloseDocument(replayDocument);
            RevitFamilyFixtureHarness.CloseDocument(sourceDocument);
        }
    }

    private static void SeedLookupFamily(Document familyDocument) {
        var lookupCases = BuildRoundtripCases();
        ConfigureStableLookupUnits(familyDocument);

        using (var transaction = new Transaction(familyDocument, "Seed lookup roundtrip family")) {
            _ = transaction.Start();

            LookupTableTestSupport.EnsureTypeParameter(familyDocument, LookupKeyParameterName, SpecTypeId.Number);
            LookupTableTestSupport.EnsureTypeParameter(
                familyDocument,
                LookupTableTestSupport.LookupTableNameParameterName,
                SpecTypeId.String.Text);
            foreach (var lookupCase in lookupCases) {
                LookupTableTestSupport.EnsureTypeParameter(familyDocument, lookupCase.ParameterName, lookupCase.DataType);
                LookupTableTestSupport.EnsureLookupSupportParameters(familyDocument, lookupCase);
            }

            RevitFamilyFixtureHarness.EnsureFamilyType(familyDocument, LookupTypeName);
            familyDocument.FamilyManager.CurrentType = familyDocument.FamilyManager.Types
                .Cast<FamilyType>()
                .Single(type => string.Equals(type.Name, LookupTypeName, StringComparison.Ordinal));

            _ = transaction.Commit();
        }

        var lookupTable = LookupTableTestSupport.BuildLookupTable(
            familyDocument,
            LookupTableName,
            LookupKeyColumnName,
            LookupTypeName,
            LookupKeyValue,
            lookupCases);
        LookupTableTestSupport.ImportLookupTable(familyDocument, lookupTable);

        _ = LookupTableTestSupport.ApplyLookupFormulasAndCapture(
            familyDocument,
            LookupTypeName,
            LookupKeyParameterName,
            LookupKeyValue,
            LookupTableName,
            lookupCases);
    }

    private static void ConfigureStableLookupUnits(Document familyDocument) {
        LookupTableTestSupport.ConfigureUnits(
            familyDocument,
            (SpecTypeId.ElectricalPotential, UnitTypeId.Volts),
            (SpecTypeId.AirFlow, UnitTypeId.CubicFeetPerMinute));
    }

    private static IReadOnlyList<LookupTableTestSupport.LookupCase> BuildRoundtripCases() => [
        new("Voltage", SpecTypeId.ElectricalPotential, "ResultVoltage", "120"),
        new("AirFlow", SpecTypeId.AirFlow, "ResultAirFlow", "450"),
        new("Enabled", SpecTypeId.Boolean.YesNo, "ResultEnabled", "1")
    ];
}
