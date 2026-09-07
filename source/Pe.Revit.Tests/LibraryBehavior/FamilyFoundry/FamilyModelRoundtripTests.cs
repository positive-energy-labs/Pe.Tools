using Pe.Revit.FamilyFoundry.Apply;
using Pe.Revit.FamilyFoundry.Reconcile;
using Pe.Revit.Extensions.FamDocument;
using Pe.Shared.RevitData.Families;
using Newtonsoft.Json.Linq;

namespace Pe.Revit.Tests;

/// <summary>Native family.json acceptance through saved RFAs, with no authored state available to capture.</summary>
[TestFixture]
public sealed class FamilyModelRoundtripTests {
    private UIApplication _ui = null!;

    [OneTimeSetUp]
    public void SetUp(UIApplication ui) => this._ui = ui;

    [Test]
    public void Rejected_template_placement_leaves_no_open_document() {
        var application = this._ui.Application;
        var before = application.Documents.Cast<Document>().ToArray();
        var model = new FamilyModel { Family = new FamilyModelHeader {
            Name = "Rejected placement", Category = FamilyCategory.GenericModels,
            Template = "Generic Model", Placement = FamilyModelPlacement.ViewBased
        } };
        Assert.Throws<InvalidOperationException>(() => FamilyModelBuild.Build(application, model));
        Assert.That(application.Documents.Cast<Document>(), Is.EquivalentTo(before));
    }

    [Test]
    public void Reapply_moves_a_named_plane_in_the_same_family() {
        var parsed = FamilyModelJson.Parse("""
            { "family": { "name": "Plane reapply", "category": "GenericModels", "template": "Generic Model", "placement": "OneLevelBased" },
              "types": { "Standard": {} }, "refPlanes": { "Service clearance": { "normal": "PlusX", "at": "1ft" } } }
            """);
        Assert.That(parsed.Diagnostics, Is.Empty);
        var desired = parsed.Value!;
        Document? document = null;
        try {
            var built = FamilyModelBuild.Build(this._ui.Application, desired);
            document = built.Document;
            Assert.That(built.Receipt?.Converged, Is.True);
            desired.RefPlanes["Service clearance"] = new FamilyModelRefPlane { Normal = Axis.PlusX, At = PortableLength.FromFeet(2) };
            var receipt = FamilyModelBuild.Reconcile(document, desired);
            Assert.That(receipt?.Converged, Is.True);
            var plane = new FilteredElementCollector(document).OfClass(typeof(ReferencePlane)).Cast<ReferencePlane>()
                .Single(p => p.Name == "Service clearance");
            Assert.That(plane.GetPlane().Origin.X, Is.EqualTo(2).Within(1e-7));
        } finally {
            RevitFamilyFixtureHarness.CloseDocument(document);
        }
    }

    [Test]
    public void Raw_prism_profile_reapplies_after_native_capture() {
        const string json = """
            { "family": { "name": "Raw profile reapply", "category": "GenericModels", "template": "Generic Model", "placement": "OneLevelBased" },
              "types": { "Standard": {} },
              "datums": { "Ref. Level": { "normal": "Z", "isLevel": true }, "Center (Left/Right)": { "normal": "X" }, "Center (Front/Back)": { "normal": "Y" } },
              "forms": { "body": { "kind": "Prism", "center": ["Center (Left/Right)", "Center (Front/Back)"], "bottom": "Ref. Level", "width": "2ft", "depth": "2ft", "height": "2ft" } } }
            """;
        Document? document = null;
        try {
            document = FamilyModelBuild.Build(this._ui.Application, FamilyModelJson.Parse(json).Value!).Document;
            // Routes send the composed authored JSON, which still contains the Prism macro.
            var operation = new ReconcileFamily(FamilyPatch.Parse("{\"patch\":" + json + "}"));
            using var processor = new Pe.Revit.FamilyFoundry.OperationProcessor(document);
            var (contexts, _) = processor.ProcessQueue(new Pe.Revit.FamilyFoundry.OperationQueue().Add(operation));
            var (logs, error) = contexts.Single().OperationLogs;
            Assert.That(error, Is.Null, error?.Message);
            Assert.That(logs?.SelectMany(log => log.Entries).Where(entry => entry.Status == Pe.Revit.FamilyFoundry.LogStatus.Error), Is.Empty);
            Assert.That(operation.LastReceipt?.Converged, Is.True);
            Assert.That(operation.LastReceipt!.Outcomes, Is.Empty);
        } finally { RevitFamilyFixtureHarness.CloseDocument(document); }
    }

    [Test]
    public void Native_electrical_connector_reference_plane_host_probe() {
        Document? document = null;
        var directory = RevitFamilyFixtureHarness.CreateTemporaryOutputDirectory(nameof(Native_electrical_connector_reference_plane_host_probe));
        try {
            document = RevitFamilyFixtureHarness.CreateFamilyDocument(this._ui.Application, BuiltInCategory.OST_ElectricalEquipment, "Connector plane probe");
            using var transaction = new Transaction(document, "Probe native connector hosting");
            transaction.Start();
            var plane = new FilteredElementCollector(document).OfClass(typeof(ReferencePlane)).Cast<ReferencePlane>().First();
            try {
                var connector = ConnectorElement.CreateElectricalConnector(document, Autodesk.Revit.DB.Electrical.ElectricalSystemType.PowerCircuit, plane.GetReference());
                document.Regenerate();
                Assert.That(connector.IsValidObject, Is.True);
                File.WriteAllText(Path.Combine(directory, "connector-plane-host.json"), Newtonsoft.Json.JsonConvert.SerializeObject(new { accepted = true, plane = plane.Name, connector = connector.Id.Value() }));
            } catch (Autodesk.Revit.Exceptions.ArgumentException exception) {
                File.WriteAllText(Path.Combine(directory, "connector-plane-host.json"), Newtonsoft.Json.JsonConvert.SerializeObject(new { accepted = false, exception = exception.GetType().FullName, exception.Message }));
            }
            transaction.RollBack();
        } finally { RevitFamilyFixtureHarness.CloseDocument(document); }
    }

