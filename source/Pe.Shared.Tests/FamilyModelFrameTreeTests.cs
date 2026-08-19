using Newtonsoft.Json.Linq;
using Pe.Shared.RevitData.Families;

namespace Pe.Shared.Tests;

/// <summary>
///     The frame tree, the `rotation` clause and the `ExtrudedPolygon` kind, proved without Revit: what
///     the schema accepts, what it refuses, and the arithmetic every consumer must agree on.
/// </summary>
/// <remarks>
///     The arithmetic vectors are read from the shared conformance fixture, the same file the TypeScript
///     preview reads. One file, three readers: C# contract tests here, the Revit-backed intent oracle,
///     and the web preview. A convention that changes has to change in all of them at once.
/// </remarks>
[TestFixture]
public sealed class FamilyModelFrameTreeTests {
    private const double Tolerance = 1e-9;

    private const string PolygonJson = """
        {
          "family": {
            "name": "FF Polygon Plate",
            "category": "Generic Models",
            "template": "Generic Model",
            "placement": "Unhosted"
          },
          "familyParameters": {
            "Reach": { "dataType": "Length (Common)", "value": "9in" },
            "Rise": { "dataType": "Length (Common)", "value": "2in" }
          },
          "types": { "Default": {} },
          "planes": {
            "service": { "from": "plane:family.Bottom", "by": "18in", "direction": "Out" }
          },
          "solids": {
            "plate": {
              "kind": "ExtrudedPolygon",
              "frame": "frame:family",
              "height": "param:Rise",
              "profile": [
                { "x": "0in", "y": "0in" },
                { "x": "param:Reach", "y": "0in" },
                { "x": "0in", "y": "6in" }
              ]
            }
          }
        }
        """;

    private const string FrameTreeJson = """
        {
          "family": {
            "name": "FF Frame Tree",
            "category": "Generic Models",
            "template": "Generic Model",
            "placement": "Unhosted"
          },
          "familyParameters": {
            "Width": { "dataType": "Length (Common)", "value": "12in" },
            "Vane Angle": { "dataType": "Angle", "value": "30deg" }
          },
          "types": { "Default": {} },
          "planes": {
            "service": { "from": "plane:family.Bottom", "by": "18in", "direction": "Out" }
          },
          "frames": {
            "deck": {
              "origin": ["face:body.Top", "plane:family.CenterLR", "plane:family.CenterFB"],
              "normal": "+Z",
              "up": "+Y",
              "rotation": { "about": "normal", "by": "param:Vane Angle" }
            }
          },
          "solids": {
            "body": {
              "kind": "Prism",
              "frame": "frame:family",
              "width": "param:Width",
              "depth": "param:Width",
              "height": "param:Width"
            },
            "vane": {
              "kind": "Prism",
              "frame": "frame:deck",
              "width": "param:Width",
              "depth": "1in",
              "height": "2in"
            }
          }
        }
        """;

    [Test]
    public void A_solid_may_sit_on_a_declared_frame_that_stands_on_another_solid() {
        var result = FamilyModelJson.Parse(FrameTreeJson);

        Assert.That(result.Diagnostics, Is.Empty,
            string.Join(Environment.NewLine, result.Diagnostics.Select(item => item.Message)));
        Assert.That(result.Value!.Solids["vane"].Frame, Is.EqualTo("frame:deck"));
        Assert.That(result.Value.Frames["deck"].Rotation!.About, Is.EqualTo("normal"));
        Assert.That(result.Value.Frames["deck"].Rotation!.By, Is.EqualTo("param:Vane Angle"));
    }

    [Test]
    public void A_frame_that_stands_on_a_solid_in_that_frame_is_a_named_cycle() {
        var result = FamilyModelJson.Parse(
            FrameTreeJson.Replace("\"origin\": [\"face:body.Top\"", "\"origin\": [\"face:vane.Top\""));

        var cycle = result.Diagnostics
            .FirstOrDefault(item => item.Code == FamilyModelDiagnosticCodes.ReferenceCycle);
        Assert.That(cycle, Is.Not.Null, "a frame standing on a solid it carries has no geometry");
        Assert.That(cycle!.Message, Does.Contain("frame:deck"));
        Assert.That(cycle.Message, Does.Contain("solid:vane"));
    }

    [Test]
    public void A_plane_that_derives_from_itself_is_a_named_cycle() {
        var result = FamilyModelJson.Parse(FrameTreeJson.Replace(
            "\"service\": { \"from\": \"plane:family.Bottom\"",
            "\"service\": { \"from\": \"plane:service\""));

        Assert.That(result.Diagnostics.Select(item => item.Code),
            Does.Contain(FamilyModelDiagnosticCodes.ReferenceCycle));
    }

