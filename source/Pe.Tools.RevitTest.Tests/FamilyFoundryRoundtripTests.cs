using Pe.FamilyFoundry;
using Pe.FamilyFoundry.Aggregators.Snapshots;
using Pe.FamilyFoundry.OperationSettings;
using Pe.FamilyFoundry.Snapshots;
using Pe.SettingsCatalog.Revit.FamilyFoundry;
using Pe.Tools.Commands.FamilyFoundry;

namespace Pe.Tools.RevitTest.Tests;

[TestFixture]
public sealed class FamilyFoundryRoundtripTests {
    private Autodesk.Revit.ApplicationServices.Application _dbApplication = null!;
    private const BuiltInCategory TestFamilyCategory = BuiltInCategory.OST_GenericModel;
    private const string BlankFamilyName = "FF-Test-BlankFamily";
    private const string RoundtripFamilyName = "FF-Test-MagicBox";
    private const string CylinderFamilyName = "FF-Test-Cylinder";
    private const string StackedBoxesFamilyName = "FF-Test-StackedBoxes";
    private const string BoxWithCylinderFamilyName = "FF-Test-BoxWithCylinder";
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
                        CenterLeftRightAnchor = "Center (Left/Right)",
                        CenterFrontBackAnchor = "Center (Front/Back)",
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
                        CenterLeftRightAnchor = "Center (Left/Right)",
                        CenterFrontBackAnchor = "Center (Front/Back)",
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
        Assert.That(cylinder.CenterLeftRightAnchor, Is.EqualTo("Center (Left/Right)"));
        Assert.That(cylinder.CenterFrontBackAnchor, Is.EqualTo("Center (Front/Back)"));
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
        Assert.That(cylinder.CenterLeftRightAnchor, Is.EqualTo("Center (Left/Right)"));
        Assert.That(cylinder.CenterFrontBackAnchor, Is.EqualTo("Center (Front/Back)"));
        Assert.That(cylinder.Diameter.Parameter, Is.EqualTo("Diameter"));
        Assert.That(cylinder.Height.Anchor, Is.EqualTo("box top"));
        Assert.That(cylinder.Height.Parameter, Is.EqualTo("CylinderHeight"));
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
        IReadOnlyList<ParamDrivenCylinderSpec>? cylinders = null
    ) {
        var rectangleSpecs = rectangles?.ToList() ?? [];
        var cylinderSpecs = cylinders?.ToList() ?? [];

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
                Enabled = false,
                MirrorSpecs = [],
                OffsetSpecs = []
            },
            AddFamilyParams = new AddFamilyParamsSettings {
                Enabled = true,
                Parameters = lengthParameters
                    .Distinct(StringComparer.Ordinal)
                    .Select(name => new FamilyParamDefinitionModel { Name = name, DataType = SpecTypeId.Length })
                    .ToList()
            },
            SetKnownParams = new SetKnownParamsSettings {
                Enabled = true,
                OverrideExistingValues = true,
                GlobalAssignments = assignments.ToList(),
                PerTypeAssignmentsTable = []
            },
            ParamDrivenSolids = new ParamDrivenSolidsSettings {
                Enabled = rectangleSpecs.Count > 0 || cylinderSpecs.Count > 0,
                Rectangles = rectangleSpecs,
                Cylinders = cylinderSpecs
            }
        };
    }
}
