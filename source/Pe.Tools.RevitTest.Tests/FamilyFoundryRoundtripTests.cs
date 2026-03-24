using Pe.FamilyFoundry;
using Pe.FamilyFoundry.Aggregators.Snapshots;
using Pe.FamilyFoundry.OperationSettings;
using Pe.FamilyFoundry.Snapshots;
using Pe.Tools.Commands.FamilyFoundry;

namespace Pe.Tools.RevitTest.Tests;

[TestFixture]
public sealed class FamilyFoundryRoundtripTests {
    private Autodesk.Revit.ApplicationServices.Application _dbApplication = null!;
    private const BuiltInCategory TestFamilyCategory = BuiltInCategory.OST_GenericModel;
    private const string BlankFamilyName = "FF-Test-BlankFamily";
    private const string RoundtripFamilyName = "FF-Test-MagicBox";
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
        Assert.That(snapshot.RefPlanesAndDims.MirrorSpecs, Has.Count.EqualTo(2));
        Assert.That(snapshot.RefPlanesAndDims.OffsetSpecs, Has.Count.EqualTo(1));
        Assert.That(snapshot.Extrusions.Rectangles, Has.Count.EqualTo(1));
        Assert.That(snapshot.Extrusions.Rectangles[0].Name, Is.EqualTo("MagicBox"));
    }
}
