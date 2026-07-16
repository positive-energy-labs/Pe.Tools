using Autodesk.Revit.DB.Architecture;
using Autodesk.Revit.DB.Structure;
using Pe.Revit.Extensions.FamDocument;
using Pe.Revit.DocumentData.AgentContext;
using Pe.Revit.FamilyFoundry;
using Pe.Revit.FamilyFoundry.Apply;
using Pe.Revit.FamilyFoundry.Operations;
using Pe.Revit.FamilyFoundry.Profiles;
using Pe.Shared.RevitData.Families;
using System.Globalization;

namespace Pe.Revit.Tests.LibraryBehavior.FamilyFoundry;

[TestFixture]
public sealed class RoomDinglerTests {
    private const string RoomName = "Room Dingler Proof Room";

    [Test]
    public void Manager_and_migrator_queues_include_room_dingler_when_enabled() {
        var managerQueue = FFManagerQueueBuilder.Build(
            new FFManagerProfile { AddRoomDingler = new AddRoomDinglerSettings { Enabled = true } },
            []);
        var migratorQueue = FFMigratorQueueBuilder.Build(
            new FFMigratorProfile { AddRoomDingler = new AddRoomDinglerSettings { Enabled = true } },
            []);

        Assert.Multiple(() => {
            Assert.That(managerQueue.Operations.Select(operation => operation.GetType()),
                Does.Contain(typeof(AddRoomDingler)));
            Assert.That(migratorQueue.Operations.Select(operation => operation.GetType()),
                Does.Contain(typeof(AddRoomDingler)));
        });
    }

    [Test]
    public void Manager_and_migrator_queues_omit_room_dingler_when_disabled() {
        var managerQueue = FFManagerQueueBuilder.Build(new FFManagerProfile(), []);
        var migratorQueue = FFMigratorQueueBuilder.Build(new FFMigratorProfile(), []);

        Assert.Multiple(() => {
            Assert.That(managerQueue.Operations.Select(operation => operation.GetType()),
                Does.Not.Contain(typeof(AddRoomDingler)));
            Assert.That(migratorQueue.Operations.Select(operation => operation.GetType()),
                Does.Not.Contain(typeof(AddRoomDingler)));
        });
    }

    [Test]
    public void Unhosted_room_dingler_processed_family_instance_resolves_placed_room(UIApplication uiApplication) =>
        AssertRoomDinglerProcessedFamilyInstanceResolvesPlacedRoom(RoomDinglerHostKind.Unhosted, uiApplication);

    [Test]
    public void Face_hosted_room_dingler_processed_family_instance_resolves_placed_room(UIApplication uiApplication) =>
        AssertRoomDinglerProcessedFamilyInstanceResolvesPlacedRoom(RoomDinglerHostKind.FaceHosted, uiApplication);

    [Test]
    public void Wall_hosted_room_dingler_processed_family_instance_resolves_placed_room(UIApplication uiApplication) =>
        AssertRoomDinglerProcessedFamilyInstanceResolvesPlacedRoom(RoomDinglerHostKind.WallHosted, uiApplication);

