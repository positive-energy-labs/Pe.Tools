using Pe.Revit.FamilyFoundry.Apply;
using Newtonsoft.Json;
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

            File.WriteAllText(Path.Combine(outputDirectory, "source.family.json"), FamilyModelJson.Serialize(snapshot));
            WriteValues(sourceDocument, outputDirectory, "source-values.json");
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

            WriteValues(savedDocument, outputDirectory, "reopened-values.json");
            File.WriteAllText(Path.Combine(outputDirectory, "reopened.family.json"),
                FamilyModelJson.Serialize(savedDocument.CaptureFamilyModel()));
            var savedTables = RevitFamilyFixtureHarness.ExportFamilySizeTables(
                savedDocument,
                Path.Combine(outputDirectory, "saved-lookups"));
            var savedTable = savedTables.Single(table =>
                string.Equals(table.TableName, LookupTableName, StringComparison.Ordinal));

            Assert.That(savedTable.Rows, Is.EqualTo(sourceTable.Rows),
                "Expected the embedded lookup CSV to roundtrip unchanged.");
            Assert.That(savedTable.HeaderColumns, Is.EqualTo(sourceTable.HeaderColumns),
                "Column order, spec and units must survive alongside the data rows.");

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
                    var sourceType = sourceDocument.FamilyManager.Types.Cast<FamilyType>()
                        .Single(type => type.Name == LookupTypeName);
                    var sourceParameter = sourceDocument.FamilyManager.get_Parameter(lookupCase.ParameterName);
                    var expected = sourceParameter.StorageType == StorageType.Integer
                        ? (double?)sourceType.AsInteger(sourceParameter)
                        : sourceType.AsDouble(sourceParameter);
                    Assert.That(Convert.ToDouble(valueSnapshot.RawValue), Is.EqualTo(expected).Within(1e-7),
                        $"'{lookupCase.ParameterName}' must retain its evaluated internal value.");
                }

                _ = transaction.RollBack();
            }

            Assert.That(savedTables, Has.Count.EqualTo(sourceTables.Count));
        } catch {
            // Probe only after the original assertion has already failed; never turn a repair into a pass.
            if (savedDocument is not null) ProbeFormulaRefresh(savedDocument, outputDirectory);
            throw;
        } finally {
            RevitFamilyFixtureHarness.CloseDocument(savedDocument);
            RevitFamilyFixtureHarness.CloseDocument(replayDocument);
            RevitFamilyFixtureHarness.CloseDocument(sourceDocument);
        }
    }

    // Keep evidence before assertions: CSV/formula equality alone does not prove evaluated values.
    private static void WriteValues(Document document, string output, string name) {
        var fm = document.FamilyManager;
        var values = fm.Types.Cast<FamilyType>().SelectMany(type => fm.GetParameters()
            .Where(p => p.Definition.Name.StartsWith("Lookup", StringComparison.Ordinal)
                || p.Definition.Name.StartsWith("Result", StringComparison.Ordinal))
            .Select(p => new {
                Type = type.Name, Parameter = p.Definition.Name, p.Formula,
                HasValue = type.HasValue(p),
                Value = p.StorageType switch {
                    StorageType.String => (object?)type.AsString(p),
                    StorageType.Integer => type.AsInteger(p),
                    StorageType.Double => type.AsDouble(p),
                    _ => null
                }
            })).ToArray();
        File.WriteAllText(Path.Combine(output, name), JsonConvert.SerializeObject(values, Formatting.Indented));
    }

    private static void ProbeFormulaRefresh(Document document, string output) {
        using var transaction = new Transaction(document, "Probe lookup evaluation without retaining changes");
        transaction.Start();
        try {
            var fm = document.FamilyManager;
            fm.CurrentType = fm.Types.Cast<FamilyType>().Single(t => t.Name == LookupTypeName);
            document.Regenerate();
            WriteValues(document, output, "regenerated-values.json");
            var formulas = fm.GetParameters().Where(p => !string.IsNullOrEmpty(p.Formula))
                .Select(p => (Parameter: p, Formula: p.Formula!))
                .OrderBy(p => p.Formula.Contains("size_lookup(", StringComparison.OrdinalIgnoreCase) ? 0 : 1).ToArray();
            foreach (var mode in new[] { "same-formulas", "outputs-only", "lookups-only", "all-formulas" }) {
                using var trial = new SubTransaction(document);
                trial.Start();
                try {
                    foreach (var (parameter, formula) in formulas) {
                        var lookup = formula.Contains("size_lookup(", StringComparison.OrdinalIgnoreCase);
                        if (mode == "outputs-only" && lookup || mode == "lookups-only" && !lookup) continue;
                        if (mode != "same-formulas") fm.SetFormula(parameter, null);
                        fm.SetFormula(parameter, formula);
                    }
                    document.Regenerate();
                    WriteValues(document, output, $"refresh-{mode}-values.json");
                } catch (Exception ex) {
                    File.WriteAllText(Path.Combine(output, $"refresh-{mode}-error.txt"), ex.ToString());
                } finally { trial.RollBack(); }
            }
        } catch (Exception ex) {
            File.WriteAllText(Path.Combine(output, "formula-refresh-error.txt"), ex.ToString());
        } finally { transaction.RollBack(); }
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
