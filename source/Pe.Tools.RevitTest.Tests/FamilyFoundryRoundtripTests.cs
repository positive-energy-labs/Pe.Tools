using Pe.FamilyFoundry;
using Pe.FamilyFoundry.Aggregators.Snapshots;
using Pe.FamilyFoundry.OperationSettings;
using Pe.FamilyFoundry.Snapshots;
using Pe.SettingsCatalog.Revit.FamilyFoundry;
using Pe.Tools.Commands.FamilyFoundry;
using Autodesk.Revit.DB;
using Autodesk.Revit.DB.Electrical;
using Autodesk.Revit.DB.Mechanical;
using Autodesk.Revit.DB.Plumbing;

namespace Pe.Tools.RevitTest.Tests;

[TestFixture]
public sealed class FamilyFoundryRoundtripTests {
    private Autodesk.Revit.ApplicationServices.Application _dbApplication = null!;
    private const BuiltInCategory TestFamilyCategory = BuiltInCategory.OST_GenericModel;
    private const string BlankFamilyName = "FF-Test-BlankFamily";
    private const string RoundtripFamilyName = "FF-Test-MagicBox";
    private const string RectangleFamilyName = "FF-Test-Rectangle";
    private const string CylinderFamilyName = "FF-Test-Cylinder";
    private const string StackedBoxesFamilyName = "FF-Test-StackedBoxes";
    private const string BoxWithCylinderFamilyName = "FF-Test-BoxWithCylinder";
    private const string RoundDuctConnectorFamilyName = "FF-Test-RoundDuctConnector";
    private const string FanCoilConnectorFamilyName = "FF-Test-FanCoilConnectorPackage";
    private const string AmbiguousFamilyName = "FF-Test-Ambiguous";
    private const string MagicBoxProfileFixture = "magicbox-roundtrip.json";

    [OneTimeSetUp]
    public void SetUp(UIApplication uiApplication) {
        _dbApplication = uiApplication?.Application
            ?? throw new InvalidOperationException("ricaun.RevitTest did not provide a UIApplication.");
    }

    [Test]
    public void Can_create_named_family_document_for_category() {
        Document? familyDocument = null;

        try {
            familyDocument = RevitFamilyFixtureHarness.CreateFamilyDocument(
                _dbApplication,
                TestFamilyCategory,
                BlankFamilyName);

            Assert.That(familyDocument.IsFamilyDocument, Is.True);
            Assert.That(familyDocument.OwnerFamily, Is.Not.Null);
            Assert.That(familyDocument.OwnerFamily!.FamilyCategory, Is.Not.Null);
            Assert.That(familyDocument.OwnerFamily!.FamilyCategory!.Id.IntegerValue, Is.EqualTo((int)TestFamilyCategory));
            Assert.That(familyDocument.OwnerFamily.Name, Is.EqualTo(BlankFamilyName));
        } finally {
            RevitFamilyFixtureHarness.CloseDocument(familyDocument);
        }
    }

    [Test]
    public void Created_family_document_starts_unsaved() {
        Document? familyDocument = null;

        try {
            familyDocument = RevitFamilyFixtureHarness.CreateFamilyDocument(
                _dbApplication,
                TestFamilyCategory,
                BlankFamilyName);

            Assert.That(familyDocument.IsFamilyDocument, Is.True);
            Assert.That(familyDocument.OwnerFamily, Is.Not.Null);
            Assert.That(familyDocument.OwnerFamily!.FamilyCategory, Is.Not.Null);
            Assert.That(familyDocument.OwnerFamily!.FamilyCategory!.Id.IntegerValue, Is.EqualTo((int)TestFamilyCategory));
            Assert.That(familyDocument.OwnerFamily.Name, Is.EqualTo(BlankFamilyName));
            Assert.That(string.IsNullOrWhiteSpace(familyDocument.PathName), Is.True);
        } finally {
            RevitFamilyFixtureHarness.CloseDocument(familyDocument);
        }
    }

    [Test]
    public void FFManager_magic_box_profile_roundtrips_on_blank_family_document() {
        Document? familyDocument = null;

        try {
            familyDocument = RevitFamilyFixtureHarness.CreateFamilyDocument(
                _dbApplication,
                TestFamilyCategory,
                RoundtripFamilyName);
            Assert.That(string.IsNullOrWhiteSpace(familyDocument.PathName), Is.True);

            var tempOutputRoot = RevitFamilyFixtureHarness.CreateTemporaryOutputDirectory(
                nameof(FFManager_magic_box_profile_roundtrips_on_blank_family_document));
            var profile = RevitFamilyFixtureHarness.LoadProfileFixture(MagicBoxProfileFixture);
            var result = CmdFFManager.ProcessFamiliesCore(
                familyDocument,
                profile,
                "TEST-MagicBox",
                new LoadAndSaveOptions {
                    OpenOutputFilesOnCommandFinish = false,
                    LoadFamily = false,
                    SaveFamilyToInternalPath = true,
                    SaveFamilyToOutputDir = true
                },
                tempOutputRoot);

            Assert.That(result.Success, Is.True, result.Error);
            Assert.That(result.Contexts, Has.Count.EqualTo(1));
            Assert.That(result.OutputFolderPath, Is.Not.Null.And.Not.Empty);

            var context = result.Contexts[0];
            var (_, error) = context.OperationLogs;
            var expectedSavedFamilyPath = RevitFamilyFixtureHarness.GetExpectedSavedFamilyPath(result.OutputFolderPath!, familyDocument);
            var expectedDetailedLogPath = Path.Combine(
                Path.GetDirectoryName(expectedSavedFamilyPath)!,
                "logs-detailed.json");

            Assert.That(error, Is.Null, error?.Message);
            Assert.That(context.PostProcessSnapshot, Is.Not.Null);
            Assert.That(File.Exists(expectedSavedFamilyPath), Is.True, expectedSavedFamilyPath);
            Assert.That(File.Exists(expectedDetailedLogPath), Is.True, expectedDetailedLogPath);

            TestContext.Progress.WriteLine($"[PE_FF_RUN_OUTPUT] {result.OutputFolderPath}");
            TestContext.Progress.WriteLine($"[PE_FF_DETAILED_LOG] {expectedDetailedLogPath}");
            TestContext.Progress.WriteLine($"[PE_FF_SAVED_FAMILY] {expectedSavedFamilyPath}");
            RevitFamilyFixtureHarness.AssertSavedFamilyFileIsOpenable(_dbApplication, expectedSavedFamilyPath);
            AssertMagicBoxSnapshot(context.PostProcessSnapshot!);
        } finally {
            RevitFamilyFixtureHarness.CloseDocument(familyDocument);
        }
    }

    [Test]
    public void FFManager_param_driven_cylinder_roundtrips_on_blank_family_document() {
        Document? familyDocument = null;

        try {
            familyDocument = RevitFamilyFixtureHarness.CreateFamilyDocument(
                _dbApplication,
                TestFamilyCategory,
                CylinderFamilyName);

            var tempOutputRoot = RevitFamilyFixtureHarness.CreateTemporaryOutputDirectory(
                nameof(FFManager_param_driven_cylinder_roundtrips_on_blank_family_document));
            var profile = CreateParamDrivenProfile(
                ["Diameter", "Height"],
                [
                    new GlobalParamAssignment { Parameter = "Diameter", Kind = ParamAssignmentKind.Formula, Value = "2'" },
                    new GlobalParamAssignment { Parameter = "Height", Kind = ParamAssignmentKind.Formula, Value = "3'" }
                ],
                cylinders: [
                    new ParamDrivenCylinderSpec {
                        Name = "Cylinder",
                        Sketch = new SketchTargetSpec { Plane = "Ref. Level" },
                        CenterLeftRightPlane = "Center (Left/Right)",
                        CenterFrontBackPlane = "Center (Front/Back)",
                        Diameter = new AxisConstraintSpec {
                            Mode = AxisConstraintMode.Mirror,
                            Parameter = "Diameter",
                            PlaneNameBase = "cylinder diameter",
                            Strength = RpStrength.StrongRef
                        },
                        Height = new AxisConstraintSpec {
                            Mode = AxisConstraintMode.Offset,
                            Parameter = "Height",
                            Anchor = "Reference Plane",
                            Direction = OffsetDirection.Positive,
                            PlaneNameBase = "cylinder top",
                            Strength = RpStrength.StrongRef
                        }
                    }
                ]);

            var result = RunRoundtrip(familyDocument, profile, nameof(FFManager_param_driven_cylinder_roundtrips_on_blank_family_document), tempOutputRoot);

            Assert.That(result.Success, Is.True, result.Error);
            AssertCylinderSnapshot(result.Contexts[0].PostProcessSnapshot!);
            var savedFamilyPath = RevitFamilyFixtureHarness.GetExpectedSavedFamilyPath(result.OutputFolderPath!, familyDocument);
            AssertSavedFamilyHasSketchDiameterLabel(savedFamilyPath, "Diameter");
            AssertRoundExtrusionResizesAcrossTypes(savedFamilyPath, "Diameter", [
                new RevitFamilyFixtureHarness.FamilyTypeState("D1", new Dictionary<string, double> { ["Diameter"] = 1.0 }),
                new RevitFamilyFixtureHarness.FamilyTypeState("D2", new Dictionary<string, double> { ["Diameter"] = 2.0 }),
                new RevitFamilyFixtureHarness.FamilyTypeState("D3", new Dictionary<string, double> { ["Diameter"] = 3.0 })
            ]);
        } finally {
            RevitFamilyFixtureHarness.CloseDocument(familyDocument);
        }
    }

