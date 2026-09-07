using Autodesk.Revit.DB.Architecture;
using Autodesk.Revit.DB.Structure;
using Pe.Revit.Extensions.FamDocument;
using Pe.Revit.DocumentData.AgentContext;
using Pe.Revit.FamilyFoundry;
using Pe.Revit.FamilyFoundry.Apply;
using Pe.Revit.FamilyFoundry.Operations;
using Pe.Revit.FamilyFoundry.Reconcile;
using Pe.Shared.RevitData.Families;
using System.Globalization;
using Newtonsoft.Json.Linq;

namespace Pe.Revit.Tests.LibraryBehavior.FamilyFoundry;

[TestFixture]
public sealed class RoomDinglerTests {
    private const string RoomName = "Room Dingler Proof Room";

    [Test]
    public void Native_room_point_parameters_report_binding_and_position_response(UIApplication uiApplication) {
        RevitTestFailureGuard.EnsureInstalled(uiApplication.Application);
        var output = RevitFamilyFixtureHarness.CreateTemporaryOutputDirectory(nameof(Native_room_point_parameters_report_binding_and_position_response));
        var evidence = new JArray();
        try {
            foreach (var template in new[] { "Mechanical Equipment.rft", "Generic Model face based.rft", "Mechanical Equipment wall based.rft", "Door.rft" }) {
                var document = uiApplication.Application.NewFamilyDocument(ResolveFamilyTemplatePath(uiApplication.Application, template));
                try {
                    using var transaction = new Transaction(document, "Probe room point native bindings");
                    transaction.Start();
                    document.OwnerFamily.ShowSpatialElementCalculationPoint = true;
                    var manager = document.FamilyManager;
                    if (manager.CurrentType is null) manager.NewType("Binding probe");
                    var source = manager.AddParameter("Probe room offset", GroupTypeId.Geometry, SpecTypeId.Length, false);
                    manager.Set(source, 1d);
                    document.Regenerate();
                    var points = new FilteredElementCollector(document).WhereElementIsNotElementType().OfType<SpatialElementCalculationLocation>().ToList();
                    Assert.That(points, Is.Not.Empty, template);
                    foreach (var point in points) {
                        var row = new JObject { ["template"] = template, ["class"] = point.GetType().Name, ["parameters"] = new JArray() };
                        evidence.Add(row);
                        foreach (Parameter parameter in point.Parameters) {
                            var item = new JObject { ["name"] = parameter.Definition.Name, ["spec"] = parameter.Definition.GetDataType().TypeId,
                                ["storage"] = parameter.StorageType.ToString(), ["readOnly"] = parameter.IsReadOnly };
                            ((JArray)row["parameters"]!).Add(item);
                            item["canAssociate"] = manager.CanElementParameterBeAssociated(parameter);
                            if (!(bool)item["canAssociate"]! || parameter.Definition.GetDataType() != SpecTypeId.Length) continue;
                            using var attempt = new SubTransaction(document);
                            attempt.Start();
                            try {
                                manager.AssociateElementParameterToFamilyParameter(parameter, source);
                                manager.Set(source, 1d);
                                document.Regenerate();
                                item["atOneFoot"] = Positions(point);
                                manager.Set(source, 2d);
                                document.Regenerate();
                                item["atTwoFeet"] = Positions(point);
                                item["associationReadback"] = manager.GetAssociatedFamilyParameter(parameter)?.Definition.Name;
                            } catch (Exception error) { item["error"] = error.ToString(); }
                            finally { attempt.RollBack(); }
                        }
                    }
                    transaction.RollBack();
                } finally { document.Close(false); }
            }
        } finally { File.WriteAllText(Path.Combine(output, "room-point-native-bindings.json"), evidence.ToString()); }

        static JArray Positions(SpatialElementCalculationLocation point) => new((point is SpatialElementCalculationPoint single
            ? new[] { single.Position } : point is SpatialElementFromToCalculationPoints pair ? new[] { pair.FromPosition, pair.ToPosition } : [])
            .Select(p => new JArray(p.X, p.Y, p.Z)));
    }