    [TestCase("\"about\": \"normal\"", "\"about\": \"sideways\"", FamilyModelDiagnosticCodes.InvalidFrame)]
    [TestCase("\"by\": \"param:Vane Angle\"", "\"by\": \"12in\"", FamilyModelDiagnosticCodes.InvalidDriver)]
    [TestCase("\"by\": \"param:Vane Angle\"", "\"by\": \"param:Missing\"", FamilyModelDiagnosticCodes.InvalidDriver)]
    public void Rotation_refuses_an_axis_or_a_driver_it_cannot_execute(
        string authored,
        string replacement,
        string expectedCode
    ) {
        var result = FamilyModelJson.Parse(FrameTreeJson.Replace(authored, replacement));

        Assert.That(result.Diagnostics.Select(item => item.Code), Does.Contain(expectedCode));
    }

    [TestCase("45deg", 45.0)]
    [TestCase("-90deg", -90.0)]
    public void A_rotation_literal_is_degrees_and_a_parameter_is_Revit_radians(string authored, double expected) {
        var parameters = new Dictionary<string, double>(StringComparer.Ordinal) { ["Vane Angle"] = Math.PI / 4 };

        Assert.That(FamilyModelEvaluatorConventions.ResolveAngleDegrees(authored, parameters),
            Is.EqualTo(expected).Within(Tolerance));
        Assert.That(FamilyModelEvaluatorConventions.ResolveAngleDegrees("param:Vane Angle", parameters),
            Is.EqualTo(45.0).Within(1e-6));
    }

    [Test]
    public void An_unknown_rotation_field_fails_at_the_authored_boundary() {
        var result = FamilyModelJson.Parse(FrameTreeJson.Replace(
            "\"about\": \"normal\"", "\"about\": \"normal\", \"clockwise\": true"));

        Assert.That(result.Value, Is.Null);
        Assert.That(result.Diagnostics.Select(item => item.Code),
            Does.Contain(FamilyModelDiagnosticCodes.InvalidJson));
    }

    [Test]
    public void A_solid_frame_must_be_the_family_frame_or_a_declared_one() {
        var result = FamilyModelJson.Parse(FrameTreeJson.Replace("\"frame:deck\"", "\"frame:nowhere\""));

        Assert.That(result.Diagnostics.Select(item => item.Code),
            Does.Contain(FamilyModelDiagnosticCodes.UnsupportedFrame));
    }

    [Test]
    public void Family_plane_directions_match_the_shared_conformance_vectors() {
        var vectors = ReadConformanceVectors();

        foreach (var member in ((JObject)vectors["familyPlanes"]!).Properties()) {
            var expected = (JObject)member.Value;
            var actual = FamilyModelEvaluatorConventions.ResolveFamilyPlane(member.Name);
            Assert.That(actual.Axis.ToString(), Is.EqualTo(expected.Value<string>("axis")), member.Name);
            AssertVector(actual.Outward, expected["outward"]!, member.Name);
        }
    }

    [Test]
    public void Frame_origins_and_rotations_match_the_shared_conformance_vectors() {
        var vectors = ReadConformanceVectors();

        var origin = (JObject)vectors["frameOrigin"]!;
        var planes = origin["planes"]!
            .Select(plane => new FamilyModelPlaneGeometry(ReadVector(plane["point"]!), ReadVector(plane["normal"]!)))
            .ToList();
        AssertVector(
            FamilyModelEvaluatorConventions.IntersectPlanes(planes[0], planes[1], planes[2]),
            origin["point"]!,
            "frame origin");

        foreach (var vector in vectors["frameTransforms"]!.Children<JObject>()) {
            var name = vector.Value<string>("case")!;
            var transform = FamilyModelEvaluatorConventions.ResolveFrameBasis(
                ReadVector(vector["origin"]!),
                vector.Value<string>("normal")!,
                vector.Value<string>("up")!);
            if (vector["rotation"] is JObject rotation) {
                var parameters = ((JObject?)vector["parametersInRadians"])?
                    .Properties()
                    .ToDictionary(property => property.Name, property => property.Value.Value<double>(),
                        StringComparer.Ordinal) ?? new Dictionary<string, double>(StringComparer.Ordinal);
                transform = FamilyModelEvaluatorConventions.Rotate(
                    transform,
                    FamilyModelEvaluatorConventions.ResolveRotationAxis(rotation.Value<string>("about")!, transform),
                    FamilyModelEvaluatorConventions.ResolveAngleDegrees(rotation.Value<string>("by")!, parameters));
            }

            AssertVector(transform.Apply(ReadVector(vector["local"]!)), vector["world"]!, name);
        }
    }

    [Test]
    public void Extruded_polygon_bounds_match_the_shared_conformance_vectors() {
        var vectors = ReadConformanceVectors();

        foreach (var vector in vectors["polygons"]!.Children<JObject>()) {
            var name = vector.Value<string>("case")!;
            var parameters = ((JObject)vector["parametersInFeet"]!)
                .Properties()
                .ToDictionary(property => property.Name, property => property.Value.Value<double>(),
                    StringComparer.Ordinal);
            var profile = vector["profile"]!
                .Children<JObject>()
                .Select(point => new FamilyModelProfilePointValue(
                    FamilyModelEvaluatorConventions.ResolveLengthFeet(point.Value<string>("x"), parameters),
                    FamilyModelEvaluatorConventions.ResolveLengthFeet(point.Value<string>("y"), parameters)))
                .ToList();
            var bounds = FamilyModelEvaluatorConventions.ResolvePolygonBounds(
                profile,
                FamilyModelEvaluatorConventions.ResolveLengthFeet(vector.Value<string>("height"), parameters));

            var expected = (JObject)vector["bounds"]!;
            AssertBounds(bounds.X, expected["x"]!, $"{name}.x");
            AssertBounds(bounds.Y, expected["y"]!, $"{name}.y");
            AssertBounds(bounds.Z, expected["z"]!, $"{name}.z");
        }
    }