    [Test]
    public void FFManager_param_driven_rectangle_resizes_across_types() {
        Document? familyDocument = null;

        try {
            familyDocument = RevitFamilyFixtureHarness.CreateFamilyDocument(
                _dbApplication,
                TestFamilyCategory,
                RectangleFamilyName);

            var tempOutputRoot = RevitFamilyFixtureHarness.CreateTemporaryOutputDirectory(
                nameof(FFManager_param_driven_rectangle_resizes_across_types));
            var profile = CreateParamDrivenProfile(
                ["Width", "Length", "Height"],
                [
                    new GlobalParamAssignment { Parameter = "Width", Kind = ParamAssignmentKind.Formula, Value = "2'" },
                    new GlobalParamAssignment { Parameter = "Length", Kind = ParamAssignmentKind.Formula, Value = "4'" },
                    new GlobalParamAssignment { Parameter = "Height", Kind = ParamAssignmentKind.Formula, Value = "3'" }
                ],
                rectangles: [
                    new ParamDrivenRectangleSpec {
                        Name = "Box",
                        Sketch = new SketchTargetSpec { Plane = "Ref. Level" },
                        Width = new AxisConstraintSpec {
                            Mode = AxisConstraintMode.Mirror,
                            Parameter = "Width",
                            CenterAnchor = "Center (Front/Back)",
                            PlaneNameBase = "box width",
                            Strength = RpStrength.StrongRef
                        },
                        Length = new AxisConstraintSpec {
                            Mode = AxisConstraintMode.Mirror,
                            Parameter = "Length",
                            CenterAnchor = "Center (Left/Right)",
                            PlaneNameBase = "box length",
                            Strength = RpStrength.StrongRef
                        },
                        Height = new AxisConstraintSpec {
                            Mode = AxisConstraintMode.Offset,
                            Parameter = "Height",
                            Anchor = "Reference Plane",
                            Direction = OffsetDirection.Positive,
                            PlaneNameBase = "box top",
                            Strength = RpStrength.StrongRef
                        }
                    }
                ]);

            var result = RunRoundtrip(familyDocument, profile, nameof(FFManager_param_driven_rectangle_resizes_across_types), tempOutputRoot);

            Assert.That(result.Success, Is.True, result.Error);
            var savedFamilyPath = RevitFamilyFixtureHarness.GetExpectedSavedFamilyPath(result.OutputFolderPath!, familyDocument);
            AssertRectangularExtrusionResizesAcrossTypes(savedFamilyPath, "Width", "Length", [
                new RevitFamilyFixtureHarness.FamilyTypeState("R1", new Dictionary<string, double> { ["Width"] = 1.0, ["Length"] = 2.0 }),
                new RevitFamilyFixtureHarness.FamilyTypeState("R2", new Dictionary<string, double> { ["Width"] = 2.0, ["Length"] = 4.0 }),
                new RevitFamilyFixtureHarness.FamilyTypeState("R3", new Dictionary<string, double> { ["Width"] = 3.0, ["Length"] = 5.0 })
            ]);
        } finally {
            RevitFamilyFixtureHarness.CloseDocument(familyDocument);
        }
    }

    [Test]
    public void FFManager_round_duct_connector_roundtrips_and_stub_resizes_across_types() {
        Document? familyDocument = null;

        try {
            familyDocument = RevitFamilyFixtureHarness.CreateFamilyDocument(
                _dbApplication,
                TestFamilyCategory,
                RoundDuctConnectorFamilyName);

            var tempOutputRoot = RevitFamilyFixtureHarness.CreateTemporaryOutputDirectory(
                nameof(FFManager_round_duct_connector_roundtrips_and_stub_resizes_across_types));
            var profile = CreateParamDrivenProfile(
                ["ConnectorDiameter", "ConnectorDepth"],
                [
                    new GlobalParamAssignment { Parameter = "ConnectorDepth", Kind = ParamAssignmentKind.Formula, Value = "1'" },
                    new GlobalParamAssignment { Parameter = "ConnectorDiameter", Kind = ParamAssignmentKind.Formula, Value = "1'" }
                ],
                connectors: [
                    new ParamDrivenConnectorSpec {
                        Name = "SupplyConn",
                        Domain = ParamDrivenConnectorDomain.Duct,
                        Host = new ConnectorHostSpec {
                            SketchPlane = "Ref. Level",
                            Depth = new AxisConstraintSpec {
                                Mode = AxisConstraintMode.Offset,
                                Parameter = "ConnectorDepth",
                                Anchor = "Ref. Level",
                                Direction = OffsetDirection.Positive,
                                PlaneNameBase = "connector face",
                                Strength = RpStrength.StrongRef
                            }
                        },
                        Geometry = new ConnectorStubGeometrySpec {
                            Profile = ParamDrivenConnectorProfile.Round,
                            CenterLeftRightPlane = "Center (Left/Right)",
                            CenterFrontBackPlane = "Center (Front/Back)",
                            Diameter = new AxisConstraintSpec {
                                Mode = AxisConstraintMode.Mirror,
                                Parameter = "ConnectorDiameter",
                                CenterAnchor = "Center (Front/Back)",
                                PlaneNameBase = "connector diameter",
                                Strength = RpStrength.StrongRef
                            }
                        },
                        Config = new ConnectorDomainConfigSpec {
                            Duct = new DuctConnectorConfigSpec {
                                SystemType = DuctSystemType.SupplyAir,
                                FlowConfiguration = DuctFlowConfigurationType.Preset,
                                FlowDirection = FlowDirectionType.Out,
                                LossMethod = DuctLossMethodType.NotDefined
                            }
                        }
                    }
                ]);

            var result = RunRoundtrip(familyDocument, profile, nameof(FFManager_round_duct_connector_roundtrips_and_stub_resizes_across_types), tempOutputRoot);

            Assert.That(result.Success, Is.True, result.Error);
            AssertOperationHasNoErrors(result.Contexts[0], "MakeParamDrivenConnectors");
            Assert.That(result.Contexts[0].PostProcessSnapshot!.ParamDrivenSolids.Connectors, Has.Count.EqualTo(1));
            var savedFamilyPath = RevitFamilyFixtureHarness.GetExpectedSavedFamilyPath(result.OutputFolderPath!, familyDocument);
            AssertConnectorSnapshotJsonContains(
                savedFamilyPath,
                "\"Domain\": \"Duct\"",
                "\"Profile\": \"Round\"",
                "\"Mode\": \"Mirror\"",
                "\"Direction\": \"Positive\"",
                "\"FlowConfiguration\": \"Preset\"",
                "\"FlowDirection\": \"Out\"");
            var states = new[] {
                new RevitFamilyFixtureHarness.FamilyTypeState("C1", new Dictionary<string, double> {
                    ["ConnectorDiameter"] = 1.0,
                    ["ConnectorDepth"] = 0.5
                }),
                new RevitFamilyFixtureHarness.FamilyTypeState("C2", new Dictionary<string, double> {
                    ["ConnectorDiameter"] = 2.0,
                    ["ConnectorDepth"] = 1.0
                }),
                new RevitFamilyFixtureHarness.FamilyTypeState("C3", new Dictionary<string, double> {
                    ["ConnectorDiameter"] = 3.0,
                    ["ConnectorDepth"] = 1.5
                })
            };
            AssertRoundExtrusionResizesAcrossTypes(savedFamilyPath, "ConnectorDiameter", states);
            AssertExtrusionDepthResizesAcrossTypes(savedFamilyPath, "ConnectorDepth", states);
            AssertConnectorBuiltInsAreAssociated(savedFamilyPath, "ConnectorDiameter", "ConnectorDepth");
            AssertRoundConnectorResizesAcrossTypes(savedFamilyPath, "ConnectorDiameter", states);
        } finally {
            RevitFamilyFixtureHarness.CloseDocument(familyDocument);
        }
    }

