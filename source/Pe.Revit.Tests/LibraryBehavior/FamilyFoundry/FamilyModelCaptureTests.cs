using Autodesk.Revit.ApplicationServices;
using Autodesk.Revit.DB.Mechanical;
using Autodesk.Revit.DB.Structure;
using Newtonsoft.Json.Linq;
using Pe.Revit.Extensions.FamDocument;
using Pe.Revit.FamilyFoundry.Apply;
using Pe.Revit.FamilyFoundry.Capture;
using Pe.Shared.RevitData.Families;

namespace Pe.Revit.Tests;

/// <summary>
///     Fresh-lane proof of the native capture against the two real families kaitpw named (BASE.md verdict 5).
///     Every asserted fact was first proven live by c-revit (§2, §3) and r2-revit (claims 3, 4, 5); this test
///     makes the reader reproduce them. The fixtures are byte copies of the G: originals (2026-09-06).
/// </summary>
[TestFixture]
public sealed class FamilyModelCaptureTests {
    private Application _application = null!;

    [OneTimeSetUp]
    public void SetUp(UIApplication uiApplication) =>
        this._application = uiApplication?.Application
                            ?? throw new InvalidOperationException("ricaun.RevitTest did not provide a UIApplication.");

    private FamilyModel Capture(string fixture) {
        var document = RevitFamilyFixtureHarness.OpenFamilyFixture(this._application, fixture);
        try {
            var model = document.CaptureFamilyModel();
            var captured = Path.Combine(TestContext.CurrentContext.WorkDirectory, "captured");
            Directory.CreateDirectory(captured);
            File.WriteAllText(Path.Combine(captured, Path.GetFileNameWithoutExtension(fixture) + ".family.json"), FamilyModelJson.Serialize(model));
            return model;
        } finally {
            document.Close(false);
        }
    }

    [Test]
    public void Bath_Shower_three_pucks_with_their_associations_alignments_and_visibility() {
        var model = this.Capture("PE Bath-Shower.rfa");

        Assert.Multiple(() => {
            Assert.That(model.Family.Placement, Is.EqualTo(FamilyModelPlacement.OneLevelBased));
            Assert.That(model.Coverage["nested"], Is.EqualTo(CoverageState.Read));
            Assert.That(model.Coverage["details"], Is.EqualTo(CoverageState.NotRead));

            // c-revit §2: three puck:default instances, host Ref. Level, rotation is a parameter binding.
            var pucks = model.Nested.Values.Where(n => n.Family == "puck" && n.Type == "default").ToList();
            Assert.That(pucks, Has.Count.EqualTo(3));
            Assert.That(pucks.Select(p => p.Host), Is.All.EqualTo("Ref. Level"));
            Assert.That(pucks.Count(p => p.Associate?["_angle"] == "param:_conn angle"), Is.EqualTo(2));
            Assert.That(pucks.Count(p => p.Associate?["_angle"] == "param:_drain angle"), Is.EqualTo(1));
            Assert.That(pucks.Count(p => p.Associate?["_diameter"] == "param:_conn size"), Is.EqualTo(2));
            Assert.That(pucks.Count(p => p.Associate?["_diameter"] == "param:_drain size"), Is.EqualTo(1));
            Assert.That(pucks.Count(p => p.Associate?["Elevation from Level"] == "param:_conn z offset"), Is.EqualTo(2));
            Assert.That(pucks.Count(p => p.Associate?["Elevation from Level"] == "param:_drain z offset"), Is.EqualTo(1));
            Assert.That(pucks.Select(p => p.Visible), Is.EquivalentTo(new[] { null, "param:_hot conn visible", "param:_drain visible" }));

            // c-revit §2 constraints + r2-revit claim 3: alignments resolve to Center (Left/Right) / Center (Front/Back) by name.
            var aligns = pucks.SelectMany(p => p.Align ?? []).Select(a => (a.Instance, a.To)).ToList();
            Assert.That(aligns, Is.EquivalentTo(new[] {
                ("Center (Left/Right)", "conn (left)"), ("Center (Left/Right)", "conn (right)"),
                ("Center (Left/Right)", "drain x"), ("Center (Front/Back)", "drain y")
            }));

            // Datums vs author planes (critic F2).
            Assert.That(model.Datums.Keys, Is.SupersetOf(new[] { "Ref. Level", "Center (Left/Right)", "Center (Front/Back)", "Reference Plane" }));
            Assert.That(model.RefPlanes.Keys, Is.EquivalentTo(new[] { "conn (right)", "conn (left)", "drain y", "drain x", "arbitrary plane for positioning" }));
            Assert.That(model.RefPlanes["drain y"].IsReference, Is.EqualTo(RefStrength.StrongReference));

            // Dimensions: labeled, the EQ chain, one locked.
            Assert.That(model.Dimensions.Values.Select(d => d.Label).Where(l => l != null),
                Is.EquivalentTo(new[] { "_drain x offset", "_conn x offset between", "_drain y offset" }));
            Assert.That(model.Dimensions.Values.Single(d => d.Equality == true).Between,
                Is.EqualTo(new[] { "conn (left)", "Center (Left/Right)", "conn (right)" }));
            Assert.That(model.Dimensions.Values.Count(d => d.Locked != null), Is.EqualTo(1));

            // The three pipe connectors ride puck faces: kaitpw 2026-09-06 ruling.
            Assert.That(model.Connectors, Is.Empty);
            Assert.That(model.Unmodeled.Count(u => u.Reason == UnmodeledReason.ConnectorOnNestedFace), Is.EqualTo(3));
            Assert.That(model.Parameters["_drain angle"].Formula, Is.EqualTo("90°"));
            Assert.That(model.Parameters["PE_P_LoadCalc_DFU"].Shared, Is.True);
        });
    }

