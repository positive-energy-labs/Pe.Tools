using Pe.Revit.FamilyFoundry;

namespace Pe.Revit.Tests;

[TestFixture]
public sealed class AuthoredProfileRoundtripFixtureTests {
    private const BuiltInCategory TestFamilyCategory = BuiltInCategory.OST_GenericModel;
    private const string WineGuardianIndoorFamilyName = "FF-Test-WineGuardianDS050Indoor";
    private const string WineGuardianOutdoorFamilyName = "FF-Test-WineGuardianDS050Outdoor";
    private const string WineGuardianIndoorProfileFixture = "wineguardian-ds050-indoor.json";
    private const string WineGuardianOutdoorProfileFixture = "wineguardian-ds050-outdoor.json";
    private const string PeGrdSupplyFamilyFixture = "pe-grd-supply.rfa";

    private Autodesk.Revit.ApplicationServices.Application _dbApplication = null!;

    [OneTimeSetUp]
    public void SetUp(UIApplication uiApplication) {
        _dbApplication = uiApplication?.Application
            ?? throw new InvalidOperationException("ricaun.RevitTest did not provide a UIApplication.");
    }

    [Test]
    public void WineGuardian_DS050_Indoor_profile_aligns_with_runtime_across_type_matrix() {
        RoundtripArtifact? artifact = null;

        try {
            artifact = FamilyFoundryRoundtripHarness.RunProfileFixtureRoundtrip(
                _dbApplication,
                WineGuardianIndoorProfileFixture,
                TestFamilyCategory,
                WineGuardianIndoorFamilyName,
                nameof(WineGuardian_DS050_Indoor_profile_aligns_with_runtime_across_type_matrix));

            FamilyFoundryRoundtripAssertions.AssertAuthoredGraphCounts(
                artifact.Authored,
                new AuthoredGraphExpectation(
                    7,
                    0,
                    1,
                    0,
                    5,
                    [
                        "Drain Elevation",
                        "Drain Side",
                        "Liquid Line Center",
                        "Return Air Elevation",
                        "Service Line Elevation",
                        "Service Panel Center",
                        "Suction Line Center"
                    ],
                    ["Cabinet"],
                    [],
                    ["CondensateDrain", "LiquidLine", "ReturnAir", "SuctionLine", "SupplyAir"]));
            FamilyFoundryRoundtripAssertions.AssertCompiledPlanMatchesAuthored(artifact);
            FamilyFoundryRoundtripAssertions.AssertSavedFamilyHasOnlyTypes(artifact.SavedDocument, "DS050");

            var states = FamilyFoundryRoundtripHarness.EvaluateRoundtripStates(
                artifact.SavedDocument,
                CreateWineGuardianIndoorStates(),
                FamilyFoundryRuntimeProbe.Collect);

            Assert.That(states, Has.Count.EqualTo(4));
            Assert.That(states[0].Result.ConnectorCount, Is.EqualTo(5));
            Assert.That(states[0].Result.Prisms, Has.Count.EqualTo(1));
            Assert.That(states[0].Result.Cylinders, Has.Count.EqualTo(5));

            FamilyFoundryRoundtripAssertions.AssertDimensionLabelsMatchCompiledPlan(artifact.Compiled, states);
            FamilyFoundryRoundtripAssertions.AssertOffsetPlanesTrackDriversAcrossStates(artifact.Compiled, states);
            FamilyFoundryRoundtripAssertions.AssertSymmetricPairsTrackDriversAcrossStates(artifact.Compiled, states);
            FamilyFoundryRoundtripAssertions.AssertPrismsTrackConstrainingPlanesAcrossStates(artifact.Compiled, states);
            FamilyFoundryRoundtripAssertions.AssertConnectorsTrackFacesAndDriversAcrossStates(artifact.Compiled, states);
        } finally {
            artifact?.CloseDocuments();
        }
    }