    [Test]
    public void FFManager_fan_coil_style_connector_package_mixes_domains_and_resizes() {
        Document? familyDocument = null;

        try {
            familyDocument = RevitFamilyFixtureHarness.CreateFamilyDocument(
                _dbApplication,
                TestFamilyCategory,
                FanCoilConnectorFamilyName);

            var tempOutputRoot = RevitFamilyFixtureHarness.CreateTemporaryOutputDirectory(
                nameof(FFManager_fan_coil_style_connector_package_mixes_domains_and_resizes));
            var profile = CreateParamDrivenProfile(
                [
                    "BoxWidth",
                    "BoxLength",
                    "BoxHeight",
                    "PipeDiameter",
                    "PipeDepth",
                    "PipeHalfSpacing",
                    "PipeCenterElevation",
                    "RoundDuctDiameter",
                    "RoundDuctDepth",
                    "RoundDuctFrontOffset",
                    "RoundDuctSideOffset",
                    "RectDuctWidth",
                    "RectDuctLength",
                    "RectDuctDepth",
                    "RectDuctFrontOffset",
                    "RectDuctSideOffset",
                    "ElectricalDiameter",
                    "ElectricalDepth",
                    "ElectricalCenterElevation"
                ],
                [
                    new GlobalParamAssignment { Parameter = "BoxWidth", Kind = ParamAssignmentKind.Formula, Value = "24\"" },
                    new GlobalParamAssignment { Parameter = "BoxLength", Kind = ParamAssignmentKind.Formula, Value = "48\"" },
                    new GlobalParamAssignment { Parameter = "BoxHeight", Kind = ParamAssignmentKind.Formula, Value = "16\"" },
                    new GlobalParamAssignment { Parameter = "PipeDiameter", Kind = ParamAssignmentKind.Formula, Value = "0.5\"" },
                    new GlobalParamAssignment { Parameter = "PipeDepth", Kind = ParamAssignmentKind.Formula, Value = "1\"" },
                    new GlobalParamAssignment { Parameter = "PipeHalfSpacing", Kind = ParamAssignmentKind.Formula, Value = "4\"" },
                    new GlobalParamAssignment { Parameter = "PipeCenterElevation", Kind = ParamAssignmentKind.Formula, Value = "6\"" },
                    new GlobalParamAssignment { Parameter = "RoundDuctDiameter", Kind = ParamAssignmentKind.Formula, Value = "8\"" },
                    new GlobalParamAssignment { Parameter = "RoundDuctDepth", Kind = ParamAssignmentKind.Formula, Value = "6\"" },
                    new GlobalParamAssignment { Parameter = "RoundDuctFrontOffset", Kind = ParamAssignmentKind.Formula, Value = "8\"" },
                    new GlobalParamAssignment { Parameter = "RoundDuctSideOffset", Kind = ParamAssignmentKind.Formula, Value = "12\"" },
                    new GlobalParamAssignment { Parameter = "RectDuctWidth", Kind = ParamAssignmentKind.Formula, Value = "16\"" },
                    new GlobalParamAssignment { Parameter = "RectDuctLength", Kind = ParamAssignmentKind.Formula, Value = "12\"" },
                    new GlobalParamAssignment { Parameter = "RectDuctDepth", Kind = ParamAssignmentKind.Formula, Value = "8\"" },
                    new GlobalParamAssignment { Parameter = "RectDuctFrontOffset", Kind = ParamAssignmentKind.Formula, Value = "4\"" },
                    new GlobalParamAssignment { Parameter = "RectDuctSideOffset", Kind = ParamAssignmentKind.Formula, Value = "12\"" },
                    new GlobalParamAssignment { Parameter = "ElectricalDiameter", Kind = ParamAssignmentKind.Formula, Value = "2\"" },
                    new GlobalParamAssignment { Parameter = "ElectricalDepth", Kind = ParamAssignmentKind.Formula, Value = "1\"" },
                    new GlobalParamAssignment { Parameter = "ElectricalCenterElevation", Kind = ParamAssignmentKind.Formula, Value = "12\"" },
                    new GlobalParamAssignment { Parameter = "ElectricalVoltage", Kind = ParamAssignmentKind.Value, Value = "120 V" },
                    new GlobalParamAssignment { Parameter = "ElectricalPoles", Kind = ParamAssignmentKind.Value, Value = "1" },
                    new GlobalParamAssignment { Parameter = "ElectricalApparentPower", Kind = ParamAssignmentKind.Value, Value = "1000 VA" }
                ],
                rectangles: [
                    new ParamDrivenRectangleSpec {
                        Name = "Cabinet",
                        Sketch = new SketchTargetSpec { Plane = "Ref. Level" },
                        Width = new AxisConstraintSpec {
                            Mode = AxisConstraintMode.Mirror,
                            Parameter = "BoxWidth",
                            CenterAnchor = "Center (Front/Back)",
                            PlaneNameBase = "cabinet width",
                            Strength = RpStrength.StrongRef
                        },
                        Length = new AxisConstraintSpec {
                            Mode = AxisConstraintMode.Mirror,
                            Parameter = "BoxLength",
                            CenterAnchor = "Center (Left/Right)",
                            PlaneNameBase = "cabinet length",
                            Strength = RpStrength.StrongRef
                        },
                        Height = new AxisConstraintSpec {
                            Mode = AxisConstraintMode.Offset,
                            Parameter = "BoxHeight",
                            Anchor = "Reference Plane",
                            Direction = OffsetDirection.Positive,
                            PlaneNameBase = "cabinet top",
                            Strength = RpStrength.StrongRef
                        }
                    }
                ],
                connectors: [
                    new ParamDrivenConnectorSpec {
                        Name = "HydronicInlet",
                        Domain = ParamDrivenConnectorDomain.Pipe,
                        Host = new ConnectorHostSpec {
                            SketchPlane = "Cabinet.Width.Back",
                            Depth = new AxisConstraintSpec {
                                Mode = AxisConstraintMode.Offset,
                                Parameter = "PipeDepth",
                                Anchor = "Cabinet.Width.Back",
                                Direction = OffsetDirection.Negative,
                                PlaneNameBase = "hydronic inlet face",
                                Strength = RpStrength.StrongRef
                            }
                        },
                        Geometry = new ConnectorStubGeometrySpec {
                            Profile = ParamDrivenConnectorProfile.Round,
                            CenterLeftRightPlane = "Pipe Pair Center (Left)",
                            CenterFrontBackPlane = "Pipe Center Elevation",
                            Diameter = new AxisConstraintSpec {
                                Mode = AxisConstraintMode.Mirror,
                                Parameter = "PipeDiameter",
                                CenterAnchor = "Pipe Pair Center (Left)",
                                PlaneNameBase = "hydronic inlet diameter",
                                Strength = RpStrength.StrongRef
                            }
                        },
                        Config = new ConnectorDomainConfigSpec {
                            Pipe = new PipeConnectorConfigSpec { SystemType = PipeSystemType.SupplyHydronic }
                        }
                    },
                    new ParamDrivenConnectorSpec {
                        Name = "HydronicOutlet",
                        Domain = ParamDrivenConnectorDomain.Pipe,
                        Host = new ConnectorHostSpec {
                            SketchPlane = "Cabinet.Width.Back",
                            Depth = new AxisConstraintSpec {
                                Mode = AxisConstraintMode.Offset,
                                Parameter = "PipeDepth",
                                Anchor = "Cabinet.Width.Back",
                                Direction = OffsetDirection.Negative,
                                PlaneNameBase = "hydronic outlet face",
                                Strength = RpStrength.StrongRef
                            }
                        },
                        Geometry = new ConnectorStubGeometrySpec {
                            Profile = ParamDrivenConnectorProfile.Round,
                            CenterLeftRightPlane = "Pipe Pair Center (Right)",
                            CenterFrontBackPlane = "Pipe Center Elevation",
                            Diameter = new AxisConstraintSpec {
                                Mode = AxisConstraintMode.Mirror,
                                Parameter = "PipeDiameter",
                                CenterAnchor = "Pipe Pair Center (Right)",
                                PlaneNameBase = "hydronic outlet diameter",
                                Strength = RpStrength.StrongRef
                            }
                        },
                        Config = new ConnectorDomainConfigSpec {
                            Pipe = new PipeConnectorConfigSpec { SystemType = PipeSystemType.ReturnHydronic }
                        }
                    },
                    new ParamDrivenConnectorSpec {
                        Name = "RoundDuct",
                        Domain = ParamDrivenConnectorDomain.Duct,
                        Host = new ConnectorHostSpec {
                            SketchPlane = "Cabinet.Height.Top",
                            Depth = new AxisConstraintSpec {
                                Mode = AxisConstraintMode.Offset,
                                Parameter = "RoundDuctDepth",
                                Anchor = "Cabinet.Height.Top",
                                Direction = OffsetDirection.Positive,
                                PlaneNameBase = "round duct face",
                                Strength = RpStrength.StrongRef
                            }
                        },
                        Geometry = new ConnectorStubGeometrySpec {
                            Profile = ParamDrivenConnectorProfile.Round,
                            CenterLeftRightPlane = "Round Duct Side Center",
                            CenterFrontBackPlane = "Round Duct Front Center",
                            Diameter = new AxisConstraintSpec {
                                Mode = AxisConstraintMode.Mirror,
                                Parameter = "RoundDuctDiameter",
                                CenterAnchor = "Round Duct Side Center",
                                PlaneNameBase = "round duct diameter",
                                Strength = RpStrength.StrongRef
                            }
                        },
                        Config = new ConnectorDomainConfigSpec {
                            Duct = new DuctConnectorConfigSpec {
                                SystemType = DuctSystemType.SupplyAir,
                                FlowConfiguration = DuctFlowConfigurationType.Preset,
                                FlowDirection = FlowDirectionType.Out,
                                LossMethod = DuctLossMethodType.NotDefined
                            }
                        }
                    },
                    new ParamDrivenConnectorSpec {
                        Name = "RectDuct",
                        Domain = ParamDrivenConnectorDomain.Duct,
                        Host = new ConnectorHostSpec {
                            SketchPlane = "Cabinet.Height.Top",
                            Depth = new AxisConstraintSpec {
                                Mode = AxisConstraintMode.Offset,
                                Parameter = "RectDuctDepth",
                                Anchor = "Cabinet.Height.Top",
                                Direction = OffsetDirection.Positive,
                                PlaneNameBase = "rect duct face",
                                Strength = RpStrength.StrongRef
                            }
                        },
                        Geometry = new ConnectorStubGeometrySpec {
                            Profile = ParamDrivenConnectorProfile.Rectangular,
                            Width = new AxisConstraintSpec {
                                Mode = AxisConstraintMode.Mirror,
                                Parameter = "RectDuctWidth",
                                CenterAnchor = "Rect Duct Front Center",
                                PlaneNameBase = "rect duct width",
                                Strength = RpStrength.StrongRef
                            },
                            Length = new AxisConstraintSpec {
                                Mode = AxisConstraintMode.Mirror,
                                Parameter = "RectDuctLength",
                                CenterAnchor = "Rect Duct Side Center",
                                PlaneNameBase = "rect duct length",
                                Strength = RpStrength.StrongRef
                            }
                        },
                        Config = new ConnectorDomainConfigSpec {
                            Duct = new DuctConnectorConfigSpec {
                                SystemType = DuctSystemType.ReturnAir,
                                FlowConfiguration = DuctFlowConfigurationType.Preset,
                                FlowDirection = FlowDirectionType.In,
                                LossMethod = DuctLossMethodType.NotDefined
                            }
                        }
                    },
                    new ParamDrivenConnectorSpec {
                        Name = "PowerConn",
                        Domain = ParamDrivenConnectorDomain.Electrical,
                        Host = new ConnectorHostSpec {
                            SketchPlane = "Cabinet.Width.Back",
                            Depth = new AxisConstraintSpec {
                                Mode = AxisConstraintMode.Offset,
                                Parameter = "ElectricalDepth",
                                Anchor = "Cabinet.Width.Back",
                                Direction = OffsetDirection.Negative,
                                PlaneNameBase = "power face",
                                Strength = RpStrength.StrongRef
                            }
                        },
                        Geometry = new ConnectorStubGeometrySpec {
                            Profile = ParamDrivenConnectorProfile.Round,
                            CenterLeftRightPlane = "Center (Left/Right)",
                            CenterFrontBackPlane = "Electrical Center Elevation",
                            Diameter = new AxisConstraintSpec {
                                Mode = AxisConstraintMode.Mirror,
                                Parameter = "ElectricalDiameter",
                                CenterAnchor = "Center (Left/Right)",
                                PlaneNameBase = "power diameter",
                                Strength = RpStrength.StrongRef
                            }
                        },
                        Bindings = new ConnectorParameterBindingsSpec {
                            Parameters = [
                                new ConnectorParameterBindingSpec {
                                    Target = ConnectorParameterKey.Voltage,
                                    SourceParameter = "ElectricalVoltage"
                                },
                                new ConnectorParameterBindingSpec {
                                    Target = ConnectorParameterKey.NumberOfPoles,
                                    SourceParameter = "ElectricalPoles"
                                },
                                new ConnectorParameterBindingSpec {
                                    Target = ConnectorParameterKey.ApparentPower,
                                    SourceParameter = "ElectricalApparentPower"
                                }
                            ]
                        },
                        Config = new ConnectorDomainConfigSpec {
                            Electrical = new ElectricalConnectorConfigSpec {
                                SystemType = ElectricalSystemType.PowerBalanced
                            }
                        }
                    }
                ],
                extraParameters: [
                    new FamilyParamDefinitionModel {
                        Name = "ElectricalVoltage",
                        DataType = SpecTypeId.ElectricalPotential
                    },
                    new FamilyParamDefinitionModel {
                        Name = "ElectricalPoles",
                        DataType = SpecTypeId.Int.NumberOfPoles
                    },
                    new FamilyParamDefinitionModel {
                        Name = "ElectricalApparentPower",
                        DataType = SpecTypeId.ApparentPower
                    }
                ],
                mirrorSpecs: [
                    new MirrorSpec {
                        Name = "Pipe Pair Center",
                        CenterAnchor = "Center (Left/Right)",
                        Parameter = "PipeHalfSpacing",
                        Strength = RpStrength.StrongRef
                    }
                ],
                offsetSpecs: [
                    new OffsetSpec {
                        Name = "Pipe Center Elevation",
                        AnchorName = "Reference Plane",
                        Direction = OffsetDirection.Positive,
                        Parameter = "PipeCenterElevation",
                        Strength = RpStrength.StrongRef
                    },
                    new OffsetSpec {
                        Name = "Round Duct Front Center",
                        AnchorName = "Center (Front/Back)",
                        Direction = OffsetDirection.Positive,
                        Parameter = "RoundDuctFrontOffset",
                        Strength = RpStrength.StrongRef
                    },
                    new OffsetSpec {
                        Name = "Round Duct Side Center",
                        AnchorName = "Center (Left/Right)",
                        Direction = OffsetDirection.Negative,
                        Parameter = "RoundDuctSideOffset",
                        Strength = RpStrength.StrongRef
                    },
                    new OffsetSpec {
                        Name = "Rect Duct Front Center",
                        AnchorName = "Center (Front/Back)",
                        Direction = OffsetDirection.Positive,
                        Parameter = "RectDuctFrontOffset",
                        Strength = RpStrength.StrongRef
                    },
                    new OffsetSpec {
                        Name = "Rect Duct Side Center",
                        AnchorName = "Center (Left/Right)",
                        Direction = OffsetDirection.Positive,
                        Parameter = "RectDuctSideOffset",
                        Strength = RpStrength.StrongRef
                    },
                    new OffsetSpec {
                        Name = "Electrical Center Elevation",
                        AnchorName = "Reference Plane",
                        Direction = OffsetDirection.Positive,
                        Parameter = "ElectricalCenterElevation",
                        Strength = RpStrength.StrongRef
                    }
                ]);

            var result = RunRoundtrip(
                familyDocument,
                profile,
                nameof(FFManager_fan_coil_style_connector_package_mixes_domains_and_resizes),
                tempOutputRoot);

            Assert.That(result.Success, Is.True, result.Error);
            AssertOperationHasNoErrors(result.Contexts[0], "MakeParamDrivenConnectors");
            Assert.That(result.Contexts[0].PostProcessSnapshot!.ParamDrivenSolids.Connectors, Has.Count.EqualTo(5));
            var savedFamilyPath = RevitFamilyFixtureHarness.GetExpectedSavedFamilyPath(result.OutputFolderPath!, familyDocument);
            AssertConnectorSnapshotJsonContains(
                savedFamilyPath,
                "\"Profile\": \"Rectangular\"",
                "\"Target\": \"Voltage\"",
                "\"Target\": \"NumberOfPoles\"",
                "\"Target\": \"ApparentPower\"",
                "\"SystemType\": \"PowerBalanced\"",
                "\"SystemType\": \"SupplyAir\"",
                "\"SystemType\": \"ReturnAir\"");

            AssertMixedConnectorInventory(savedFamilyPath);
            AssertMixedConnectorLayout(savedFamilyPath);
            AssertElectricalConnectorBuiltInsAreAssociated(
                savedFamilyPath,
                "ElectricalVoltage",
                "ElectricalPoles",
                "ElectricalApparentPower");
            AssertRectangularConnectorBuiltInsAreAssociated(
                savedFamilyPath,
                "RectDuctLength",
                "RectDuctWidth");

            var states = new[] {
                new RevitFamilyFixtureHarness.FamilyTypeState("FC1", new Dictionary<string, double> {
                    ["PipeDiameter"] = 0.5 / 12.0,
                    ["RoundDuctDiameter"] = 8.0 / 12.0,
                    ["RectDuctWidth"] = 16.0 / 12.0,
                    ["RectDuctLength"] = 12.0 / 12.0
                }),
                new RevitFamilyFixtureHarness.FamilyTypeState("FC2", new Dictionary<string, double> {
                    ["PipeDiameter"] = 0.75 / 12.0,
                    ["RoundDuctDiameter"] = 10.0 / 12.0,
                    ["RectDuctWidth"] = 18.0 / 12.0,
                    ["RectDuctLength"] = 14.0 / 12.0
                }),
                new RevitFamilyFixtureHarness.FamilyTypeState("FC3", new Dictionary<string, double> {
                    ["PipeDiameter"] = 1.0 / 12.0,
                    ["RoundDuctDiameter"] = 12.0 / 12.0,
                    ["RectDuctWidth"] = 20.0 / 12.0,
                    ["RectDuctLength"] = 16.0 / 12.0
                })
            };

            AssertRoundPipingConnectorsResizeAcrossTypes(savedFamilyPath, "PipeDiameter", states);
            AssertRoundHvacConnectorResizesAcrossTypes(savedFamilyPath, "RoundDuctDiameter", states);
            AssertRectangularHvacConnectorResizesAcrossTypes(savedFamilyPath, "RectDuctWidth", "RectDuctLength", states);
        } finally {
            RevitFamilyFixtureHarness.CloseDocument(familyDocument);
        }
    }