    [Test]
    public void Reconciler_enables_moves_disables_and_reapplies_room_point(UIApplication uiApplication) {
        var document = CreateFamilyDocument(uiApplication.Application, RoomDinglerHostKind.Unhosted, "Room point desired state");
        try {
            using var processor = new OperationProcessor(document);
            foreach (var state in new[] { "{\"enabled\":true,\"offset\":\"1ft\"}", "{\"enabled\":true,\"offset\":\"2ft\"}", "{\"enabled\":false}" }) {
                for (var pass = 0; pass < 2; pass++) {
                    var operation = new ReconcileFamily(FamilyPatch.Parse("{\"patch\":{\"roomCalculationPoint\":" + state + "}}"));
                    var (contexts, _) = processor.ProcessQueue(new OperationQueue().Add(operation));
                    var (_, error) = contexts.Single().OperationLogs;
                    Assert.That(error, Is.Null, error?.Message);
                    Assert.That(operation.LastReceipt?.Converged, Is.True);
                    if (pass == 1) Assert.That(operation.LastPlan!.Changes, Is.Empty);
                }
                var enabled = !state.Contains("false");
                Assert.That(document.OwnerFamily.ShowSpatialElementCalculationPoint, Is.EqualTo(enabled));
                if (enabled) Assert.That(new FilteredElementCollector(document).OfClass(typeof(SpatialElementCalculationPoint))
                    .Cast<SpatialElementCalculationPoint>().Single().Position.Z, Is.EqualTo(state.Contains("2ft") ? 2d : 1d).Within(1e-9));
                if (state.Contains("2ft")) {
                    var change = new ReconcileFamily(FamilyPatch.Parse("""{"patch":{"roomCalculationPoint":{"enabled":true,"offset":"4ft"}}}"""));
                    var (failed, _) = processor.ProcessQueue(new OperationQueue().Add(change).Add(new RenameParams([("missing parameter", "never created")])));
                    var (_, error) = failed.Single().OperationLogs;
                    Assert.That(error, Is.Not.Null);
                    Assert.That(change.LastReceipt?.Converged ?? false, Is.False);
                    Assert.That(new FilteredElementCollector(document).OfClass(typeof(SpatialElementCalculationPoint))
                        .Cast<SpatialElementCalculationPoint>().Single().Position.Z, Is.EqualTo(2d).Within(1e-9));
                }
            }
            processor.ProcessQueue(new OperationQueue().Add(new AddRoomDingler(new AddRoomDinglerSettings { Enabled = false })));
            Assert.That(document.OwnerFamily.ShowSpatialElementCalculationPoint, Is.False, "Legacy Enabled=false must still skip the operation.");
            var rejected = new ReconcileFamily(FamilyPatch.Parse("""{"patch":{"parameters":{"Room Offset":{"dataType":"Length","value":"3ft"}},"roomCalculationPoint":{"enabled":true,"offset":"param:Room Offset"}}}"""));
            var (refused, _) = processor.ProcessQueue(new OperationQueue().Add(rejected));
            var (_, refusal) = refused.Single().OperationLogs;
            Assert.That(refusal, Is.Not.Null);
            Assert.That(document.FamilyManager.get_Parameter("Room Offset"), Is.Null, "Refuse before mutation.");
            Assert.That(document.OwnerFamily.ShowSpatialElementCalculationPoint, Is.False);
        } finally { document.Close(false); }
    }

    [Test]
    public void Reconcile_plan_includes_room_dingler_only_when_the_document_declares_the_point() {
        var header = new FamilyModelHeader { Name = "T", Category = FamilyCategory.GenericModels, Template = "Generic Model", Placement = FamilyModelPlacement.OneLevelBased };
        var with = new FamilyModel { Family = header, RoomCalculationPoint = new FamilyModelRoomCalculationPoint { Enabled = true } };
        var without = new FamilyModel { Family = header };
        var template = new FamilyModel { Family = header };

        Assert.Multiple(() => {
            Assert.That(FamilyReconciler.Reconcile(with, template, UnitResolvers.Portable).Queue.Operations.Select(o => o.GetType()), Does.Contain(typeof(AddRoomDingler)));
            Assert.That(FamilyReconciler.Reconcile(without, template, UnitResolvers.Portable).Queue.Operations.Select(o => o.GetType()), Does.Not.Contain(typeof(AddRoomDingler)));
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
        var parsed = RevitFamilyFixtureHarness.LoadFamilyModelFixture("b-grd");
        var outputDirectory = RevitFamilyFixtureHarness.CreateTemporaryOutputDirectory(
            nameof(this.Generated_grd_opens_into_the_room_and_exports_visual_proof));
        var familyDocument = FamilyModelBuild.Build(application, parsed).Document;
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
                    .First();
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