    [Test]
    public void Native_wall_template_exposes_its_actual_planes_and_views() {
        var header = RevitFamilyFixtureHarness.LoadFamilyModelFixture("c-bath-shower").Family;
        var document = FamilyTemplate.NewDocument(this._ui.Application, header);
        try {
            static double[] Point(XYZ point) => [point.X, point.Y, point.Z];
            var planes = new FilteredElementCollector(document).OfClass(typeof(ReferencePlane)).Cast<ReferencePlane>()
                .Select(p => new { p.Name, origin = Point(p.GetPlane().Origin), normal = Point(p.GetPlane().Normal) }).ToArray();
            var views = new FilteredElementCollector(document).OfClass(typeof(View)).Cast<View>()
                .Where(v => !v.IsTemplate && v.ViewType is ViewType.Elevation or ViewType.Section or ViewType.FloorPlan)
                .Select(v => new { v.Name, type = v.ViewType.ToString(), direction = Point(v.ViewDirection) }).ToArray();
            Assert.That(planes, Is.Not.Empty);
            Assert.That(views, Is.Not.Empty);
            var directory = RevitFamilyFixtureHarness.CreateTemporaryOutputDirectory(nameof(Native_wall_template_exposes_its_actual_planes_and_views));
            File.WriteAllText(Path.Combine(directory, "wall-template-geometry.json"), Newtonsoft.Json.JsonConvert.SerializeObject(new { header.Template, planes, views }));
        } finally { RevitFamilyFixtureHarness.CloseDocument(document); }
    }

    [TestCase(false)]
    [TestCase(true)]
    public void Symbolic_loop_roundtrip_preserves_geometry_and_reapplies_visibility_binding(bool circle) {
        var curveJson = circle
            ? """[{"kind":"Circle","center":["Center (Left/Right)","Center (Front/Back)"],"diameter":"param:Diameter"}]"""
            : """[{"kind":"Line","on":"left"},{"kind":"Line","on":"back"},{"kind":"Line","on":"right"},{"kind":"Line","on":"front"}]""";
        var parsed = FamilyModelJson.Parse($$"""
            { "family": { "name": "Symbolic detail", "category": "GenericModels", "template": "Generic Model", "placement": "OneLevelBased" },
              "parameters": { "Show": { "dataType": "YesNo", "value": "Yes" }, "Hide": { "dataType": "YesNo", "value": "No" }, "Diameter": { "dataType": "Length", "value": "1ft" } },
              "types": { "Standard": {} },
              "datums": { "Ref. Level": { "normal": "Z", "isLevel": true }, "Center (Left/Right)": { "normal": "X" }, "Center (Front/Back)": { "normal": "Y" } },
              "refPlanes": { "left": { "normal": "PlusX", "at": "-1ft" }, "right": { "normal": "PlusX", "at": "1ft" }, "front": { "normal": "PlusY", "at": "-1ft" }, "back": { "normal": "PlusY", "at": "1ft" } },
              "details": { "Authored outline": { "view": "RefLevel", "curves": [{ "curves": {{curveJson}} }], "visible": "param:Show" } } }
            """);
        Assert.That(parsed.Diagnostics, Is.Empty);
        var output = RevitFamilyFixtureHarness.CreateTemporaryOutputDirectory(nameof(Symbolic_loop_roundtrip_preserves_geometry_and_reapplies_visibility_binding));
        var path = Path.Combine(output, "symbolic.rfa");
        var authored = parsed.Value!;
        _ = FamilyModelBuild.BuildAndSave(this._ui.Application, authored, path);
        Document? reopened = null;
        Document? rebuilt = null;
        try {
            reopened = this._ui.Application.OpenDocumentFile(path);
            var captured = reopened.CaptureFamilyModel();
            Assert.That(captured.Coverage["details"], Is.EqualTo(CoverageState.Read));
            Assert.That(captured.Details, Has.Count.EqualTo(1));
            Assert.That(captured.Details.Values.Single().Visible, Is.EqualTo("param:Show"));
            Assert.That(new FilteredElementCollector(reopened).OfClass(typeof(CurveElement)).OfType<SymbolicCurve>().Count(), Is.EqualTo(circle ? 1 : 4));
            rebuilt = FamilyModelBuild.Build(this._ui.Application, captured).Document;
            if (circle) {
                using var perturb = new Transaction(rebuilt, "Verify symbolic diameter driver");
                perturb.Start();
                rebuilt.FamilyManager.Set(rebuilt.FamilyManager.get_Parameter("Diameter"), 2d);
                rebuilt.Regenerate();
                var arc = (Arc)new FilteredElementCollector(rebuilt).OfClass(typeof(CurveElement)).OfType<SymbolicCurve>().Single().GeometryCurve;
                Assert.That(arc.Radius, Is.EqualTo(1d).Within(1e-9));
                Assert.That(arc.Center.DistanceTo(XYZ.Zero), Is.LessThan(1e-9));
                perturb.RollBack();
            } else {
                var points = new FilteredElementCollector(rebuilt).OfClass(typeof(CurveElement)).OfType<SymbolicCurve>()
                    .SelectMany(curve => new[] { curve.GeometryCurve.GetEndPoint(0), curve.GeometryCurve.GetEndPoint(1) }).ToList();
                Assert.That(points.All(point => Math.Abs(Math.Abs(point.X) - 1) < 1e-9 && Math.Abs(Math.Abs(point.Y) - 1) < 1e-9), Is.True);
            }
            var outline = authored.Details["Authored outline"];
            authored.Details["Authored outline"] = new FamilyModelDetail { View = outline.View, Curves = outline.Curves, Visible = "param:Hide" };
            Assert.That(FamilyModelBuild.Reconcile(rebuilt, authored)?.Converged, Is.True);
            foreach (var curve in new FilteredElementCollector(rebuilt).OfClass(typeof(CurveElement)).OfType<SymbolicCurve>()) {
                var visibility = curve.get_Parameter(BuiltInParameter.IS_VISIBLE_PARAM);
                Assert.That(rebuilt.FamilyManager.GetAssociatedFamilyParameter(visibility)?.Definition.Name, Is.EqualTo("Hide"));
                Assert.That(visibility.AsInteger(), Is.Zero);
            }
            Assert.That(FamilyModelBuild.Reconcile(rebuilt, authored)!.Outcomes, Is.Empty);
            foreach (var element in new FilteredElementCollector(rebuilt).WhereElementIsNotElementType()) Assert.That(element.GetEntitySchemaGuids(), Is.Empty);
        } finally {
            RevitFamilyFixtureHarness.CloseDocument(rebuilt);
            RevitFamilyFixtureHarness.CloseDocument(reopened);
        }
    }