    [Test]
    public void FFManager_stacked_boxes_share_constraints_on_blank_family_document() {
        Document? familyDocument = null;

        try {
            familyDocument = RevitFamilyFixtureHarness.CreateFamilyDocument(
                _dbApplication,
                TestFamilyCategory,
                StackedBoxesFamilyName);

            var tempOutputRoot = RevitFamilyFixtureHarness.CreateTemporaryOutputDirectory(
                nameof(FFManager_stacked_boxes_share_constraints_on_blank_family_document));
            var profile = CreateParamDrivenProfile(
                ["Width", "Length", "LowerHeight", "UpperHeight"],
                [
                    new GlobalParamAssignment { Parameter = "Width", Kind = ParamAssignmentKind.Formula, Value = "4'" },
                    new GlobalParamAssignment { Parameter = "Length", Kind = ParamAssignmentKind.Formula, Value = "6'" },
                    new GlobalParamAssignment { Parameter = "LowerHeight", Kind = ParamAssignmentKind.Formula, Value = "3'" },
                    new GlobalParamAssignment { Parameter = "UpperHeight", Kind = ParamAssignmentKind.Formula, Value = "1'" }
                ],
                rectangles: [
                    new ParamDrivenRectangleSpec {
                        Name = "Lower",
                        Sketch = new SketchTargetSpec { Plane = "Ref. Level" },
                        Width = new AxisConstraintSpec {
                            Mode = AxisConstraintMode.Mirror,
                            Parameter = "Width",
                            CenterAnchor = "Center (Front/Back)",
                            PlaneNameBase = "width",
                            Strength = RpStrength.StrongRef
                        },
                        Length = new AxisConstraintSpec {
                            Mode = AxisConstraintMode.Mirror,
                            Parameter = "Length",
                            CenterAnchor = "Center (Left/Right)",
                            PlaneNameBase = "length",
                            Strength = RpStrength.StrongRef
                        },
                        Height = new AxisConstraintSpec {
                            Mode = AxisConstraintMode.Offset,
                            Parameter = "LowerHeight",
                            Anchor = "Reference Plane",
                            Direction = OffsetDirection.Positive,
                            PlaneNameBase = "lower top",
                            Strength = RpStrength.StrongRef
                        }
                    },
                    new ParamDrivenRectangleSpec {
                        Name = "Upper",
                        Sketch = new SketchTargetSpec { Plane = "Lower.Height.Top" },
                        Width = new AxisConstraintSpec {
                            Mode = AxisConstraintMode.Mirror,
                            Parameter = "Width",
                            CenterAnchor = "Center (Front/Back)",
                            PlaneNameBase = "width",
                            Strength = RpStrength.StrongRef
                        },
                        Length = new AxisConstraintSpec {
                            Mode = AxisConstraintMode.Mirror,
                            Parameter = "Length",
                            CenterAnchor = "Center (Left/Right)",
                            PlaneNameBase = "length",
                            Strength = RpStrength.StrongRef
                        },
                        Height = new AxisConstraintSpec {
                            Mode = AxisConstraintMode.Offset,
                            Parameter = "UpperHeight",
                            Anchor = "Lower.Height.Top",
                            Direction = OffsetDirection.Positive,
                            PlaneNameBase = "upper top",
                            Strength = RpStrength.StrongRef
                        }
                    }
                ]);

            var result = RunRoundtrip(familyDocument, profile, nameof(FFManager_stacked_boxes_share_constraints_on_blank_family_document), tempOutputRoot);

            Assert.That(result.Success, Is.True, result.Error);
            TestContext.Progress.WriteLine($"[PE_FF_RUN_OUTPUT] {result.OutputFolderPath}");
            AssertStackedBoxesSnapshot(result.Contexts[0].PostProcessSnapshot!);
        } finally {
            RevitFamilyFixtureHarness.CloseDocument(familyDocument);
        }
    }

