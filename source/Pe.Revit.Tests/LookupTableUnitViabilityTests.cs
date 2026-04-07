namespace Pe.Revit.Tests;

[TestFixture]
public sealed class LookupTableUnitViabilityTests {
    private const BuiltInCategory TestFamilyCategory = BuiltInCategory.OST_GenericModel;
    private const string LookupTypeName = "LookupCodecType";
    private const string LookupKeyParameterName = "LookupKey";
    private const string LookupKeyColumnName = "LookupKey";
    private const string LookupTableName = "LookupCodecTable";
    private const string LookupKeyValue = "1";

    [Test]
    public void Lookup_table_number_columns_can_drive_pressure_voltage_current_airflow_and_yes_no_parameters(
        UIApplication uiApplication
    ) {
        var application = uiApplication.Application;
        var outputDirectory = RevitFamilyFixtureHarness.CreateTemporaryOutputDirectory(
            nameof(Lookup_table_number_columns_can_drive_pressure_voltage_current_airflow_and_yes_no_parameters));
        Document? familyDocument = null;

        try {
            familyDocument = RevitFamilyFixtureHarness.CreateFamilyDocument(
                application,
                TestFamilyCategory,
                "FF-LookupCodec");
            ConfigureStableLookupUnits(familyDocument);

            var lookupCases = BuildLookupCases();
            using (var transaction = new Transaction(familyDocument, "Create lookup codec parameters")) {
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

            var results = LookupTableTestSupport.ApplyLookupFormulasAndCapture(
                familyDocument,
                LookupTypeName,
                LookupKeyParameterName,
                LookupKeyValue,
                LookupTableName,
                lookupCases);
            var exportedTable = RevitFamilyFixtureHarness.ExportFamilySizeTables(
                familyDocument,
                Path.Combine(outputDirectory, "lookup-exports"))
                .Single(table => string.Equals(table.TableName, LookupTableName, StringComparison.Ordinal));

            Assert.That(exportedTable.HeaderColumns[0], Is.EqualTo(string.Empty));

            foreach (var result in results) {
                TestContext.Out.WriteLine(
                    $"[LOOKUP_CODEC_CASE] name={result.LookupCase.Name} parameter={result.LookupCase.ParameterName} lookupCarrier={result.LookupCarrierParameterName} lookupAccepted={result.LookupFormulaAccepted} targetAccepted={result.TargetFormulaAccepted} hasValue={result.Snapshot.HasValue} lookupFormula={result.LookupFormula} targetFormula={result.TargetFormula ?? "<null>"} valueString={result.Snapshot.ValueString ?? "<null>"} lookupError={result.LookupErrorMessage ?? "<null>"} targetError={result.TargetErrorMessage ?? "<null>"}");

                Assert.Multiple(() => {
                    Assert.That(result.LookupFormulaAccepted, Is.True, $"Lookup formula rejected for '{result.LookupCarrierParameterName}'.");
                    Assert.That(result.TargetFormulaAccepted, Is.True, $"Target coercion formula rejected for '{result.LookupCase.ParameterName}'.");
                    Assert.That(result.Snapshot.HasValue, Is.True, $"Expected '{result.LookupCase.ParameterName}' to evaluate.");
                    Assert.That(
                        exportedTable.HeaderColumns,
                        Contains.Item(LookupTableTestSupport.GetExpectedHeaderFragment(familyDocument, result.LookupCase)),
                        $"Expected exported CSV header for '{result.LookupCase.ParameterName}' to preserve the codec token.");
                });

                var expectedRawValue = LookupTableTestSupport.GetExpectedRawValue(familyDocument, result.LookupCase);
                switch (expectedRawValue) {
                case int expectedInt:
                    Assert.That(result.Snapshot.RawValue, Is.EqualTo(expectedInt));
                    break;
                case double expectedDouble:
                    Assert.That(result.Snapshot.RawValue, Is.TypeOf<double>());
                    Assert.That((double)result.Snapshot.RawValue!, Is.EqualTo(expectedDouble).Within(1e-9));
                    break;
                default:
                    Assert.That(result.Snapshot.RawValue?.ToString(), Is.EqualTo(expectedRawValue.ToString()));
                    break;
                }
            }
        } finally {
            RevitFamilyFixtureHarness.CloseDocument(familyDocument);
        }
    }

    private static void ConfigureStableLookupUnits(Document familyDocument) {
        LookupTableTestSupport.ConfigureUnits(
            familyDocument,
            (SpecTypeId.HvacPressure, UnitTypeId.PoundsForcePerSquareInch),
            (SpecTypeId.ElectricalPotential, UnitTypeId.Volts),
            (SpecTypeId.Current, UnitTypeId.Amperes),
            (SpecTypeId.AirFlow, UnitTypeId.CubicFeetPerMinute));
    }

    private static IReadOnlyList<LookupTableTestSupport.LookupCase> BuildLookupCases() => [
        new("Pressure", SpecTypeId.HvacPressure, "ResultPressure", "0.75"),
        new("Voltage", SpecTypeId.ElectricalPotential, "ResultVoltage", "120"),
        new("Current", SpecTypeId.Current, "ResultCurrent", "12"),
        new("AirFlow", SpecTypeId.AirFlow, "ResultAirFlow", "450"),
        new("Enabled", SpecTypeId.Boolean.YesNo, "ResultEnabled", "1")
    ];
}