    [Test]
    public void Reapply_deletes_only_the_named_small_form_on_a_shared_sketch_plane() {
        var model = FamilyModelJson.Parse("""
            { "family": { "name": "Exact form deletion", "category": "GenericModels", "template": "Generic Model", "placement": "OneLevelBased" },
              "types": { "Standard": {} },
              "datums": { "Ref. Level": { "normal": "Z", "isLevel": true }, "Center (Left/Right)": { "normal": "X" }, "Center (Front/Back)": { "normal": "Y" } },
              "forms": {
                "tiny": { "kind": "Prism", "center": ["Center (Left/Right)", "Center (Front/Back)"], "bottom": "Ref. Level", "width": "1in", "depth": "1in", "height": "1in" },
                "large": { "kind": "Prism", "center": ["Center (Left/Right)", "Center (Front/Back)"], "bottom": "Ref. Level", "width": "2ft", "depth": "2ft", "height": "2ft" }
              } }
            """).Value!;
        Document? document = null;
        try {
            document = FamilyModelBuild.Build(this._ui.Application, model).Document;
            var forms = new FilteredElementCollector(document).OfClass(typeof(Extrusion)).Cast<Extrusion>()
                .OrderBy(form => (form.get_BoundingBox(null).Max - form.get_BoundingBox(null).Min).GetLength()).ToList();
            Assert.That(forms, Has.Count.EqualTo(2));
            var tiny = forms[0].Id;
            var large = forms[1].Id;
            var operation = new ReconcileFamily(FamilyPatch.Parse("""{"patch":{"forms":{"tiny":null}}}"""));
            using var processor = new Pe.Revit.FamilyFoundry.OperationProcessor(document);
            var (contexts, _) = processor.ProcessQueue(new Pe.Revit.FamilyFoundry.OperationQueue().Add(operation));
            var (_, error) = contexts.Single().OperationLogs;
            Assert.That(error, Is.Null, error?.Message);
            Assert.That(operation.LastReceipt?.Converged, Is.True);
            Assert.That(document.GetElement(tiny), Is.Null);
            Assert.That(document.GetElement(large), Is.Not.Null, "The other form must retain its native identity.");
            Assert.That(new FilteredElementCollector(document).OfClass(typeof(Extrusion)).GetElementCount(), Is.EqualTo(1));
        } finally { RevitFamilyFixtureHarness.CloseDocument(document); }
    }

    [Test]
    public void Native_stub_circle_roundtrips_and_remains_diameter_driven() {
        var artifact = FamilyFoundryRoundtripHarness.RunFamilyModelRoundtrip(
            this._ui.Application, "stub.family.json", "native-roundtrip-stub-circle");
        Document? readback = null;
        try {
            var capturedCircle = artifact.CapturedFromA.Forms.Values.Single().Profile!.Single().Curves.Single();
            Assert.That(capturedCircle.Kind, Is.EqualTo(CurveKind.Circle));
            Assert.That(capturedCircle.Diameter?.Parameter, Is.EqualTo("_diameter"));

            const double diameter = 1.5 / 12.0;
            using (var perturb = new Transaction(artifact.ReopenedB, "Verify native circle diameter driver")) {
                perturb.Start();
                artifact.ReopenedB.FamilyManager.Set(artifact.ReopenedB.FamilyManager.get_Parameter("_diameter"), diameter);
                artifact.ReopenedB.Regenerate();
                perturb.Commit();
            }
            artifact.ReopenedB.Save();
            RevitFamilyFixtureHarness.CloseDocument(artifact.ReopenedB);

            readback = RevitFamilyFixtureHarness.OpenFamilyDocument(this._ui.Application, artifact.SavedBPath);
            Assert.That(readback.FamilyManager.CurrentType.AsDouble(readback.FamilyManager.get_Parameter("_diameter")),
                Is.EqualTo(diameter).Within(1e-9));
            var circularExtrusions = new FilteredElementCollector(readback).OfClass(typeof(Extrusion)).Cast<Extrusion>()
                .Select(extrusion => extrusion.Sketch.Profile.Cast<CurveArray>()
                    .SelectMany(loop => loop.Cast<Curve>()).OfType<Arc>().ToList())
                .Where(arcs => arcs.Count > 0).ToList();
            Assert.That(circularExtrusions, Has.Count.EqualTo(1), "Support geometry must not be mistaken for the driven cylinder.");
            foreach (var arc in circularExtrusions.Single()) Assert.That(arc.Radius * 2, Is.EqualTo(diameter).Within(1e-9));
            var recaptured = readback.CaptureFamilyModel().Forms.Values
                .SelectMany(form => form.Profile ?? []).SelectMany(loop => loop.Curves)
                .Single(curve => curve.Kind == CurveKind.Circle);
            Assert.That(recaptured.Diameter?.Parameter, Is.EqualTo("_diameter"));
        } finally {
            RevitFamilyFixtureHarness.CloseDocument(readback);
            artifact.CloseDocuments();
        }
    }