    [Test]
    public void Native_connector_host_probe_compares_plane_with_coincident_nested_face() {
        var host = RevitFamilyFixtureHarness.LoadFamilyModelFixture("b-grd");
        var dependency = RevitFamilyFixtureHarness.LoadFamilyModelFixture("vane");
        var modelDirectory = Path.GetDirectoryName(RevitFamilyFixtureHarness.GetFamilyModelFixturePath("b-grd.family.json"));
        var output = RevitFamilyFixtureHarness.CreateTemporaryOutputDirectory(nameof(Native_connector_host_probe_compares_plane_with_coincident_nested_face));
        Document? document = null;
        try {
            document = FamilyTemplate.NewDocument(this._application, host.Family);
            Document? dependencyDocument = null;
            try {
                dependencyDocument = FamilyModelBuild.Build(this._application, dependency, modelDirectory: modelDirectory).Document;
                _ = dependencyDocument.LoadFamily(document, new DefaultFamilyLoadOptions());
            } finally { RevitFamilyFixtureHarness.CloseDocument(dependencyDocument); }

            using var transaction = new Transaction(document, "Probe connector host identity");
            transaction.Start();
            var symbol = new FilteredElementCollector(document).OfClass(typeof(FamilySymbol)).Cast<FamilySymbol>()
                .Single(candidate => candidate.Family.Name == "vane" && candidate.Name == "type one");
            if (!symbol.IsActive) symbol.Activate();
            var level = new FilteredElementCollector(document).OfClass(typeof(Level)).Cast<Level>()
                .Single(candidate => candidate.Name == "Ref. Level");
            var vane = document.FamilyCreate.NewFamilyInstance(XYZ.Zero, symbol, level, StructuralType.NonStructural);
            document.Regenerate();
            var options = new Options { ComputeReferences = true, DetailLevel = ViewDetailLevel.Fine };
            var face = vane.get_Geometry(options).OfType<GeometryInstance>()
                .SelectMany(instance => instance.GetSymbolGeometry().OfType<Solid>())
                .SelectMany(solid => solid.Faces.OfType<PlanarFace>())
                .Where(candidate => candidate.Reference is not null)
                .OrderByDescending(candidate => Math.Abs(candidate.FaceNormal.DotProduct(XYZ.BasisZ)))
                .First();
            var normal = face.FaceNormal.Normalize();
            var direction = (Math.Abs(normal.Z) > 0.9 ? XYZ.BasisX : XYZ.BasisZ).CrossProduct(normal).Normalize();
            var cut = normal.CrossProduct(direction).Normalize();
            var viewNormal = Math.Abs(normal.Z) > 0.95 ? XYZ.BasisX : XYZ.BasisZ;
            var view = new FilteredElementCollector(document).OfClass(typeof(View)).Cast<View>()
                .Where(candidate => !candidate.IsTemplate && candidate.ViewType is ViewType.Elevation or ViewType.Section)
                .OrderByDescending(candidate => Math.Abs(candidate.ViewDirection.DotProduct(viewNormal))).First();
            var plane = document.FamilyCreate.NewReferencePlane(face.Origin + direction * 8, face.Origin - direction * 8, cut, view);
            plane.Name = "connector-control-plane";
            document.Regenerate();
            Assert.That(Math.Abs((face.Origin - plane.GetPlane().Origin).DotProduct(plane.GetPlane().Normal)),
                Is.LessThan(1e-7), "Control requires the nested face and reference plane to be coincident.");

            var planeConnector = ConnectorElement.CreateDuctConnector(document, DuctSystemType.ExhaustAir,
                ConnectorProfileType.Rectangular, plane.GetReference());
            var faceConnector = ConnectorElement.CreateDuctConnector(document, DuctSystemType.SupplyAir,
                ConnectorProfileType.Rectangular, face.Reference);
            document.Regenerate();
            ElementTransformUtils.MoveElement(document, planeConnector.Id, faceConnector.Origin - planeConnector.Origin);
            document.Regenerate();
            Assert.That(planeConnector.Origin.DistanceTo(faceConnector.Origin), Is.LessThan(1e-7));

            static JObject DescribeParameter(Parameter parameter) {
                var builtIn = (parameter.Definition as InternalDefinition)?.BuiltInParameter;
                return new JObject {
                    ["name"] = parameter.Definition.Name,
                    ["builtIn"] = builtIn?.ToString(),
                    ["storage"] = parameter.StorageType.ToString(),
                    ["elementId"] = parameter.StorageType == StorageType.ElementId ? parameter.AsElementId().Value() : null,
                    ["text"] = parameter.StorageType == StorageType.String ? parameter.AsString() : parameter.AsValueString()
                };
            }
            static JArray Ids(IEnumerable<ElementId> ids) => new(ids.Select(id => id.Value()));
            static JObject DescribeConnector(ConnectorElement connector) => new() {
                ["id"] = connector.Id.Value(),
                ["origin"] = connector.Origin.ToString(),
                ["parameters"] = new JArray(connector.Parameters.Cast<Parameter>().Select(DescribeParameter)),
                ["dependents"] = Ids(connector.GetDependentElements(null))
            };
            var evidence = new JObject {
                ["plane"] = new JObject {
                    ["id"] = plane.Id.Value(),
                    ["referenceElementId"] = plane.GetReference().ElementId.Value(),
                    ["dependents"] = Ids(plane.GetDependentElements(null))
                },
                ["nested"] = new JObject {
                    ["id"] = vane.Id.Value(),
                    ["faceReferenceElementId"] = face.Reference.ElementId.Value(),
                    ["dependents"] = Ids(vane.GetDependentElements(null))
                },
                ["planeHosted"] = DescribeConnector(planeConnector),
                ["nestedFaceHosted"] = DescribeConnector(faceConnector)
            };
            File.WriteAllText(Path.Combine(output, "connector-host-identity.json"), evidence.ToString());
            transaction.RollBack();
        } finally { RevitFamilyFixtureHarness.CloseDocument(document); }
    }

