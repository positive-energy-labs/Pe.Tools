using Pe.Revit.FamilyFoundry.Apply;
using Pe.Shared.RevitData.Families;

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
    public void Snapshot_projection_roundtrips_embedded_lookup_tables_and_size_lookup_formulas(
        UIApplication uiApplication) {
        var application = uiApplication.Application;
        var outputDirectory = RevitFamilyFixtureHarness.CreateTemporaryOutputDirectory(
            nameof(this.Snapshot_projection_roundtrips_embedded_lookup_tables_and_size_lookup_formulas));

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
            var sourceTable = sourceTables.Single(table =>
                string.Equals(table.TableName, LookupTableName, StringComparison.Ordinal));

            var snapshot = sourceDocument!.CaptureFamilyModel();
            Assert.Multiple(() => {
                Assert.That(snapshot.LookupTables, Has.Count.EqualTo(1));
                Assert.That(snapshot.Parameters, Is.Not.Empty);
            });

            var capturedTable = snapshot.LookupTables[LookupTableName];
            Assert.Multiple(() => {
                Assert.That(capturedTable.Csv, Does.Contain(LookupKeyColumnName));
                Assert.That(capturedTable.Csv, Does.Contain("ResultVoltage"));
            });

            var parsed = FamilyModelJson.Parse(FamilyModelJson.Serialize(snapshot));
            Assert.That(parsed.Diagnostics, Is.Empty);
            var profile = parsed.Value!;
            Assert.That(
                profile.Parameters.Values.Any(parameter =>
                    parameter.Formula?.Contains("size_lookup(", StringComparison.OrdinalIgnoreCase) == true),
                Is.True,
                "Expected projected profile to carry size_lookup formulas.");

            var savedFamilyPath = Path.Combine(outputDirectory, "lookup-replay.rfa");
            var result = FamilyModelBuild.BuildAndSave(application, profile, savedFamilyPath);
            Assert.That(result.Receipt?.Converged, Is.True, "Lookup replay must converge before it is saved.");

            savedDocument = application.OpenDocumentFile(savedFamilyPath)
                            ?? throw new InvalidOperationException(
                                $"Failed to open saved lookup roundtrip family '{savedFamilyPath}'.");

            var savedTables = RevitFamilyFixtureHarness.ExportFamilySizeTables(
                savedDocument,
                Path.Combine(outputDirectory, "saved-lookups"));
            var savedTable = savedTables.Single(table =>
                string.Equals(table.TableName, LookupTableName, StringComparison.Ordinal));

            Assert.That(savedTable.Rows, Is.EqualTo(sourceTable.Rows),
                "Expected the embedded lookup CSV to roundtrip unchanged.");

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
                    Assert.That(valueSnapshot.HasValue, Is.True,
                        $"Expected '{lookupCase.ParameterName}' to evaluate after replay.");
                }

                _ = transaction.RollBack();
            }

            Assert.That(savedTables, Has.Count.EqualTo(sourceTables.Count));
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
                LookupTableTestSupport.EnsureTypeParameter(familyDocument, lookupCase.ParameterName,
                    lookupCase.DataType);
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

    private static void ConfigureStableLookupUnits(Document familyDocument) =>
        LookupTableTestSupport.ConfigureUnits(
            familyDocument,
            (SpecTypeId.ElectricalPotential, UnitTypeId.Volts),
            (SpecTypeId.AirFlow, UnitTypeId.CubicFeetPerMinute));

    private static IReadOnlyList<LookupTableTestSupport.LookupCase> BuildRoundtripCases() => [
        new("Voltage", SpecTypeId.ElectricalPotential, "ResultVoltage", "120"),
        new("AirFlow", SpecTypeId.AirFlow, "ResultAirFlow", "450"),
        new("Enabled", SpecTypeId.Boolean.YesNo, "ResultEnabled", "1")
    ];
}