    [Test]
    public void Portable_values_preserve_units_and_literal_text_and_reapply_without_changes() {
        var parsed = FamilyModelJson.Parse("""
            { "family": { "name": "Portable angle", "category": "GenericModels", "template": "Generic Model", "placement": "OneLevelBased" },
              "parameters": { "Rotation": { "dataType": "Angle", "value": "90deg" }, "Note": { "dataType": "Text", "value": "Rotation" } },
              "types": { "Quarter turn": {}, "Half turn": { "Rotation": "180deg" } } }
            """);
        Assert.That(parsed.Diagnostics, Is.Empty);
        Document? document = null;
        try {
            document = FamilyModelBuild.Build(this._ui.Application, parsed.Value!).Document;
            var parameter = document.FamilyManager.get_Parameter("Rotation");
            foreach (FamilyType type in document.FamilyManager.Types) {
                Assert.That(type.AsDouble(parameter), Is.EqualTo(type.Name == "Half turn" ? Math.PI : Math.PI / 2).Within(1e-9));
                Assert.That(type.AsString(document.FamilyManager.get_Parameter("Note")), Is.EqualTo("Rotation"));
            }
            var receipt = FamilyModelBuild.Reconcile(document, parsed.Value!);
            Assert.That(receipt?.Converged, Is.True);
            Assert.That(receipt!.Outcomes, Is.Empty);
        } finally {
            RevitFamilyFixtureHarness.CloseDocument(document);
        }
    }

    [Test]
    public void Bath_nested_instances_follow_authored_host_geometry() {
        var directory = Path.GetDirectoryName(RevitFamilyFixtureHarness.GetFamilyModelFixturePath("c-bath-shower.family.json"));
        var output = RevitFamilyFixtureHarness.CreateTemporaryOutputDirectory(nameof(Bath_nested_instances_follow_authored_host_geometry));
        WritePipeFixtureUnitsAssociationProbe(this._ui.Application, directory!, output);
        Document? bath = null;
        Document? hinged = null;
        try {
            try {
                bath = FamilyModelBuild.Build(this._ui.Application,
                    RevitFamilyFixtureHarness.LoadFamilyModelFixture("c-bath-shower"), modelDirectory: directory).Document;
            } catch (Exception exception) {
                File.WriteAllText(Path.Combine(output, "bath-connector-association-diagnostic.txt"), exception.ToString());
                throw;
            }
            var pucks = new FilteredElementCollector(bath).OfClass(typeof(FamilyInstance)).Cast<FamilyInstance>()
                .Where(instance => instance.Symbol.Family.Name == "puck").ToList();
            Assert.That(pucks, Has.Count.EqualTo(3));
            Assert.That(pucks.All(instance => Math.Abs(Math.Abs(instance.HandOrientation.DotProduct(XYZ.BasisX)) - 1) < 1e-7),
                Is.True, "Puck Center (Left/Right) references must remain parallel to X-normal host planes.");
            var points = pucks.Select(instance => ((LocationPoint)instance.Location).Point).ToList();
            Assert.That(points.Any(point => Math.Abs(point.X + 0.25) < 1e-7), Is.True, "Cold puck must lie on conn (left).");
            Assert.That(points.Any(point => Math.Abs(point.X - 0.25) < 1e-7), Is.True, "Hot puck must lie on conn (right).");
            Assert.That(points.Any(point => Math.Abs(point.Y - 2.0) < 1e-7), Is.True, "Drain puck must lie on drain y.");
            var fixtureUnitSources = new FilteredElementCollector(bath).OfClass(typeof(ConnectorElement)).Cast<ConnectorElement>()
                .Select(connector => connector.get_Parameter(BuiltInParameter.RBS_PIPE_FIXTURE_UNITS_PARAM))
                .OfType<Parameter>()
                .Select(parameter => bath.FamilyManager.GetAssociatedFamilyParameter(parameter)?.Definition.Name)
                .Where(name => name is not null).ToList();
            Assert.That(fixtureUnitSources, Is.EquivalentTo(new[] {
                "PE_P_LoadCalc_CWFU", "PE_P_LoadCalc_HWFU", "PE_P_LoadCalc_DFU"
            }), "Each pipe connector Fixture Units input must retain its authored shared-parameter association.");
            var capturedBath = bath.CaptureFamilyModel();
            Assert.That(capturedBath.Nested.Values.Where(nested => nested.Family == "puck")
                    .SelectMany(nested => nested.Align ?? []).Select(align => $"{align.Instance}->{align.To}"),
                Is.EquivalentTo(new[] {
                    "Center (Left/Right)->conn (left)",
                    "Center (Left/Right)->conn (right)",
                    "Center (Left/Right)->drain x",
                    "Center (Front/Back)->drain y"
                }), "Every positioned named reference must also receive its authored native lock.");
            Assert.That(capturedBath.Dimensions, Has.Count.EqualTo(6), "Position measurements must not survive as family dimensions.");

            hinged = FamilyModelBuild.Build(this._ui.Application,
                RevitFamilyFixtureHarness.LoadFamilyModelFixture("d-bath-shower-refline"), modelDirectory: directory).Document;
            var lines = new FilteredElementCollector(hinged).OfClass(typeof(CurveElement)).Cast<CurveElement>()
                .OfType<ModelCurve>().Where(line => line.IsReferenceLine).OrderBy(line => line.Id.Value()).ToList();
            var endpoints = lines.Select(line => line.GeometryCurve.GetEndPoint(1)).ToList();
            var stubs = new FilteredElementCollector(hinged).OfClass(typeof(FamilyInstance)).Cast<FamilyInstance>()
                .Where(instance => instance.Symbol.Family.Name == "stub").ToList();
            Assert.That(stubs, Has.Count.EqualTo(2));
            Assert.That(stubs.Select(instance => ((LocationPoint)instance.Location).Point)
                .All(point => endpoints.Any(end => point.IsAlmostEqualTo(end))), Is.True,
                "Each stub must remain at its authored reference-line endpoint.");
            var visibleAssociations = stubs.Count(instance => hinged.FamilyManager.GetAssociatedFamilyParameter(
                instance.get_Parameter(BuiltInParameter.IS_VISIBLE_PARAM))?.Definition.Name == "_hot conn visible");
            Assert.That(visibleAssociations, Is.EqualTo(1), "Only the hot stub visibility is authored.");
        } finally {
            RevitFamilyFixtureHarness.CloseDocument(bath);
            RevitFamilyFixtureHarness.CloseDocument(hinged);
        }
    }