    [Test]
    public void WineGuardian_DS050_Outdoor_profile_aligns_with_runtime_across_type_matrix() {
        RoundtripArtifact? artifact = null;

        try {
            artifact = FamilyFoundryRoundtripHarness.RunProfileFixtureRoundtrip(
                _dbApplication,
                WineGuardianOutdoorProfileFixture,
                TestFamilyCategory,
                WineGuardianOutdoorFamilyName,
                nameof(WineGuardian_DS050_Outdoor_profile_aligns_with_runtime_across_type_matrix));

            FamilyFoundryRoundtripAssertions.AssertAuthoredGraphCounts(
                artifact.Authored,
                new AuthoredGraphExpectation(
                    4,
                    0,
                    1,
                    0,
                    2,
                    [
                        "Liquid Line Center",
                        "Service Line Elevation",
                        "Service Panel Center",
                        "Suction Line Center"
                    ],
                    ["Cabinet"],
                    [],
                    ["LiquidLine", "SuctionLine"]));
            FamilyFoundryRoundtripAssertions.AssertCompiledPlanMatchesAuthored(artifact);
            FamilyFoundryRoundtripAssertions.AssertSavedFamilyHasOnlyTypes(artifact.SavedDocument, "DS050 Cond");

            var states = FamilyFoundryRoundtripHarness.EvaluateRoundtripStates(
                artifact.SavedDocument,
                CreateWineGuardianOutdoorStates(),
                FamilyFoundryRuntimeProbe.Collect);

            Assert.That(states, Has.Count.EqualTo(4));
            Assert.That(states[0].Result.ConnectorCount, Is.EqualTo(2));
            Assert.That(states[0].Result.Prisms, Has.Count.EqualTo(1));
            Assert.That(states[0].Result.Cylinders, Has.Count.EqualTo(2));

            FamilyFoundryRoundtripAssertions.AssertDimensionLabelsMatchCompiledPlan(artifact.Compiled, states);
            FamilyFoundryRoundtripAssertions.AssertOffsetPlanesTrackDriversAcrossStates(artifact.Compiled, states);
            FamilyFoundryRoundtripAssertions.AssertSymmetricPairsTrackDriversAcrossStates(artifact.Compiled, states);
            FamilyFoundryRoundtripAssertions.AssertPrismsTrackConstrainingPlanesAcrossStates(artifact.Compiled, states);
            FamilyFoundryRoundtripAssertions.AssertConnectorsTrackFacesAndDriversAcrossStates(artifact.Compiled, states);
        } finally {
            artifact?.CloseDocuments();
        }
    }

    [Test]
    public void PeGrd_Supply_snapshot_replay_aligns_with_runtime_across_existing_type_matrix() {
        RoundtripArtifact? artifact = null;

        try {
            artifact = FamilyFoundryRoundtripHarness.RunSnapshotReplayRoundtrip(
                _dbApplication,
                PeGrdSupplyFamilyFixture,
                "FF-Test-PEGRDSnapshotAuthored",
                nameof(PeGrd_Supply_snapshot_replay_aligns_with_runtime_across_existing_type_matrix));

            var sourceDocument = artifact.SourceDocument
                ?? throw new InvalidOperationException("Snapshot replay roundtrip did not return a source document.");
            var sourceExpectation = AuthoredGraphExpectation.From(artifact.Authored);

            FamilyFoundryRoundtripAssertions.AssertCompiledPlanMatchesAuthored(artifact);
            FamilyFoundryRoundtripAssertions.AssertAuthoredGraphCounts(
                artifact.Context.PostProcessSnapshot!.ParamDrivenSolids!,
                sourceExpectation);
            FamilyFoundryRoundtripAssertions.AssertTypeNamesMatch(sourceDocument, artifact.SavedDocument);

            Assert.That(
                FamilyFoundryRoundtripAssertions.CountExtrusions(artifact.SavedDocument),
                Is.EqualTo(FamilyFoundryRoundtripAssertions.CountExtrusions(sourceDocument)));
            Assert.That(
                FamilyFoundryRoundtripAssertions.CountAdditionalHorizontalReferencePlanes(artifact.SavedDocument),
                Is.EqualTo(FamilyFoundryRoundtripAssertions.CountAdditionalHorizontalReferencePlanes(sourceDocument)));

            var states = FamilyFoundryRoundtripHarness.CreateExistingTypeStates(sourceDocument);
            var savedStateProbes = FamilyFoundryRoundtripHarness.EvaluateRoundtripStates(
                artifact.SavedDocument,
                states,
                FamilyFoundryRuntimeProbe.Collect);

            FamilyFoundryRoundtripAssertions.AssertDimensionLabelsMatchCompiledPlan(artifact.Compiled, savedStateProbes);
            FamilyFoundryRoundtripAssertions.AssertOffsetPlanesTrackDriversAcrossStates(artifact.Compiled, savedStateProbes);
            FamilyFoundryRoundtripAssertions.AssertSymmetricPairsTrackDriversAcrossStates(artifact.Compiled, savedStateProbes);
            FamilyFoundryRoundtripAssertions.AssertPrismsTrackConstrainingPlanesAcrossStates(artifact.Compiled, savedStateProbes);
            FamilyFoundryRoundtripAssertions.AssertCylindersTrackConstrainingPlanesAcrossStates(artifact.Compiled, savedStateProbes);
            FamilyFoundryRoundtripAssertions.AssertVerticalSpansMatchAcrossExistingTypes(sourceDocument, artifact.SavedDocument);
            FamilyFoundryRoundtripAssertions.AssertRectangularConnectorOrientationMatchesSourceAcrossExistingTypes(sourceDocument, artifact.SavedDocument);
        } finally {
            artifact?.CloseDocuments();
        }
    }