    [Test]
    public void Generated_grd_opens_into_the_room_and_exports_visual_proof(UIApplication uiApplication) {
        var application = uiApplication.Application;
        var fixturePath = RevitFamilyFixtureHarness.GetProfileFixturePath(
            Path.Combine("family-model", "pe-grd-vane.family.json"));
        var parsed = FamilyModelJson.Parse(File.ReadAllText(fixturePath));
        Assert.That(parsed.Diagnostics, Is.Empty,
            string.Join(Environment.NewLine, parsed.Diagnostics.Select(item => item.Message)));
        var outputDirectory = RevitFamilyFixtureHarness.CreateTemporaryOutputDirectory(
            nameof(this.Generated_grd_opens_into_the_room_and_exports_visual_proof));
        var familyDocument = FamilyModelBuilder.Build(
            application,
            parsed.Value!,
            Path.GetDirectoryName(fixturePath)).Document;
        Document? projectDocument = RevitFamilyFixtureHarness.CreateProjectDocument(application);
        UIDocument? activeProject = null;

        try {
            var familyPath = RevitFamilyFixtureHarness.SaveDocumentCopy(
                familyDocument, outputDirectory, "PE GRD Supply");
            var loadedFamily = RevitFamilyFixtureHarness.LoadFamilyIntoProject(
                application, projectDocument, familyPath);
            FamilyInstance instance;
            Room room;
            Wall hostWall;
            using (var transaction = new Transaction(projectDocument, "Place GRD room proof")) {
                _ = transaction.Start();
                (room, hostWall) = BuildSingleRoom(projectDocument);
                var symbol = loadedFamily.GetFamilySymbolIds()
                    .Select(id => (FamilySymbol)projectDocument.GetElement(id))
                    .Single(item => item.Name == "Thirty Seven Vanes");
                if (!symbol.IsActive)
                    symbol.Activate();
                instance = PlaceFaceHostedInstance(projectDocument, symbol, hostWall);
                projectDocument.Regenerate();
                _ = transaction.Commit();
            }

            var openingSide = instance.GetSpatialElementCalculationPoint();
            var wallCenter = ((LocationCurve)hostWall.Location).Curve.Project(openingSide).XYZPoint;
            var backSide = wallCenter + (wallCenter - openingSide);
            Assert.Multiple(() => {
                Assert.That(instance.HasSpatialElementCalculationPoint, Is.True);
                Assert.That(projectDocument.GetRoomAtPoint(openingSide)?.Id, Is.EqualTo(room.Id),
                    "The GRD calculation point must extend into the opening-side room.");
                Assert.That(projectDocument.GetRoomAtPoint(backSide), Is.Null,
                    "The point mirrored across the host wall must remain outside the room.");
            });

            var projectPath = RevitFamilyFixtureHarness.SaveDocumentCopy(
                projectDocument, outputDirectory, "GRD Room Proof");
            RevitFamilyFixtureHarness.CloseDocument(projectDocument);
            projectDocument = null;
            activeProject = uiApplication.OpenAndActivateDocument(projectPath);
            projectDocument = activeProject.Document;
            var view = new FilteredElementCollector(projectDocument)
                .OfClass(typeof(ViewPlan))
                .Cast<ViewPlan>()
                .First(item => !item.IsTemplate && item.ViewType == ViewType.FloorPlan);
            activeProject.ActiveView = view;
            activeProject.RefreshActiveView();
            var wholeImage = RevitViewImageExporter.Export(projectDocument, view, 1600);
            Assert.That(wholeImage.ByteSize, Is.GreaterThan(0), wholeImage.FilePath);
            var proofPath = Path.Combine(
                Path.GetDirectoryName(typeof(RoomDinglerTests).Assembly.Location)!,
                "visual-proof",
                "grd-room-proof.png");
            Directory.CreateDirectory(Path.GetDirectoryName(proofPath)!);
            File.Copy(wholeImage.FilePath, proofPath, true);
            TestContext.Progress.WriteLine($"[PE_FF_VISUAL_PROOF] {proofPath}");
        } finally {
            RevitFamilyFixtureHarness.CloseDocument(familyDocument);
            if (activeProject == null)
                RevitFamilyFixtureHarness.CloseDocument(projectDocument);
        }
    }

    private static void AssertRoomDinglerProcessedFamilyInstanceResolvesPlacedRoom(
        RoomDinglerHostKind hostKind,
        UIApplication uiApplication
    ) {
        var application = uiApplication.Application;
        var outputDirectory = RevitFamilyFixtureHarness.CreateTemporaryOutputDirectory(
            $"{nameof(AssertRoomDinglerProcessedFamilyInstanceResolvesPlacedRoom)}-{hostKind}");
        var familyDocument = CreateFamilyDocument(application, hostKind, $"Room Dingler {hostKind}");
        var projectDocument = RevitFamilyFixtureHarness.CreateProjectDocument(application);

        try {
            using (var transaction = new Transaction(familyDocument, "Add room dingler")) {
                _ = transaction.Start();
                var log = new AddRoomDingler(new AddRoomDinglerSettings { Enabled = true }).Execute(
                    new FamilyDocument(familyDocument),
                    new FamilyProcessingContext { FamilyName = familyDocument.OwnerFamily.Name },
                    new OperationContext());
                Assert.That(log.ErrorCount, Is.EqualTo(0), string.Join(Environment.NewLine, log.Entries.Select(e => e.Message)));
                Assert.That(log.SuccessCount, Is.GreaterThan(0));
                _ = transaction.Commit();
            }

            var familyPath = RevitFamilyFixtureHarness.SaveDocumentCopy(
                familyDocument,
                outputDirectory,
                familyDocument.OwnerFamily.Name);
            var loadedFamily = RevitFamilyFixtureHarness.LoadFamilyIntoProject(application, projectDocument, familyPath);

            Room room;
            Wall hostWall;
            using (var transaction = new Transaction(projectDocument, "Build room dingler proof project")) {
                _ = transaction.Start();
                (room, hostWall) = BuildSingleRoom(projectDocument);
                var instance = PlaceInstance(projectDocument, loadedFamily, hostKind, hostWall);
                projectDocument.Regenerate();

                Assert.That(instance.HasSpatialElementCalculationPoint, Is.True);
                var calcPoint = instance.GetSpatialElementCalculationPoint();
                var resolvedRoom = projectDocument.GetRoomAtPoint(calcPoint);
                Assert.That(resolvedRoom, Is.Not.Null, $"calcPoint=({calcPoint.X:0.###}, {calcPoint.Y:0.###}, {calcPoint.Z:0.###}) hostKind={hostKind}");
                Assert.That(resolvedRoom!.Id, Is.EqualTo(room.Id));
                _ = transaction.RollBack();
            }
        } finally {
            RevitFamilyFixtureHarness.CloseDocument(familyDocument);
            RevitFamilyFixtureHarness.CloseDocument(projectDocument);
        }
    }