    private static void WritePipeFixtureUnitsAssociationProbe(Application application, string modelDirectory, string output) {
        var evidence = new JObject { ["revitVersion"] = application.VersionNumber, ["connectors"] = new JArray() };
        Document? document = null;
        try {
            var source = JObject.Parse(File.ReadAllText(RevitFamilyFixtureHarness.GetFamilyModelFixturePath("c-bath-shower.family.json")));
            source["connectors"] = new JObject();
            var parsed = FamilyModelJson.Parse(source.ToString(Newtonsoft.Json.Formatting.None));
            if (parsed.Value is null || parsed.Diagnostics.Count != 0)
                throw new InvalidOperationException(string.Join("; ", parsed.Diagnostics.Select(d => $"{d.Path}: {d.Message}")));
            document = FamilyModelBuild.Build(application, parsed.Value, modelDirectory: modelDirectory).Document;
            var host = new FilteredElementCollector(document).OfClass(typeof(ReferencePlane)).Cast<ReferencePlane>()
                .Single(plane => plane.Name == "conn top");
            var manager = document.FamilyManager;
            using var transaction = new Transaction(document, "Probe pipe Fixture Units association prerequisites");
            transaction.Start();
            try {
                var cases = new[] {
                    (Autodesk.Revit.DB.Plumbing.PipeSystemType.DomesticColdWater, FlowDirectionType.In, "PE_P_LoadCalc_CWFU"),
                    (Autodesk.Revit.DB.Plumbing.PipeSystemType.DomesticHotWater, FlowDirectionType.In, "PE_P_LoadCalc_HWFU"),
                    (Autodesk.Revit.DB.Plumbing.PipeSystemType.Sanitary, FlowDirectionType.Out, "PE_P_LoadCalc_DFU")
                };
                foreach (var (systemType, direction, targetName) in cases) {
                    var row = new JObject {
                        ["systemType"] = systemType.ToString(),
                        ["flowDirectionRequested"] = direction.ToString(),
                        ["targetName"] = targetName,
                        ["stages"] = new JArray()
                    };
                    ((JArray)evidence["connectors"]!).Add(row);
                    using var attempt = new SubTransaction(document);
                    attempt.Start();
                    try {
                        var target = manager.get_Parameter(targetName)
                                     ?? throw new InvalidOperationException($"Probe family has no parameter '{targetName}'.");
                        var connector = ConnectorElement.CreatePipeConnector(document, systemType, host.GetReference());
                        document.Regenerate();
                        row["fixtureUnits"] = ParameterFacts(connector.get_Parameter(BuiltInParameter.RBS_PIPE_FIXTURE_UNITS_PARAM));
                        row["familyTarget"] = new JObject {
                            ["id"] = target.Id.Value(),
                            ["name"] = target.Definition.Name,
                            ["storage"] = target.StorageType.ToString(),
                            ["spec"] = target.Definition.GetDataType().TypeId,
                            ["group"] = target.Definition.GetGroupTypeId().TypeId,
                            ["shared"] = target.IsShared,
                            ["guid"] = target.IsShared ? target.GUID : null,
                            ["instance"] = target.IsInstance
                        };
                        AddStage("created");

                        var directionParameter = connector.get_Parameter(BuiltInParameter.RBS_PIPE_FLOW_DIRECTION_PARAM);
                        row["flowDirectionSet"] = directionParameter?.Set((int)direction);
                        document.Regenerate();
                        AddStage("flow-direction-set");

                        var configuration = connector.get_Parameter(BuiltInParameter.RBS_PIPE_FLOW_CONFIGURATION_PARAM);
                        row["demandSet"] = configuration?.Set((int)Autodesk.Revit.DB.Plumbing.PipeFlowConfigurationType.Demand);
                        document.Regenerate();
                        AddStage("demand-set");

                        void AddStage(string stage) {
                            var fixtureUnits = connector.get_Parameter(BuiltInParameter.RBS_PIPE_FIXTURE_UNITS_PARAM)
                                               ?? throw new InvalidOperationException("Native connector has no RBS_PIPE_FIXTURE_UNITS_PARAM.");
                            ((JArray)row["stages"]!).Add(new JObject {
                                ["stage"] = stage,
                                ["domain"] = connector.Domain.ToString(),
                                ["systemClassification"] = connector.SystemClassification.ToString(),
                                ["flowConfiguration"] = EnumParameterFacts<Autodesk.Revit.DB.Plumbing.PipeFlowConfigurationType>(
                                    connector.get_Parameter(BuiltInParameter.RBS_PIPE_FLOW_CONFIGURATION_PARAM)),
                                ["flowDirection"] = EnumParameterFacts<FlowDirectionType>(
                                    connector.get_Parameter(BuiltInParameter.RBS_PIPE_FLOW_DIRECTION_PARAM)),
                                ["canAssociate"] = manager.CanElementParameterBeAssociated(fixtureUnits)
                            });
                        }
                    } catch (Exception exception) {
                        row["error"] = exception.ToString();
                    } finally {
                        if (attempt.GetStatus() == TransactionStatus.Started) attempt.RollBack();
                    }
                }
            } finally {
                if (transaction.GetStatus() == TransactionStatus.Started) transaction.RollBack();
            }
        } catch (Exception exception) {
            evidence["probeError"] = exception.ToString();
        } finally {
            RevitFamilyFixtureHarness.CloseDocument(document);
            File.WriteAllText(Path.Combine(output, "bath-connector-association-prerequisites.json"), evidence.ToString());
        }

        static JObject ParameterFacts(Parameter? parameter) {
            if (parameter is null) return new JObject { ["missing"] = true };
            var builtIn = (parameter.Definition as InternalDefinition)?.BuiltInParameter ?? BuiltInParameter.INVALID;
            return new JObject {
                ["id"] = parameter.Id.Value(),
                ["builtInParameter"] = builtIn.ToString(),
                ["name"] = parameter.Definition.Name,
                ["storage"] = parameter.StorageType.ToString(),
                ["spec"] = parameter.Definition.GetDataType().TypeId,
                ["readOnly"] = parameter.IsReadOnly
            };
        }

        static JObject EnumParameterFacts<T>(Parameter? parameter) where T : struct, Enum {
            var facts = ParameterFacts(parameter);
            if (parameter?.StorageType != StorageType.Integer) return facts;
            var value = parameter.AsInteger();
            facts["value"] = value;
            facts["enum"] = Enum.GetName(typeof(T), value);
            return facts;
        }
    }