    [Test]
    public void FFManager_box_with_cylinder_on_top_plane_roundtrips_on_blank_family_document() {
        Document? familyDocument = null;

        try {
            familyDocument = RevitFamilyFixtureHarness.CreateFamilyDocument(
                _dbApplication,
                TestFamilyCategory,
                BoxWithCylinderFamilyName);

            var tempOutputRoot = RevitFamilyFixtureHarness.CreateTemporaryOutputDirectory(
                nameof(FFManager_box_with_cylinder_on_top_plane_roundtrips_on_blank_family_document));
            var profile = CreateParamDrivenProfile(
                ["Width", "Length", "BoxHeight", "Diameter", "CylinderHeight"],
                [
                    new GlobalParamAssignment { Parameter = "Width", Kind = ParamAssignmentKind.Formula, Value = "4'" },
                    new GlobalParamAssignment { Parameter = "Length", Kind = ParamAssignmentKind.Formula, Value = "6'" },
                    new GlobalParamAssignment { Parameter = "BoxHeight", Kind = ParamAssignmentKind.Formula, Value = "3'" },
                    new GlobalParamAssignment { Parameter = "Diameter", Kind = ParamAssignmentKind.Formula, Value = "2'" },
                    new GlobalParamAssignment { Parameter = "CylinderHeight", Kind = ParamAssignmentKind.Formula, Value = "1'" }
                ],
                rectangles: [
                    new ParamDrivenRectangleSpec {
                        Name = "Box",
                        Sketch = new SketchTargetSpec { Plane = "Ref. Level" },
                        Width = new AxisConstraintSpec {
                            Mode = AxisConstraintMode.Mirror,
                            Parameter = "Width",
                            CenterAnchor = "Center (Front/Back)",
                            PlaneNameBase = "width",
                            Strength = RpStrength.StrongRef
                        },
                        Length = new AxisConstraintSpec {
                            Mode = AxisConstraintMode.Mirror,
                            Parameter = "Length",
                            CenterAnchor = "Center (Left/Right)",
                            PlaneNameBase = "length",
                            Strength = RpStrength.StrongRef
                        },
                        Height = new AxisConstraintSpec {
                            Mode = AxisConstraintMode.Offset,
                            Parameter = "BoxHeight",
                            Anchor = "Reference Plane",
                            Direction = OffsetDirection.Positive,
                            PlaneNameBase = "box top",
                            Strength = RpStrength.StrongRef
                        }
                    }
                ],
                cylinders: [
                    new ParamDrivenCylinderSpec {
                        Name = "TopCylinder",
                        Sketch = new SketchTargetSpec { Plane = "Box.Height.Top" },
                        CenterLeftRightPlane = "Center (Left/Right)",
                        CenterFrontBackPlane = "Center (Front/Back)",
                        Diameter = new AxisConstraintSpec {
                            Mode = AxisConstraintMode.Mirror,
                            Parameter = "Diameter",
                            PlaneNameBase = "top cylinder diameter",
                            Strength = RpStrength.StrongRef
                        },
                        Height = new AxisConstraintSpec {
                            Mode = AxisConstraintMode.Offset,
                            Parameter = "CylinderHeight",
                            Anchor = "Box.Height.Top",
                            Direction = OffsetDirection.Positive,
                            PlaneNameBase = "top cylinder top",
                            Strength = RpStrength.StrongRef
                        }
                    }
                ]);

            var result = RunRoundtrip(familyDocument, profile, nameof(FFManager_box_with_cylinder_on_top_plane_roundtrips_on_blank_family_document), tempOutputRoot);

            Assert.That(result.Success, Is.True, result.Error);
            TestContext.Progress.WriteLine($"[PE_FF_RUN_OUTPUT] {result.OutputFolderPath}");
            TestContext.Progress.WriteLine(
                $"[PE_FF_SNAPSHOT_COUNTS] rectangles={result.Contexts[0].PostProcessSnapshot!.ParamDrivenSolids?.Rectangles.Count ?? -1}; cylinders={result.Contexts[0].PostProcessSnapshot!.ParamDrivenSolids?.Cylinders.Count ?? -1}; legacyCircles={result.Contexts[0].PostProcessSnapshot!.Extrusions?.Circles.Count ?? -1}");
            AssertBoxWithCylinderSnapshot(result.Contexts[0].PostProcessSnapshot!);
            AssertSavedFamilyHasSketchDiameterLabel(
                RevitFamilyFixtureHarness.GetExpectedSavedFamilyPath(result.OutputFolderPath!, familyDocument),
                "Diameter");
        } finally {
            RevitFamilyFixtureHarness.CloseDocument(familyDocument);
        }
    }

    [Test]
    public void FFManager_ambiguous_param_driven_solids_do_not_execute() {
        Document? familyDocument = null;

        try {
            familyDocument = RevitFamilyFixtureHarness.CreateFamilyDocument(
                _dbApplication,
                TestFamilyCategory,
                AmbiguousFamilyName);

            var tempOutputRoot = RevitFamilyFixtureHarness.CreateTemporaryOutputDirectory(
                nameof(FFManager_ambiguous_param_driven_solids_do_not_execute));
            var profile = CreateParamDrivenProfile(
                ["Width", "Length", "Height"],
                [
                    new GlobalParamAssignment { Parameter = "Width", Kind = ParamAssignmentKind.Formula, Value = "4'" },
                    new GlobalParamAssignment { Parameter = "Length", Kind = ParamAssignmentKind.Formula, Value = "6'" },
                    new GlobalParamAssignment { Parameter = "Height", Kind = ParamAssignmentKind.Formula, Value = "3'" }
                ],
                rectangles: [
                    new ParamDrivenRectangleSpec {
                        Name = "AmbiguousBox",
                        Sketch = new SketchTargetSpec { Plane = "Ref. Level" },
                        Width = new AxisConstraintSpec {
                            Mode = AxisConstraintMode.Mirror,
                            Parameter = "Width",
                            CenterAnchor = "Center (Front/Back)",
                            PlaneNameBase = "width",
                            Strength = RpStrength.StrongRef,
                            Inference = new InferenceInfo {
                                Status = InferenceStatus.Ambiguous,
                                Warnings = ["Width semantics are ambiguous."]
                            }
                        },
                        Length = new AxisConstraintSpec {
                            Mode = AxisConstraintMode.Mirror,
                            Parameter = "Length",
                            CenterAnchor = "Center (Left/Right)",
                            PlaneNameBase = "length",
                            Strength = RpStrength.StrongRef
                        },
                        Height = new AxisConstraintSpec {
                            Mode = AxisConstraintMode.Offset,
                            Parameter = "Height",
                            Anchor = "Reference Plane",
                            Direction = OffsetDirection.Positive,
                            PlaneNameBase = "top",
                            Strength = RpStrength.StrongRef
                        }
                    }
                ]);

            var result = RunRoundtrip(familyDocument, profile, nameof(FFManager_ambiguous_param_driven_solids_do_not_execute), tempOutputRoot);

            Assert.That(result.Success, Is.False);
            Assert.That(result.Error, Does.Contain("Ambiguous"));
            Assert.That(new FilteredElementCollector(familyDocument)
                .OfClass(typeof(Extrusion))
                .GetElementCount(), Is.EqualTo(0));
        } finally {
            RevitFamilyFixtureHarness.CloseDocument(familyDocument);
        }
    }

    private static void AssertMagicBoxSnapshot(FamilySnapshot snapshot) {
        Assert.That(snapshot.Parameters?.Data?.Any(parameter => parameter.Name == "PE_G_Dim_Width1"), Is.True);
        Assert.That(snapshot.Parameters?.Data?.Any(parameter => parameter.Name == "PE_G_Dim_Length1"), Is.True);
        Assert.That(snapshot.Parameters?.Data?.Any(parameter => parameter.Name == "PE_G_Dim_Height1"), Is.True);

        var widthParam = snapshot.Parameters!.Data.First(parameter => parameter.Name == "PE_G_Dim_Width1");
        var lengthParam = snapshot.Parameters.Data.First(parameter => parameter.Name == "PE_G_Dim_Length1");
        var heightParam = snapshot.Parameters.Data.First(parameter => parameter.Name == "PE_G_Dim_Height1");

        Assert.That(widthParam.Formula, Is.EqualTo("4'"));
        Assert.That(lengthParam.Formula, Is.EqualTo("6'"));
        Assert.That(heightParam.Formula, Is.EqualTo("3'"));
        Assert.That(snapshot.ParamDrivenSolids, Is.Not.Null);
        Assert.That(snapshot.ParamDrivenSolids.Rectangles, Has.Count.EqualTo(1));
        Assert.That(snapshot.ParamDrivenSolids.Rectangles[0].Width.Parameter, Is.EqualTo("PE_G_Dim_Width1"));
        Assert.That(snapshot.ParamDrivenSolids.Rectangles[0].Length.Parameter, Is.EqualTo("PE_G_Dim_Length1"));
        Assert.That(snapshot.ParamDrivenSolids.Rectangles[0].Height.Parameter, Is.EqualTo("PE_G_Dim_Height1"));
    }

    private static void AssertCylinderSnapshot(FamilySnapshot snapshot) {
        Assert.That(snapshot.ParamDrivenSolids, Is.Not.Null);
        Assert.That(snapshot.ParamDrivenSolids.Cylinders, Has.Count.EqualTo(1));

        var cylinder = snapshot.ParamDrivenSolids.Cylinders[0];
        Assert.That(cylinder.CenterLeftRightPlane, Is.EqualTo("Center (Left/Right)"));
        Assert.That(cylinder.CenterFrontBackPlane, Is.EqualTo("Center (Front/Back)"));
        Assert.That(cylinder.Diameter.Parameter, Is.EqualTo("Diameter"));
        Assert.That(cylinder.Height.Parameter, Is.EqualTo("Height"));
        Assert.That(cylinder.Diameter.Inference?.Status ?? InferenceStatus.Exact, Is.EqualTo(InferenceStatus.Exact));
        Assert.That(cylinder.Height.Inference?.Status ?? InferenceStatus.Exact, Is.EqualTo(InferenceStatus.Exact));
    }

    private static void AssertStackedBoxesSnapshot(FamilySnapshot snapshot) {
        Assert.That(snapshot.ParamDrivenSolids, Is.Not.Null);
        Assert.That(snapshot.ParamDrivenSolids.Rectangles, Has.Count.EqualTo(2));
        var lower = snapshot.ParamDrivenSolids.Rectangles.Single(rectangle => rectangle.Height.Parameter == "LowerHeight");
        var upper = snapshot.ParamDrivenSolids.Rectangles.Single(rectangle => rectangle.Height.Parameter == "UpperHeight");

        Assert.That(lower.Width.Parameter, Is.EqualTo("Width"));
        Assert.That(lower.Length.Parameter, Is.EqualTo("Length"));
        Assert.That(lower.Height.Parameter, Is.EqualTo("LowerHeight"));
        Assert.That(upper.Width.Parameter, Is.EqualTo("Width"));
        Assert.That(upper.Length.Parameter, Is.EqualTo("Length"));
        Assert.That(upper.Height.Parameter, Is.EqualTo("UpperHeight"));
        Assert.That(upper.Sketch.Plane, Is.EqualTo("lower top"));
    }