    private static Document CreateFamilyDocument(
        Application application,
        RoomDinglerHostKind hostKind,
        string familyName
    ) {
        var templateName = hostKind switch {
            RoomDinglerHostKind.FaceHosted => "Generic Model face based.rft",
            RoomDinglerHostKind.WallHosted => "Mechanical Equipment wall based.rft",
            _ => "Mechanical Equipment.rft"
        };
        var document = application.NewFamilyDocument(ResolveFamilyTemplatePath(application, templateName));
        using var transaction = new Transaction(document, "Configure room dingler test family");
        _ = transaction.Start();
        document.OwnerFamily.Name = familyName;
        var category = Category.GetCategory(document, BuiltInCategory.OST_MechanicalEquipment);
        if (category != null)
            document.OwnerFamily.FamilyCategory = category;
        _ = transaction.Commit();
        return document;
    }

    private static string ResolveFamilyTemplatePath(Application application, string templateName) {
        var root = application.FamilyTemplatePath;
        var path = Directory.EnumerateFiles(root, templateName, SearchOption.AllDirectories).FirstOrDefault();
        if (!string.IsNullOrWhiteSpace(path))
            return path;

        throw new FileNotFoundException(
            string.Format(CultureInfo.InvariantCulture, "Family template '{0}' was not found under '{1}'.", templateName, root));
    }

    private static (Room Room, Wall HostWall) BuildSingleRoom(Document document) {
        var level = new FilteredElementCollector(document)
            .OfClass(typeof(Level))
            .Cast<Level>()
            .OrderBy(item => item.Elevation)
            .First();
        var curves = new[] {
            Line.CreateBound(new XYZ(0, 0, 0), new XYZ(10, 0, 0)),
            Line.CreateBound(new XYZ(10, 0, 0), new XYZ(10, 10, 0)),
            Line.CreateBound(new XYZ(10, 10, 0), new XYZ(0, 10, 0)),
            Line.CreateBound(new XYZ(0, 0, 0), new XYZ(0, 10, 0))
        };
        var walls = curves
            .Select(curve => Wall.Create(document, curve, level.Id, false))
            .ToList();
        var room = document.Create.NewRoom(level, new UV(5, 5));
        room.Name = RoomName;
        document.Regenerate();
        return (room, walls[3]);
    }

    private static FamilyInstance PlaceInstance(
        Document document,
        Family family,
        RoomDinglerHostKind hostKind,
        Wall hostWall
    ) {
        var symbol = family.GetFamilySymbolIds()
            .Select(id => (FamilySymbol)document.GetElement(id))
            .First();
        if (!symbol.IsActive)
            symbol.Activate();

        return hostKind switch {
            RoomDinglerHostKind.WallHosted => document.Create.NewFamilyInstance(
                new XYZ(0, 5, 4),
                symbol,
                hostWall,
                StructuralType.NonStructural),
            RoomDinglerHostKind.FaceHosted => PlaceFaceHostedInstance(document, symbol, hostWall),
            _ => document.Create.NewFamilyInstance(
                new XYZ(5, 5, 0),
                symbol,
                StructuralType.NonStructural)
        };
    }

    private static FamilyInstance PlaceFaceHostedInstance(
        Document document,
        FamilySymbol symbol,
        Wall hostWall
    ) {
        var reference = HostObjectUtils.GetSideFaces(hostWall, ShellLayerType.Interior).First();
        return document.Create.NewFamilyInstance(reference, new XYZ(0, 5, 4), XYZ.BasisZ, symbol);
    }

}

public enum RoomDinglerHostKind {
    Unhosted,
    FaceHosted,
    WallHosted
}