    [Test]
    public void Nested_alignment_positions_a_named_child_reference_offset_from_its_origin() {
        var directory = Path.GetDirectoryName(RevitFamilyFixtureHarness.GetFamilyModelFixturePath("c-bath-shower.family.json"));
        var authored = RevitFamilyFixtureHarness.LoadFamilyModelFixture("c-bath-shower");
        Document? bath = null;
        Document? puck = null;
        try {
            bath = FamilyModelBuild.Build(this._ui.Application, authored, modelDirectory: directory).Document;
            var puckFamily = new FilteredElementCollector(bath).OfClass(typeof(FamilyInstance)).Cast<FamilyInstance>()
                .First(instance => instance.Symbol.Family.Name == "puck").Symbol.Family;
            puck = bath.EditFamily(puckFamily);
            using (var offset = new Transaction(puck, "Add offset named-reference probe")) {
                offset.Start();
                var view = new FilteredElementCollector(puck).OfClass(typeof(View)).Cast<View>()
                    .Where(candidate => !candidate.IsTemplate && candidate.ViewType is ViewType.Elevation or ViewType.Section)
                    .OrderByDescending(candidate => Math.Abs(candidate.ViewDirection.DotProduct(XYZ.BasisX))).First();
                var plane = puck.FamilyCreate.NewReferencePlane(
                    new XYZ(0.5, -8, 0), new XYZ(0.5, 8, 0), XYZ.BasisZ, view);
                plane.Name = "Offset Probe";
                Assert.That(plane.get_Parameter(BuiltInParameter.ELEM_REFERENCE_NAME)?.Set(13), Is.True,
                    "13 is Revit's native Strong Reference value, shared with MakeRefPlanes.");
                Assert.That(offset.Commit(), Is.EqualTo(TransactionStatus.Committed));
            }
            _ = puck.LoadFamily(bath, new DefaultFamilyLoadOptions());
            RevitFamilyFixtureHarness.CloseDocument(puck);
            puck = null;

            var desiredJson = JObject.Parse(FamilyModelJson.Serialize(authored));
            ((JObject)desiredJson["nested"]!)["offset-probe"] = JObject.Parse("""
                { "family": "puck", "type": "default", "host": "Ref. Level",
                  "align": [ { "instance": "Offset Probe", "to": "Center (Left/Right)" } ] }
                """);
            var desired = FamilyModelJson.Parse(desiredJson.ToString());
            Assert.That(desired.Diagnostics, Is.Empty);
            var receipt = FamilyModelBuild.Reconcile(bath, desired.Value!);
            Assert.That(receipt?.Converged, Is.True);
            var probe = new FilteredElementCollector(bath).OfClass(typeof(FamilyInstance)).Cast<FamilyInstance>()
                .Where(instance => instance.Symbol.Family.Name == "puck")
                .Single(instance => Math.Abs(((LocationPoint)instance.Location).Point.X + 0.5) < 1e-7);
            Assert.That(((LocationPoint)probe.Location).Point.X, Is.EqualTo(-0.5).Within(1e-7),
                "The child origin must move opposite its +0.5ft named-reference offset.");
            Assert.That(bath.CaptureFamilyModel().Nested.Values.SelectMany(nested => nested.Align ?? [])
                .Any(align => align.Instance == "Offset Probe" && align.To == "Center (Left/Right)"), Is.True);
        } finally {
            RevitFamilyFixtureHarness.CloseDocument(puck);
            RevitFamilyFixtureHarness.CloseDocument(bath);
        }
    }

    [TestCase("a-box")]
    [TestCase("b-grd")]
    [TestCase("c-bath-shower")]
    [TestCase("d-bath-shower-refline")]
    public void Authored_family_survives_capture_rebuild_and_reopen(string fixture) {
        var artifact = FamilyFoundryRoundtripHarness.RunFamilyModelRoundtrip(
            this._ui.Application, $"{fixture}.family.json", $"native-roundtrip-{fixture}");
        try {
            AssertNativeContent(artifact.ReopenedA, artifact.Authored);
            AssertNativeContent(artifact.ReopenedB, artifact.Authored);
            var a = artifact.ReopenedA.CaptureFamilyModel();
            var b = artifact.ReopenedB.CaptureFamilyModel();
            Assert.That(FamilyReconciler.Diff(a, b, UnitResolvers.Revit(artifact.ReopenedB)), Is.Empty,
                "Saved Revit content must survive the capture/rebuild boundary.");

            var states = FamilyFoundryRoundtripHarness.CreateExistingTypeStates(artifact.ReopenedA);
            var before = FamilyFoundryRoundtripHarness.EvaluateRoundtripStates(
                artifact.ReopenedA, states, FamilyFoundryRuntimeProbe.Collect);
            var after = FamilyFoundryRoundtripHarness.EvaluateRoundtripStates(
                artifact.ReopenedB, states, FamilyFoundryRuntimeProbe.Collect);
            Assert.That(after.Select(x => x.TypeName), Is.EqualTo(before.Select(x => x.TypeName)));
            for (var i = 0; i < before.Count; i++) AssertRuntimeSame(before[i].Result, after[i].Result);

            var receipt = FamilyModelBuild.Reconcile(artifact.ReopenedB, artifact.Authored);
            Assert.That(receipt?.Converged, Is.True, "Reapplying the original specification must converge.");
            Assert.That(receipt!.Outcomes, Is.Empty, "Reapply must not need another mutation round.");
        } finally {
            artifact.CloseDocuments();
        }
    }