    [Test]
    public void An_extruded_polygon_needs_a_ring_that_does_not_repeat_its_first_point() {
        var shortRing = FamilyModelJson.Parse(PolygonJson.Replace(
            "{ \"x\": \"param:Reach\", \"y\": \"0in\" },", string.Empty));
        var repeated = FamilyModelJson.Parse(PolygonJson.Replace(
            "{ \"x\": \"0in\", \"y\": \"6in\" }",
            "{ \"x\": \"0in\", \"y\": \"6in\" }, { \"x\": \"0in\", \"y\": \"0in\" }"));

        Assert.That(shortRing.Diagnostics.Select(item => item.Code),
            Does.Contain(FamilyModelDiagnosticCodes.InvalidSolid));
        Assert.That(repeated.Diagnostics.Select(item => item.Message),
            Has.Some.Contains("must not repeat the first"));
    }

    [Test]
    public void An_extruded_polygon_drives_its_points_and_refuses_prism_and_cylinder_drivers() {
        var valid = FamilyModelJson.Parse(PolygonJson);
        var withWidth = FamilyModelJson.Parse(PolygonJson.Replace(
            "\"height\": \"param:Rise\"", "\"height\": \"param:Rise\", \"width\": \"12in\""));
        var withoutHeight = FamilyModelJson.Parse(PolygonJson.Replace("\"height\": \"param:Rise\",", string.Empty));

        Assert.That(valid.Diagnostics, Is.Empty,
            string.Join(Environment.NewLine, valid.Diagnostics.Select(item => item.Message)));
        Assert.That(valid.Value!.Solids["plate"].Profile[1].X, Is.EqualTo("param:Reach"));
        Assert.That(withWidth.Diagnostics.Select(item => item.Message),
            Has.Some.Contains("cannot define width"));
        Assert.That(withoutHeight.Diagnostics.Select(item => item.Message),
            Has.Some.Contains("requires height"));
    }

    [Test]
    public void A_polygon_edge_is_named_but_is_not_a_reference_target() {
        var top = FamilyModelJson.Parse(PolygonJson.Replace("\"from\": \"plane:family.Bottom\"",
            "\"from\": \"face:plate.Top\""));
        var edge = FamilyModelJson.Parse(PolygonJson.Replace("\"from\": \"plane:family.Bottom\"",
            "\"from\": \"face:plate.Edge1\""));

        Assert.That(top.Diagnostics, Is.Empty,
            string.Join(Environment.NewLine, top.Diagnostics.Select(item => item.Message)));
        Assert.That(edge.Diagnostics.Select(item => item.Code),
            Does.Contain(FamilyModelDiagnosticCodes.InvalidReference));
    }

    private static void AssertBounds(FamilyModelBounds actual, JToken expected, string context) {
        var values = expected.Values<double>().ToList();
        Assert.That(actual.Minimum, Is.EqualTo(values[0]).Within(Tolerance), $"{context}.min");
        Assert.That(actual.Maximum, Is.EqualTo(values[1]).Within(Tolerance), $"{context}.max");
    }

    private static void AssertVector(FamilyModelVector actual, JToken expected, string context) {
        var values = expected.Values<double>().ToList();
        Assert.That(actual.X, Is.EqualTo(values[0]).Within(Tolerance), $"{context}.x");
        Assert.That(actual.Y, Is.EqualTo(values[1]).Within(Tolerance), $"{context}.y");
        Assert.That(actual.Z, Is.EqualTo(values[2]).Within(Tolerance), $"{context}.z");
    }

    private static FamilyModelVector ReadVector(JToken token) {
        var values = token.Values<double>().ToList();
        return new FamilyModelVector(values[0], values[1], values[2]);
    }

    /// <summary>Reads the one conformance fixture from the repository, so no second copy of it can drift.</summary>
    private static JObject ReadConformanceVectors() {
        var directory = new DirectoryInfo(AppContext.BaseDirectory);
        while (directory != null && !File.Exists(Path.Combine(directory.FullName, "Pe.Tools.slnx")))
            directory = directory.Parent;

        Assert.That(directory, Is.Not.Null, "the repository root carries the shared conformance fixture");
        return JObject.Parse(File.ReadAllText(Path.Combine(
            directory!.FullName,
            "source", "Pe.Revit.Tests", "Fixtures", "Profiles", "family-model-evaluator.conformance.json")));
    }
}