    private static void AssertBoxWithCylinderSnapshot(FamilySnapshot snapshot) {
        Assert.That(snapshot.ParamDrivenSolids, Is.Not.Null);
        Assert.That(snapshot.ParamDrivenSolids.Rectangles, Has.Count.EqualTo(1));
        Assert.That(snapshot.ParamDrivenSolids.Cylinders, Has.Count.EqualTo(1));

        var box = snapshot.ParamDrivenSolids.Rectangles[0];
        var cylinder = snapshot.ParamDrivenSolids.Cylinders[0];

        Assert.That(box.Sketch.Plane, Is.EqualTo("Ref. Level"));
        Assert.That(box.Width.Parameter, Is.EqualTo("Width"));
        Assert.That(box.Length.Parameter, Is.EqualTo("Length"));
        Assert.That(box.Height.Parameter, Is.EqualTo("BoxHeight"));
        Assert.That(cylinder.Sketch.Plane, Is.EqualTo("box top"));
        Assert.That(cylinder.CenterLeftRightPlane, Is.EqualTo("Center (Left/Right)"));
        Assert.That(cylinder.CenterFrontBackPlane, Is.EqualTo("Center (Front/Back)"));
        Assert.That(cylinder.Diameter.Parameter, Is.EqualTo("Diameter"));
        Assert.That(cylinder.Height.Anchor, Is.EqualTo("box top"));
        Assert.That(cylinder.Height.Parameter, Is.EqualTo("CylinderHeight"));
    }

    private void AssertSavedFamilyHasSketchDiameterLabel(string savedFamilyPath, string parameterName) {
        Document? savedDocument = null;

        try {
            savedDocument = _dbApplication.OpenDocumentFile(savedFamilyPath);
            Assert.That(savedDocument, Is.Not.Null);

            var labeledSketchDimensions = new FilteredElementCollector(savedDocument!)
                .OfClass(typeof(Extrusion))
                .Cast<Extrusion>()
                .Where(extrusion => extrusion.Sketch != null)
                .SelectMany(extrusion => extrusion.Sketch.GetAllElements()
                    .Select(id => savedDocument.GetElement(id))
                    .OfType<Dimension>())
                .Where(dimension => string.Equals(
                    TryGetFamilyLabelName(dimension),
                    parameterName,
                    StringComparison.Ordinal))
                .ToList();

            Assert.That(labeledSketchDimensions, Has.Count.EqualTo(1));
        } finally {
            RevitFamilyFixtureHarness.CloseDocument(savedDocument);
        }
    }

    private static string? TryGetFamilyLabelName(Dimension dimension) {
        try {
            return dimension.FamilyLabel?.Definition?.Name;
        } catch {
            return null;
        }
    }

    private static MixedConnectorStateMeasurement MeasureMixedConnectorState(Document familyDocument) {
        var connectors = new FilteredElementCollector(familyDocument)
            .OfClass(typeof(ConnectorElement))
            .Cast<ConnectorElement>()
            .ToList();

        var pipingRoundDiameters = connectors
            .Where(connector => connector.Domain == Domain.DomainPiping)
            .Select(GetRoundConnectorDiameter)
            .OrderBy(value => value)
            .ToList();

        var roundHvacConnector = connectors.Single(connector =>
            connector.Domain == Domain.DomainHvac &&
            connector.Shape == ConnectorProfileType.Round);
        var rectangularHvacConnector = connectors.Single(connector =>
            connector.Domain == Domain.DomainHvac &&
            connector.Shape == ConnectorProfileType.Rectangular);
        var electricalCount = connectors.Count(connector => connector.Domain == Domain.DomainElectrical);

        return new MixedConnectorStateMeasurement(
            pipingRoundDiameters,
            GetRoundConnectorDiameter(roundHvacConnector),
            (
                Math.Min(rectangularHvacConnector.Width, rectangularHvacConnector.Height),
                Math.Max(rectangularHvacConnector.Width, rectangularHvacConnector.Height)
            ),
            electricalCount);
    }

    private static double GetRoundConnectorDiameter(ConnectorElement connector) {
        if (connector.Shape != ConnectorProfileType.Round)
            throw new InvalidOperationException($"Connector '{connector.Id.IntegerValue}' was expected to be round.");

        if (connector.Radius <= 0.0)
            throw new InvalidOperationException($"Connector '{connector.Id.IntegerValue}' did not expose a positive radius.");

        return connector.Radius * 2.0;
    }

    private void AssertRoundExtrusionResizesAcrossTypes(
        string savedFamilyPath,
        string parameterName,
        IReadOnlyList<RevitFamilyFixtureHarness.FamilyTypeState> states
    ) {
        Document? savedDocument = null;

        try {
            savedDocument = _dbApplication.OpenDocumentFile(savedFamilyPath);
            Assert.That(savedDocument, Is.Not.Null);

            var results = RevitFamilyFixtureHarness.EvaluateLengthDrivenStates(
                savedDocument!,
                states,
                document => RevitFamilyFixtureHarness.MeasureFirstRoundExtrusionDiameter(document));

            foreach (var (typeName, result) in results) {
                var expected = states.Single(state => state.Name == typeName).LengthValues[parameterName];
                Assert.That(result, Is.EqualTo(expected).Within(1e-4), $"Type '{typeName}' did not resize to '{expected}'.");
            }
        } finally {
            RevitFamilyFixtureHarness.CloseDocument(savedDocument);
        }
    }

    private void AssertRoundConnectorResizesAcrossTypes(
        string savedFamilyPath,
        string parameterName,
        IReadOnlyList<RevitFamilyFixtureHarness.FamilyTypeState> states
    ) {
        Document? savedDocument = null;

        try {
            savedDocument = _dbApplication.OpenDocumentFile(savedFamilyPath);
            Assert.That(savedDocument, Is.Not.Null);

            var results = RevitFamilyFixtureHarness.EvaluateLengthDrivenStates(
                savedDocument!,
                states,
                document => RevitFamilyFixtureHarness.MeasureFirstRoundConnectorDiameter(document));

            foreach (var (typeName, result) in results) {
                var expected = states.Single(state => state.Name == typeName).LengthValues[parameterName];
                Assert.That(result, Is.EqualTo(expected).Within(1e-4), $"Connector in type '{typeName}' did not resize to '{expected}'.");
            }
        } finally {
            RevitFamilyFixtureHarness.CloseDocument(savedDocument);
        }
    }

    private void AssertRoundPipingConnectorsResizeAcrossTypes(
        string savedFamilyPath,
        string parameterName,
        IReadOnlyList<RevitFamilyFixtureHarness.FamilyTypeState> states
    ) {
        Document? savedDocument = null;

        try {
            savedDocument = _dbApplication.OpenDocumentFile(savedFamilyPath);
            Assert.That(savedDocument, Is.Not.Null);

            var results = RevitFamilyFixtureHarness.EvaluateLengthDrivenStates(
                savedDocument!,
                states,
                MeasureMixedConnectorState);

            foreach (var (typeName, result) in results) {
                var expected = states.Single(state => state.Name == typeName).LengthValues[parameterName];
                Assert.That(result.PipingRoundDiameters, Has.Count.EqualTo(2), $"Type '{typeName}' did not keep two piping connectors.");
                Assert.That(
                    result.PipingRoundDiameters.All(value => Math.Abs(value - expected) <= 1e-4),
                    Is.True,
                    $"Piping connectors in type '{typeName}' did not resize to '{expected}'.");
            }
        } finally {
            RevitFamilyFixtureHarness.CloseDocument(savedDocument);
        }
    }

    private void AssertRoundHvacConnectorResizesAcrossTypes(
        string savedFamilyPath,
        string parameterName,
        IReadOnlyList<RevitFamilyFixtureHarness.FamilyTypeState> states
    ) {
        Document? savedDocument = null;

        try {
            savedDocument = _dbApplication.OpenDocumentFile(savedFamilyPath);
            Assert.That(savedDocument, Is.Not.Null);

            var results = RevitFamilyFixtureHarness.EvaluateLengthDrivenStates(
                savedDocument!,
                states,
                MeasureMixedConnectorState);

            foreach (var (typeName, result) in results) {
                var expected = states.Single(state => state.Name == typeName).LengthValues[parameterName];
                Assert.That(
                    result.RoundHvacDiameter,
                    Is.EqualTo(expected).Within(1e-4),
                    $"Round HVAC connector in type '{typeName}' did not resize to '{expected}'.");
            }
        } finally {
            RevitFamilyFixtureHarness.CloseDocument(savedDocument);
        }
    }

    private void AssertRectangularHvacConnectorResizesAcrossTypes(
        string savedFamilyPath,
        string widthParameterName,
        string lengthParameterName,
        IReadOnlyList<RevitFamilyFixtureHarness.FamilyTypeState> states
    ) {
        Document? savedDocument = null;

        try {
            savedDocument = _dbApplication.OpenDocumentFile(savedFamilyPath);
            Assert.That(savedDocument, Is.Not.Null);

            var results = RevitFamilyFixtureHarness.EvaluateLengthDrivenStates(
                savedDocument!,
                states,
                MeasureMixedConnectorState);

            foreach (var (typeName, result) in results) {
                var expectedState = states.Single(state => state.Name == typeName);
                var expectedWidth = expectedState.LengthValues[widthParameterName];
                var expectedLength = expectedState.LengthValues[lengthParameterName];
                Assert.That(
                    result.RectangularHvacSize.Width,
                    Is.EqualTo(Math.Min(expectedWidth, expectedLength)).Within(1e-4),
                    $"Rectangular HVAC connector width in type '{typeName}' did not resize correctly.");
                Assert.That(
                    result.RectangularHvacSize.Length,
                    Is.EqualTo(Math.Max(expectedWidth, expectedLength)).Within(1e-4),
                    $"Rectangular HVAC connector length in type '{typeName}' did not resize correctly.");
            }
        } finally {
            RevitFamilyFixtureHarness.CloseDocument(savedDocument);
        }
    }