    [Test]
    public void Grd_values_and_driven_opening_planes_are_correct_before_arrays() {
        var fixturePath = RevitFamilyFixtureHarness.GetFamilyModelFixturePath("b-grd.family.json");
        var json = JObject.Parse(File.ReadAllText(fixturePath));
        foreach (var section in new[] { "forms", "nested", "arrays", "connectors" }) json.Remove(section);
        var parsed = FamilyModelJson.Parse(json.ToString());
        Assert.That(parsed.Diagnostics, Is.Empty);

        Document? document = null;
        try {
            document = FamilyModelBuild.Build(this._ui.Application, parsed.Value!).Document;
            var fm = document.FamilyManager;
            var spacing = fm.get_Parameter("_vane spacing")!;
            var values = fm.Types.Cast<FamilyType>().Where(type => type.Name is "24x12" or "Slot")
                .ToDictionary(type => type.Name, type => type.AsDouble(spacing));
            var planes = new FilteredElementCollector(document).OfClass(typeof(ReferencePlane)).Cast<ReferencePlane>()
                .Where(plane => plane.Name is "opening (Front)" or "opening (Back)")
                .ToDictionary(plane => plane.Name, plane => plane.GetPlane().Origin.Y);
            var capturedPlanes = document.CaptureFamilyModel().RefPlanes;
            Assert.Multiple(() => {
                Assert.That(values["24x12"], Is.EqualTo(2.0 / 12.0).Within(1e-9));
                Assert.That(values["Slot"], Is.Zero.Within(1e-9));
                Assert.That(planes["opening (Front)"], Is.EqualTo(-0.5).Within(1e-9));
                Assert.That(planes["opening (Back)"], Is.EqualTo(0.5).Within(1e-9));
                Assert.That(capturedPlanes["opening (Front)"].IsReference, Is.EqualTo(RefStrength.NotAReference));
                Assert.That(capturedPlanes["opening (Back)"].IsReference, Is.EqualTo(RefStrength.NotAReference));
            });
        } finally { RevitFamilyFixtureHarness.CloseDocument(document); }
    }

    [Test]
    public void Grd_arrays_own_independent_nested_seeds_under_count_and_spacing_perturbation() {
        var fixturePath = RevitFamilyFixtureHarness.GetFamilyModelFixturePath("b-grd.family.json");
        var json = JObject.Parse(File.ReadAllText(fixturePath));
        var parameters = (JObject)json["parameters"]!;
        parameters["_back count"] = JObject.Parse("""{"dataType":"Integer","value":3}""");
        parameters["_front count"] = JObject.Parse("""{"dataType":"Integer","value":4}""");
        var arrays = (JObject)json["arrays"]!;
        arrays["vanes-back"]!["label"] = "param:_back count";
        arrays["vanes-back"]!["moveTo"] = "Second";
        arrays["vanes-back"]!["spacing"] = "3in";
        ((JObject)arrays["vanes-back"]!).Remove("spacingPlane");
        arrays["vanes-front"]!["label"] = "param:_front count";
        arrays["vanes-front"]!["moveTo"] = "Second";
        arrays["vanes-front"]!["spacing"] = "5in";
        ((JObject)arrays["vanes-front"]!).Remove("spacingPlane");
        var parsed = FamilyModelJson.Parse(json.ToString());
        Assert.That(parsed.Diagnostics, Is.Empty);

        Document? document = null;
        try {
            document = FamilyModelBuild.Build(this._ui.Application, parsed.Value!, modelDirectory: Path.GetDirectoryName(fixturePath)).Document;
            var actual = new FilteredElementCollector(document).OfClass(typeof(LinearArray)).Cast<LinearArray>()
                .ToDictionary(a => a.Label.Definition.Name, StringComparer.Ordinal);
            Assert.Multiple(() => {
                Assert.That(actual["_back count"].NumMembers, Is.EqualTo(3));
                Assert.That(actual["_front count"].NumMembers, Is.EqualTo(4));
                Assert.That(SpanY(document, actual["_back count"]), Is.EqualTo(0.5).Within(1e-7));
                Assert.That(SpanY(document, actual["_front count"]), Is.EqualTo(1.25).Within(1e-7));
            });
            var originals = actual.Values.Select(a => a.GetOriginalMemberIds().Single()).ToArray();
            Assert.That(originals.Distinct(), Has.Count.EqualTo(2), "Each array must own a separately placed seed.");
            var captured = document.CaptureFamilyModel();
            Assert.That(captured.Arrays.Values.Select(array => array.Member).Distinct(), Has.Count.EqualTo(1),
                "Identical array seeds must capture as one reusable definition without merging native instances.");
            Assert.That(actual.Values.SelectMany(a => Instances(document, a))
                .All(i => document.FamilyManager.GetAssociatedFamilyParameter(i.LookupParameter("_vane length")) is not null &&
                          document.FamilyManager.GetAssociatedFamilyParameter(i.LookupParameter("_vane thickness")) is not null), Is.True,
                "Seed placement associations must survive array creation.");
        } finally { RevitFamilyFixtureHarness.CloseDocument(document); }

        static double SpanY(Document doc, LinearArray array) {
            var ys = Instances(doc, array).Select(i => ((LocationPoint)i.Location).Point.Y).ToArray();
            return ys.Max() - ys.Min();
        }

        static IEnumerable<FamilyInstance> Instances(Document doc, LinearArray array) =>
            array.GetOriginalMemberIds().Concat(array.GetCopiedMemberIds()).SelectMany(id => doc.GetElement(id) switch {
                Group group => group.GetMemberIds().Select(doc.GetElement).OfType<FamilyInstance>(),
                FamilyInstance instance => [instance],
                _ => []
            });
    }