    [Test]
    public void GRD_Exhaust_two_arrays_one_nested_vane_and_twelve_locked_sketch_lines() {
        var model = this.Capture("PE GRD Exhaust.rfa");

        Assert.Multiple(() => {
            // r2-revit claim 5 + c-revit §3: two LinearArrays labeled _calc vane half count, member is the vane.
            Assert.That(model.Arrays, Has.Count.EqualTo(2));
            Assert.That(model.Arrays.Values.Select(a => a.Label), Is.All.EqualTo("param:_calc vane half count"));
            Assert.That(model.Arrays.Values.Select(a => a.Member), Is.All.EqualTo("vane"));
            Assert.That(model.Arrays.Values.Select(a => a.Direction), Is.EquivalentTo(new[] { Axis.PlusY, Axis.MinusY }));
            Assert.That(model.Arrays.Values.Select(a => a.SpacingPlane), Is.EquivalentTo(new[] { "opening (Back)", "opening (Front)" }));
            Assert.That(model.Arrays.Values.Select(a => a.MoveTo), Is.All.EqualTo(ArrayAnchor.Last));

            // Type-level bindings on the vane symbol (c-revit §3).
            var vane = model.Nested["vane"];
            Assert.That(vane.Type, Is.EqualTo("type one"));
            Assert.That(vane.Associate, Is.EqualTo(new Dictionary<string, string> {
                ["_vane length"] = "param:PE_M_Grd_OpenLength", ["_vane thickness"] = "param:_flange thickness"
            }));
            Assert.That(vane.Align?.Select(a => (a.Instance, a.To)), Is.EquivalentTo(new[] {
                ("Center (Left/Right)", "Center (Left/Right)"), ("Center (Front/Back)", "Center (Front/Back)")
            }));
            Assert.That(model.Nested, Has.Count.EqualTo(1), "array copies are not nested entries");

            // r2-revit claim 4: three extrusions, twelve lines, every line locked to a named plane.
            Assert.That(model.Forms, Has.Count.EqualTo(3));
            var lines = model.Forms.Values.SelectMany(f => f.Profile!).SelectMany(l => l.Curves).ToList();
            Assert.That(lines, Has.Count.EqualTo(12));
            Assert.That(lines.Select(l => l.On), Is.All.Not.Null);
            Assert.That(model.Forms.Keys, Is.EquivalentTo(new[] { "neck", "device", "opening" }));
            Assert.That(model.Forms["opening"].Void, Is.True);
            Assert.That(model.Forms["neck"].Start, Is.EqualTo("param:_flange opening thickness"));
            Assert.That(model.Forms["neck"].End, Is.EqualTo("param:_neck depth"));
            Assert.That(model.Forms["device"].End, Is.EqualTo("param:_flange thickness"));
            Assert.That(model.Forms.Values.Select(f => f.SketchPlane), Is.All.EqualTo("Ref. Level"));
            Assert.That(model.Unmodeled.Count(u => u.Reason == UnmodeledReason.SketchLineUnlocked), Is.Zero);
            Assert.That(model.Unmodeled.Any(u => u.Reason == UnmodeledReason.ThirdPartyStorage), "CQTP TagSettings DataStorage");

            // The exhaust connector sits on the device's top face at z = _flange thickness; no named plane is coplanar.
            Assert.That(model.Connectors, Is.Empty);
            Assert.That(model.Unmodeled.Count(u => u.Reason == UnmodeledReason.ConnectorFaceNotOnPlane), Is.EqualTo(1));
        });
    }
}