    private static IReadOnlyList<RevitFamilyFixtureHarness.FamilyTypeState> CreateWineGuardianIndoorStates() {
        var baseValues = new Dictionary<string, double>(StringComparer.Ordinal) {
            ["PE_G_Dim_Length1"] = Inches(23.81),
            ["PE_G_Dim_Width1"] = Inches(25.04),
            ["PE_G_Dim_Height1"] = Inches(19.65),
            ["SupplyAirDiameter"] = Inches(10.0),
            ["SupplyAirDepth"] = Inches(6.0),
            ["ReturnAirDiameter"] = Inches(10.0),
            ["ReturnAirDepth"] = Inches(6.0),
            ["ReturnAirCenterElevation"] = Inches(9.84),
            ["ServicePanelOffset"] = Inches(7.50),
            ["ServiceLineHalfSpacing"] = Inches(0.75),
            ["ServiceLineElevation"] = Inches(13.85),
            ["RefrigerantDepth"] = Inches(2.0),
            ["LiquidLineDiameter"] = Inches(0.25),
            ["SuctionLineDiameter"] = Inches(0.50),
            ["DrainDiameter"] = Inches(0.50),
            ["DrainDepth"] = Inches(2.0),
            ["DrainSideOffset"] = Inches(8.50),
            ["DrainElevation"] = Inches(1.0)
        };

        return [
            CreateState("WG-IN-Base", baseValues),
            CreateState("WG-IN-Wide", baseValues, new Dictionary<string, double>(StringComparer.Ordinal) {
                ["PE_G_Dim_Width1"] = Inches(28.0),
                ["ServicePanelOffset"] = Inches(8.25),
                ["DrainSideOffset"] = Inches(9.75),
                ["SupplyAirDiameter"] = Inches(11.0),
                ["ReturnAirDiameter"] = Inches(11.0),
                ["RefrigerantDepth"] = Inches(2.5),
                ["DrainDepth"] = Inches(2.5),
                ["LiquidLineDiameter"] = Inches(0.375),
                ["SuctionLineDiameter"] = Inches(0.625),
                ["DrainDiameter"] = Inches(0.625)
            }),
            CreateState("WG-IN-Long", baseValues, new Dictionary<string, double>(StringComparer.Ordinal) {
                ["PE_G_Dim_Length1"] = Inches(27.0),
                ["SupplyAirDepth"] = Inches(7.0),
                ["ReturnAirDepth"] = Inches(7.0),
                ["RefrigerantDepth"] = Inches(3.0),
                ["DrainDepth"] = Inches(2.25)
            }),
            CreateState("WG-IN-Tall", baseValues, new Dictionary<string, double>(StringComparer.Ordinal) {
                ["PE_G_Dim_Height1"] = Inches(23.0),
                ["ReturnAirCenterElevation"] = Inches(12.0),
                ["ServiceLineElevation"] = Inches(16.0),
                ["DrainElevation"] = Inches(2.0),
                ["SupplyAirDepth"] = Inches(6.5),
                ["ReturnAirDepth"] = Inches(6.5)
            })
        ];
    }

    private static IReadOnlyList<RevitFamilyFixtureHarness.FamilyTypeState> CreateWineGuardianOutdoorStates() {
        var baseValues = new Dictionary<string, double>(StringComparer.Ordinal) {
            ["PE_G_Dim_Length1"] = Inches(34.0),
            ["PE_G_Dim_Width1"] = Inches(12.30),
            ["PE_G_Dim_Height1"] = Inches(26.07),
            ["LiquidLineDiameter"] = Inches(0.25),
            ["SuctionLineDiameter"] = Inches(0.50),
            ["ServiceLineDepth"] = Inches(2.0),
            ["ServicePanelOffset"] = Inches(4.0),
            ["ServiceLineHalfSpacing"] = Inches(0.75),
            ["ServiceLineElevation"] = Inches(14.50)
        };

        return [
            CreateState("WG-OUT-Base", baseValues),
            CreateState("WG-OUT-Wide", baseValues, new Dictionary<string, double>(StringComparer.Ordinal) {
                ["PE_G_Dim_Width1"] = Inches(14.0),
                ["ServicePanelOffset"] = Inches(4.75),
                ["LiquidLineDiameter"] = Inches(0.375),
                ["SuctionLineDiameter"] = Inches(0.625),
                ["ServiceLineDepth"] = Inches(2.5)
            }),
            CreateState("WG-OUT-Long", baseValues, new Dictionary<string, double>(StringComparer.Ordinal) {
                ["PE_G_Dim_Length1"] = Inches(38.0),
                ["ServiceLineDepth"] = Inches(3.0)
            }),
            CreateState("WG-OUT-Tall", baseValues, new Dictionary<string, double>(StringComparer.Ordinal) {
                ["PE_G_Dim_Height1"] = Inches(30.0),
                ["ServiceLineElevation"] = Inches(17.0),
                ["ServiceLineDepth"] = Inches(2.75)
            })
        ];
    }

    private static RevitFamilyFixtureHarness.FamilyTypeState CreateState(
        string name,
        IReadOnlyDictionary<string, double> baseValues,
        IReadOnlyDictionary<string, double>? overrides = null
    ) {
        var values = new Dictionary<string, double>(baseValues, StringComparer.Ordinal);
        if (overrides != null) {
            foreach (var (parameterName, value) in overrides)
                values[parameterName] = value;
        }

        return new RevitFamilyFixtureHarness.FamilyTypeState(name, values);
    }

    private static double Inches(double value) => value / 12.0;
}