    private static void AssertNativeContent(Document document, FamilyModel desired) {
        var fm = document.FamilyManager;
        Assert.That(fm.Types.Cast<FamilyType>().Select(t => t.Name), Is.SupersetOf(desired.Types.Keys));
        foreach (var (name, spec) in desired.Parameters) {
            var parameter = fm.get_Parameter(name);
            Assert.That(parameter, Is.Not.Null, name);
            if (spec.Formula is not null) Assert.That(parameter!.Formula, Is.EqualTo(spec.Formula), name);
            if (spec.IsInstance is { } instance) Assert.That(parameter!.IsInstance, Is.EqualTo(instance), name);
            if (spec.Shared is { } shared) Assert.That(parameter!.IsShared, Is.EqualTo(shared), name);
            foreach (var (typeName, row) in desired.Types) {
                var literal = row.TryGetValue(name, out var cell) ? cell.Text : spec.Value?.Text;
                if (literal is null || spec.Formula is not null) continue;
                var type = fm.Types.Cast<FamilyType>().Single(t => t.Name == typeName);
                if (parameter!.StorageType == StorageType.String)
                    Assert.That(type.AsString(parameter), Is.EqualTo(literal), $"{typeName}/{name}");
                else if (PortableScalar.TryParse(literal, out var scalar))
                    Assert.That(type.AsDouble(parameter), Is.EqualTo(scalar.Kind == PortableScalarKind.Length ? scalar.Feet : scalar.Value * Math.PI / 180).Within(1e-9), $"{typeName}/{name}");
            }
        }
        Assert.That(new FilteredElementCollector(document).OfClass(typeof(ConnectorElement)).GetElementCount(),
            Is.EqualTo(desired.Connectors.Count), "Connectors must actually exist in the saved RFA.");
        if (desired.RoomCalculationPoint is { } point)
            Assert.That(document.OwnerFamily.ShowSpatialElementCalculationPoint, Is.EqualTo(point.Enabled));
        Assert.That(new FilteredElementCollector(document).OfClass(typeof(Extrusion)).GetElementCount(),
            Is.GreaterThanOrEqualTo(desired.Forms.Count), "Authored forms must actually exist.");
        foreach (var element in new FilteredElementCollector(document).WhereElementIsNotElementType())
            Assert.That(element.GetEntitySchemaGuids(), Is.Empty, $"Unexpected stored metadata on {element.Id}.");
    }

    private static void AssertRuntimeSame(RuntimeStateProbe a, RuntimeStateProbe b) {
        Assert.That(b.ParameterValues.Keys, Is.EquivalentTo(a.ParameterValues.Keys), a.TypeName);
        foreach (var (key, value) in a.ParameterValues)
            Assert.That(b.ParameterValues[key], Is.EqualTo(value).Within(1e-7), $"{a.TypeName}/{key}");
        Assert.That(b.Planes.Keys, Is.EquivalentTo(a.Planes.Keys), a.TypeName);
        foreach (var (key, plane) in a.Planes) {
            Assert.That(Math.Abs(b.Planes[key].Normal.DotProduct(plane.Normal)), Is.EqualTo(1).Within(1e-7), key);
            Assert.That(Math.Abs((b.Planes[key].Midpoint - plane.Midpoint).DotProduct(plane.Normal)),
                Is.LessThan(1e-7), key);
        }
        Assert.That(b.DimensionCount, Is.EqualTo(a.DimensionCount), a.TypeName);
        Assert.That(b.ExtrusionCount, Is.EqualTo(a.ExtrusionCount), a.TypeName);
        foreach (var prism in a.Prisms) {
            var match = b.Prisms.SingleOrDefault(p => p.SketchPlaneName == prism.SketchPlaneName
                && p.IsSolid == prism.IsSolid && p.Min.DistanceTo(prism.Min) < 1e-7 && p.Max.DistanceTo(prism.Max) < 1e-7);
            Assert.That(match, Is.Not.Null, $"Missing extrusion bounds in {a.TypeName} on {prism.SketchPlaneName}");
            Assert.That(match!.StartOffset, Is.EqualTo(prism.StartOffset).Within(1e-7));
            Assert.That(match.EndOffset, Is.EqualTo(prism.EndOffset).Within(1e-7));
        }
        foreach (var cylinder in a.Cylinders) {
            var match = b.Cylinders.SingleOrDefault(c => c.SketchPlaneName == cylinder.SketchPlaneName
                && c.IsSolid == cylinder.IsSolid && c.Min.DistanceTo(cylinder.Min) < 1e-7 && c.Max.DistanceTo(cylinder.Max) < 1e-7);
            Assert.That(match, Is.Not.Null, $"Missing cylinder bounds in {a.TypeName} on {cylinder.SketchPlaneName}");
            Assert.That(match!.Diameter, Is.EqualTo(cylinder.Diameter).Within(1e-7));
            Assert.That(match.StartOffset, Is.EqualTo(cylinder.StartOffset).Within(1e-7));
            Assert.That(match.EndOffset, Is.EqualTo(cylinder.EndOffset).Within(1e-7));
        }
        Assert.That(b.ConnectorCount, Is.EqualTo(a.ConnectorCount), a.TypeName);
        var remaining = b.Connectors.ToList();
        foreach (var connector in a.Connectors) {
            var match = remaining.SingleOrDefault(c => c.Domain == connector.Domain
                && c.Origin.DistanceTo(connector.Origin) < 1e-7);
            Assert.That(match, Is.Not.Null, $"Missing connector at {connector.Origin} in {a.TypeName}");
            Assert.Multiple(() => {
                Assert.That(match!.Profile, Is.EqualTo(connector.Profile));
                Assert.That(match.SystemClassification, Is.EqualTo(connector.SystemClassification));
                Assert.That(match.FlowDirection, Is.EqualTo(connector.FlowDirection));
                Assert.That(match.FaceNormal.DistanceTo(connector.FaceNormal), Is.LessThan(1e-7));
                Assert.That(match.Diameter, Is.EqualTo(connector.Diameter).Within(1e-7));
                Assert.That(match.Width, Is.EqualTo(connector.Width).Within(1e-7));
                Assert.That(match.Length, Is.EqualTo(connector.Length).Within(1e-7));
            });
            remaining.Remove(match!);
        }
        Assert.Multiple(() => {
            Assert.That(b.Settings.AlwaysVertical, Is.EqualTo(a.Settings.AlwaysVertical));
            Assert.That(b.Settings.Shared, Is.EqualTo(a.Settings.Shared));
            Assert.That(b.Settings.CutWithVoidsWhenLoaded, Is.EqualTo(a.Settings.CutWithVoidsWhenLoaded));
            Assert.That(b.Settings.PartType, Is.EqualTo(a.Settings.PartType));
            Assert.That(b.Settings.RoomCalculationPointEnabled, Is.EqualTo(a.Settings.RoomCalculationPointEnabled));
            Assert.That(b.Settings.LookupTableNames, Is.EqualTo(a.Settings.LookupTableNames));
        });
    }
}