    private void AssertExtrusionDepthResizesAcrossTypes(
        string savedFamilyPath,
        string parameterName,
        IReadOnlyList<RevitFamilyFixtureHarness.FamilyTypeState> states
    ) {
        Document? savedDocument = null;

        try {
            savedDocument = _dbApplication.OpenDocumentFile(savedFamilyPath);
            Assert.That(savedDocument, Is.Not.Null);

            var results = RevitFamilyFixtureHarness.EvaluateLengthDrivenStates(
                savedDocument!,
                states,
                document => RevitFamilyFixtureHarness.MeasureFirstExtrusionDepth(document));

            foreach (var (typeName, result) in results) {
                var expected = states.Single(state => state.Name == typeName).LengthValues[parameterName];
                Assert.That(result, Is.EqualTo(expected).Within(1e-4), $"Extrusion depth in type '{typeName}' did not resize to '{expected}'.");
            }
        } finally {
            RevitFamilyFixtureHarness.CloseDocument(savedDocument);
        }
    }

    private void AssertMixedConnectorInventory(string savedFamilyPath) {
        Document? savedDocument = null;

        try {
            savedDocument = _dbApplication.OpenDocumentFile(savedFamilyPath);
            Assert.That(savedDocument, Is.Not.Null);

            var inventory = MeasureMixedConnectorState(savedDocument!);
            var connectors = new FilteredElementCollector(savedDocument!)
                .OfClass(typeof(ConnectorElement))
                .Cast<ConnectorElement>()
                .ToList();
            var pipingClassifications = connectors
                .Where(connector => connector.Domain == Domain.DomainPiping)
                .Select(connector => connector.SystemClassification)
                .OrderBy(classification => classification)
                .ToList();
            var hvacRound = connectors.Single(connector =>
                connector.Domain == Domain.DomainHvac &&
                connector.Shape == ConnectorProfileType.Round);
            var hvacRect = connectors.Single(connector =>
                connector.Domain == Domain.DomainHvac &&
                connector.Shape == ConnectorProfileType.Rectangular);
            Assert.That(inventory.PipingRoundDiameters, Has.Count.EqualTo(2));
            Assert.That(inventory.RoundHvacDiameter, Is.GreaterThan(0.0));
            Assert.That(inventory.RectangularHvacSize.Width, Is.GreaterThan(0.0));
            Assert.That(inventory.RectangularHvacSize.Length, Is.GreaterThan(0.0));
            Assert.That(inventory.ElectricalCount, Is.EqualTo(1));
            Assert.That(
                pipingClassifications,
                Is.EquivalentTo(new[] {
                    MEPSystemClassification.ReturnHydronic,
                    MEPSystemClassification.SupplyHydronic
                }));
            Assert.That(hvacRound.SystemClassification, Is.EqualTo(MEPSystemClassification.SupplyAir));
            Assert.That(hvacRect.SystemClassification, Is.EqualTo(MEPSystemClassification.ReturnAir));
        } finally {
            RevitFamilyFixtureHarness.CloseDocument(savedDocument);
        }
    }

    private void AssertMixedConnectorLayout(string savedFamilyPath) {
        Document? savedDocument = null;

        try {
            savedDocument = _dbApplication.OpenDocumentFile(savedFamilyPath);
            Assert.That(savedDocument, Is.Not.Null);

            var connectors = new FilteredElementCollector(savedDocument!)
                .OfClass(typeof(ConnectorElement))
                .Cast<ConnectorElement>()
                .ToList();
            var supplyPipe = connectors.Single(connector =>
                connector.Domain == Domain.DomainPiping &&
                connector.SystemClassification == MEPSystemClassification.SupplyHydronic);
            var returnPipe = connectors.Single(connector =>
                connector.Domain == Domain.DomainPiping &&
                connector.SystemClassification == MEPSystemClassification.ReturnHydronic);
            var roundHvac = connectors.Single(connector =>
                connector.Domain == Domain.DomainHvac &&
                connector.Shape == ConnectorProfileType.Round);
            var rectHvac = connectors.Single(connector =>
                connector.Domain == Domain.DomainHvac &&
                connector.Shape == ConnectorProfileType.Rectangular);
            var electrical = connectors.Single(connector => connector.Domain == Domain.DomainElectrical);

            var cabinet = FindCabinetRectangularExtrusion(savedDocument!);
            var cabinetBox = cabinet.get_BoundingBox(null)
                ?? throw new InvalidOperationException("The cabinet extrusion had no bounding box.");
            var cabinetMin = cabinetBox.Min;
            var cabinetMax = cabinetBox.Max;
            const double tol = 1e-4;

            Assert.That(supplyPipe.Origin.Y, Is.GreaterThan(cabinetMax.Y + tol), "Supply pipe connector should face outward from the back face.");
            Assert.That(returnPipe.Origin.Y, Is.GreaterThan(cabinetMax.Y + tol), "Return pipe connector should face outward from the back face.");
            Assert.That(electrical.Origin.Y, Is.GreaterThan(cabinetMax.Y + tol), "Electrical connector should be on the back face with the piping connectors.");
            Assert.That(electrical.Origin.Z, Is.GreaterThan(cabinetMin.Z + tol));
            Assert.That(electrical.Origin.Z, Is.LessThan(cabinetMax.Z - tol));

            Assert.That(roundHvac.Origin.Z, Is.GreaterThan(cabinetMax.Z + tol), "Round duct connector should be above the cabinet top face.");
            Assert.That(rectHvac.Origin.Z, Is.GreaterThan(cabinetMax.Z + tol), "Rectangular duct connector should be above the cabinet top face.");
            Assert.That(roundHvac.Origin.Y, Is.LessThan(-tol), "Round duct connector should sit near the front of the cabinet.");
            Assert.That(rectHvac.Origin.Y, Is.LessThan(-tol), "Rectangular duct connector should sit near the front of the cabinet.");
            Assert.That(roundHvac.Origin.X, Is.LessThan(-tol), "Round duct connector should sit near the front-left corner.");
            Assert.That(rectHvac.Origin.X, Is.GreaterThan(tol), "Rectangular duct connector should sit near the front-right corner.");

            var rectangularStub = FindNearestRectangularStub(savedDocument!, rectHvac, cabinet.Id);
            var stubBox = rectangularStub.get_BoundingBox(null)
                ?? throw new InvalidOperationException("The rectangular duct stub had no bounding box.");
            var stubX = stubBox.Max.X - stubBox.Min.X;
            var stubY = stubBox.Max.Y - stubBox.Min.Y;

            Assert.That(stubX, Is.EqualTo(12.0 / 12.0).Within(1e-4), "Rectangular duct stub X extent should follow family length.");
            Assert.That(stubY, Is.EqualTo(16.0 / 12.0).Within(1e-4), "Rectangular duct stub Y extent should follow family width.");
        } finally {
            RevitFamilyFixtureHarness.CloseDocument(savedDocument);
        }
    }

    private void AssertConnectorBuiltInsAreAssociated(
        string savedFamilyPath,
        string diameterParameterName,
        string depthParameterName
    ) {
        Document? savedDocument = null;

        try {
            savedDocument = _dbApplication.OpenDocumentFile(savedFamilyPath);
            Assert.That(savedDocument, Is.Not.Null);

            var connector = new FilteredElementCollector(savedDocument!)
                .OfClass(typeof(ConnectorElement))
                .Cast<ConnectorElement>()
                .FirstOrDefault()
                ?? throw new InvalidOperationException("No connector was found.");
            var extrusion = new FilteredElementCollector(savedDocument)
                .OfClass(typeof(Extrusion))
                .Cast<Extrusion>()
                .FirstOrDefault()
                ?? throw new InvalidOperationException("No extrusion was found.");

            var connectorDiameter = connector.get_Parameter(BuiltInParameter.CONNECTOR_DIAMETER)
                ?? throw new InvalidOperationException("Connector diameter built-in parameter was not found.");
            var extrusionEnd = extrusion.get_Parameter(BuiltInParameter.EXTRUSION_END_PARAM)
                ?? throw new InvalidOperationException("Extrusion end built-in parameter was not found.");

            var associatedConnectorDiameter = savedDocument.FamilyManager.GetAssociatedFamilyParameter(connectorDiameter);
            var associatedExtrusionEnd = savedDocument.FamilyManager.GetAssociatedFamilyParameter(extrusionEnd);

            Assert.That(associatedConnectorDiameter?.Definition?.Name, Is.EqualTo(diameterParameterName));
            Assert.That(associatedExtrusionEnd?.Definition?.Name, Is.EqualTo(depthParameterName));
        } finally {
            RevitFamilyFixtureHarness.CloseDocument(savedDocument);
        }
    }

    private void AssertElectricalConnectorBuiltInsAreAssociated(
        string savedFamilyPath,
        string voltageParameterName,
        string polesParameterName,
        string apparentPowerParameterName
    ) {
        Document? savedDocument = null;

        try {
            savedDocument = _dbApplication.OpenDocumentFile(savedFamilyPath);
            Assert.That(savedDocument, Is.Not.Null);

            var connector = new FilteredElementCollector(savedDocument!)
                .OfClass(typeof(ConnectorElement))
                .Cast<ConnectorElement>()
                .Single(element => element.Domain == Domain.DomainElectrical);

            var voltage = connector.get_Parameter(BuiltInParameter.RBS_ELEC_VOLTAGE)
                ?? throw new InvalidOperationException("Electrical connector voltage built-in parameter was not found.");
            var poles = connector.get_Parameter(BuiltInParameter.RBS_ELEC_NUMBER_OF_POLES)
                ?? throw new InvalidOperationException("Electrical connector number of poles built-in parameter was not found.");
            var apparentPower = connector.get_Parameter(BuiltInParameter.RBS_ELEC_APPARENT_LOAD)
                ?? throw new InvalidOperationException("Electrical connector apparent power built-in parameter was not found.");

            Assert.That(savedDocument.FamilyManager.GetAssociatedFamilyParameter(voltage)?.Definition?.Name, Is.EqualTo(voltageParameterName));
            Assert.That(savedDocument.FamilyManager.GetAssociatedFamilyParameter(poles)?.Definition?.Name, Is.EqualTo(polesParameterName));
            Assert.That(savedDocument.FamilyManager.GetAssociatedFamilyParameter(apparentPower)?.Definition?.Name, Is.EqualTo(apparentPowerParameterName));
        } finally {
            RevitFamilyFixtureHarness.CloseDocument(savedDocument);
        }
    }

    private void AssertRectangularConnectorBuiltInsAreAssociated(
        string savedFamilyPath,
        string widthParameterName,
        string heightParameterName
    ) {
        Document? savedDocument = null;

        try {
            savedDocument = _dbApplication.OpenDocumentFile(savedFamilyPath);
            Assert.That(savedDocument, Is.Not.Null);

            var connector = new FilteredElementCollector(savedDocument!)
                .OfClass(typeof(ConnectorElement))
                .Cast<ConnectorElement>()
                .Single(element =>
                    element.Domain == Domain.DomainHvac &&
                    element.Shape == ConnectorProfileType.Rectangular);

            var width = connector.get_Parameter(BuiltInParameter.CONNECTOR_WIDTH)
                ?? throw new InvalidOperationException("Rectangular connector width built-in parameter was not found.");
            var height = connector.get_Parameter(BuiltInParameter.CONNECTOR_HEIGHT)
                ?? throw new InvalidOperationException("Rectangular connector height built-in parameter was not found.");

            Assert.That(savedDocument.FamilyManager.GetAssociatedFamilyParameter(width)?.Definition?.Name, Is.EqualTo(widthParameterName));
            Assert.That(savedDocument.FamilyManager.GetAssociatedFamilyParameter(height)?.Definition?.Name, Is.EqualTo(heightParameterName));
        } finally {
            RevitFamilyFixtureHarness.CloseDocument(savedDocument);
        }
    }

    private void AssertRectangularExtrusionResizesAcrossTypes(
        string savedFamilyPath,
        string widthParameterName,
        string lengthParameterName,
        IReadOnlyList<RevitFamilyFixtureHarness.FamilyTypeState> states
    ) {
        Document? savedDocument = null;

        try {
            savedDocument = _dbApplication.OpenDocumentFile(savedFamilyPath);
            Assert.That(savedDocument, Is.Not.Null);

            var results = RevitFamilyFixtureHarness.EvaluateLengthDrivenStates(
                savedDocument!,
                states,
                document => RevitFamilyFixtureHarness.MeasureFirstRectangularExtrusionPlanExtents(document));

            foreach (var (typeName, result) in results) {
                var expectedState = states.Single(state => state.Name == typeName);
                var expectedWidth = expectedState.LengthValues[widthParameterName];
                var expectedLength = expectedState.LengthValues[lengthParameterName];
                Assert.That(result.Width, Is.EqualTo(Math.Min(expectedWidth, expectedLength)).Within(1e-4),
                    $"Rectangular extrusion width in type '{typeName}' did not resize correctly.");
                Assert.That(result.Length, Is.EqualTo(Math.Max(expectedWidth, expectedLength)).Within(1e-4),
                    $"Rectangular extrusion length in type '{typeName}' did not resize correctly.");
            }
        } finally {
            RevitFamilyFixtureHarness.CloseDocument(savedDocument);
        }
    }

    private static void AssertOperationHasNoErrors(FamilyProcessingContext context, string operationName) {
        var (logs, error) = context.OperationLogs;
        Assert.That(error, Is.Null);
        Assert.That(logs, Is.Not.Null);

        var operation = logs!
            .Single(log => string.Equals(log.OperationName, operationName, StringComparison.Ordinal));
        var errorMessages = operation.Entries
            .Where(entry => entry.Status == LogStatus.Error)
            .Select(entry => $"{entry.Name}: {entry.Message}")
            .ToList();

        Assert.That(errorMessages, Is.Empty, string.Join(Environment.NewLine, errorMessages));
    }

    private static void AssertConnectorSnapshotJsonContains(string savedFamilyPath, params string[] expectedFragments) {
        var snapshotPath = Path.Combine(
            Path.GetDirectoryName(savedFamilyPath)
            ?? throw new InvalidOperationException("The saved family path had no parent directory."),
            "snapshot-paramdrivensolids-post.json");
        var json = File.ReadAllText(snapshotPath);

        foreach (var fragment in expectedFragments)
            Assert.That(json, Does.Contain(fragment), $"Expected connector snapshot JSON to contain '{fragment}'.");
    }

    private static double GetBoundingBoxVolume(Extrusion extrusion) {
        var box = extrusion.get_BoundingBox(null)
            ?? throw new InvalidOperationException($"Extrusion '{extrusion.Id.IntegerValue}' had no bounding box.");
        return (box.Max.X - box.Min.X) * (box.Max.Y - box.Min.Y) * (box.Max.Z - box.Min.Z);
    }

    private static Extrusion FindCabinetRectangularExtrusion(Document doc) {
        return new FilteredElementCollector(doc)
            .OfClass(typeof(Extrusion))
            .Cast<Extrusion>()
            .Where(IsRectangularExtrusion)
            .OrderBy(extrusion => GetBoundingBox(extrusion).Min.Z)
            .ThenByDescending(GetBoundingBoxVolume)
            .First();
    }

    private static Extrusion FindNearestRectangularStub(Document doc, ConnectorElement connector, ElementId excludedExtrusionId) {
        return new FilteredElementCollector(doc)
            .OfClass(typeof(Extrusion))
            .Cast<Extrusion>()
            .Where(IsRectangularExtrusion)
            .Where(extrusion => extrusion.Id != excludedExtrusionId)
            .OrderBy(extrusion => DistanceSquaredXY(extrusion, connector.Origin))
            .First();
    }

    private static double DistanceSquaredXY(Extrusion extrusion, XYZ target) {
        var box = GetBoundingBox(extrusion);
        var centerX = (box.Min.X + box.Max.X) * 0.5;
        var centerY = (box.Min.Y + box.Max.Y) * 0.5;
        var deltaX = centerX - target.X;
        var deltaY = centerY - target.Y;
        return (deltaX * deltaX) + (deltaY * deltaY);
    }

    private static BoundingBoxXYZ GetBoundingBox(Extrusion extrusion) =>
        extrusion.get_BoundingBox(null)
        ?? throw new InvalidOperationException($"Extrusion '{extrusion.Id.IntegerValue}' had no bounding box.");

    private static bool IsRectangularExtrusion(Extrusion extrusion) {
        var profile = extrusion.Sketch?.Profile;
        if (profile == null || profile.Size != 1)
            return false;

        var loop = profile.get_Item(0);
        return loop != null && loop.Size == 4 && loop.Cast<Curve>().All(curve => curve is Line);
    }

    private static FFManagerProcessFamiliesActionResult RunRoundtrip(
        Document familyDocument,
        ProfileFamilyManager profile,
        string profileName,
        string outputFolderPath
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
            outputFolderPath);

        if (result.Success) {
            Assert.That(result.Contexts, Has.Count.EqualTo(1));
            Assert.That(result.Contexts[0].PostProcessSnapshot, Is.Not.Null);
        }

        return result;
    }

    private static ProfileFamilyManager CreateParamDrivenProfile(
        IReadOnlyList<string> lengthParameters,
        IReadOnlyList<GlobalParamAssignment> assignments,
        IReadOnlyList<ParamDrivenRectangleSpec>? rectangles = null,
        IReadOnlyList<ParamDrivenCylinderSpec>? cylinders = null,
        IReadOnlyList<ParamDrivenConnectorSpec>? connectors = null,
        IReadOnlyList<FamilyParamDefinitionModel>? extraParameters = null,
        IReadOnlyList<MirrorSpec>? mirrorSpecs = null,
        IReadOnlyList<OffsetSpec>? offsetSpecs = null
    ) {
        var rectangleSpecs = rectangles?.ToList() ?? [];
        var cylinderSpecs = cylinders?.ToList() ?? [];
        var connectorSpecs = connectors?.ToList() ?? [];
        var familyParameters = lengthParameters
            .Distinct(StringComparer.Ordinal)
            .Select(name => new FamilyParamDefinitionModel { Name = name, DataType = SpecTypeId.Length })
            .Concat(extraParameters ?? [])
            .ToList();
        var resolvedMirrorSpecs = mirrorSpecs?.ToList() ?? [];
        var resolvedOffsetSpecs = offsetSpecs?.ToList() ?? [];

        return new ProfileFamilyManager {
            ExecutionOptions = new ExecutionOptions { SingleTransaction = false, OptimizeTypeOperations = false },
            FilterFamilies = new BaseProfileSettings.FilterFamiliesSettings {
                IncludeUnusedFamilies = true,
                IncludeCategoriesEqualing = [],
                IncludeNames = new IncludeFamilies { Equaling = ["__CURRENT_FAMILY__"] },
                ExcludeNames = new ExcludeFamilies()
            },
            FilterApsParams = new BaseProfileSettings.FilterApsParamsSettings {
                IncludeNames = new IncludeSharedParameter(),
                ExcludeNames = new ExcludeSharedParameter()
            },
            MakeRefPlaneAndDims = new MakeRefPlaneAndDimsSettings {
                Enabled = resolvedMirrorSpecs.Count > 0 || resolvedOffsetSpecs.Count > 0,
                MirrorSpecs = resolvedMirrorSpecs,
                OffsetSpecs = resolvedOffsetSpecs
            },
            AddFamilyParams = new AddFamilyParamsSettings {
                Enabled = true,
                Parameters = familyParameters
            },
            SetKnownParams = new SetKnownParamsSettings {
                Enabled = true,
                OverrideExistingValues = true,
                GlobalAssignments = assignments.ToList(),
                PerTypeAssignmentsTable = []
            },
            ParamDrivenSolids = new ParamDrivenSolidsSettings {
                Enabled = rectangleSpecs.Count > 0 || cylinderSpecs.Count > 0 || connectorSpecs.Count > 0,
                Rectangles = rectangleSpecs,
                Cylinders = cylinderSpecs,
                Connectors = connectorSpecs
            }
        };
    }

    private sealed record MixedConnectorStateMeasurement(
        IReadOnlyList<double> PipingRoundDiameters,
        double RoundHvacDiameter,
        (double Width, double Length) RectangularHvacSize,
        int ElectricalCount);
}
