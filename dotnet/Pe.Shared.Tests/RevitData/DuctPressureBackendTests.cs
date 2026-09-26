using System.Text;
using Newtonsoft.Json;
using Newtonsoft.Json.Converters;
using Newtonsoft.Json.Linq;
using Newtonsoft.Json.Serialization;
using Pe.Shared.RevitData.Ducts;

namespace Pe.Shared.Tests.RevitData;

/// <summary>The snapshot-to-pressure contract and conservative fitting classification, without Revit.</summary>
[TestFixture]
public sealed class DuctPressureBackendTests {
    private static DuctEvidence<double?> Measured(double? value, string source) => new(value, DuctProvenance.Geometry, source);
    private static DuctConnector Port(int index, double diameter = 12) =>
        new(index, "end", [index, 0, 0], DuctShape.Round, "", diameter, null, null, null, "bidirectional", null, null);
    private static FittingGeometry Classify(string family, string part = "Elbow", double? radius = 1, double? ductRadius = .5,
        IReadOnlyList<DuctConnector>? ports = null) =>
        DuctFittingGeometry.Classify(part, family, "Standard", ports ?? [Port(0), Port(1)],
            Measured(90, "instance.Angle"), Measured(radius, "instance.Center Radius"), Measured(ductRadius, "instance.Duct Radius"));

    [Test]
    public void Construction_requires_explicit_evidence_and_radius_uses_diameter_not_duct_radius() {
        var smooth = Classify("Smooth Round Elbow");
        Assert.Multiple(() => {
            Assert.That(smooth.Construction.Value, Is.EqualTo(FittingConstruction.SmoothRound));
            Assert.That(smooth.RadiusOverDiameter.Value, Is.EqualTo(1));
            Assert.That(smooth.RadiusOverDiameter.Evidence, Does.Contain("2 * instance.Duct Radius"));
            Assert.That(Classify("Simple Round Tee", "Tee", ports: [Port(0), Port(1), Port(2)])
                .ConnectorAreas[0].AreaFt2.Value, Is.EqualTo(Math.PI / 4).Within(1e-12));
            Assert.That(Classify("Round Elbow").Construction.Value, Is.EqualTo(FittingConstruction.Unknown));
            Assert.That(Classify("Gored Smooth Round Elbow").Construction.Value, Is.EqualTo(FittingConstruction.Unknown));
            Assert.That(Classify("Not Smooth Round Elbow").Construction.Value, Is.EqualTo(FittingConstruction.Unknown));
            Assert.That(Classify("Not Die Stamped Round Elbow").Construction.Value, Is.EqualTo(FittingConstruction.Unknown));
            Assert.That(Classify("Nonsmooth Round Elbow").Construction.Value, Is.EqualTo(FittingConstruction.Unknown));
            Assert.That(Classify("Rectangular Elbow - Mitered").Construction.Value, Is.EqualTo(FittingConstruction.Mitered));
            Assert.That(Classify("Rectangular Elbow - Mitered - Double Thickness Vanes").Construction.Value, Is.EqualTo(FittingConstruction.Vaned));
            Assert.That(Classify("Mitered without vanes").Construction.Value, Is.EqualTo(FittingConstruction.Mitered));
            Assert.That(Classify("Round Transition - Angle", "Transition").Construction.Value, Is.EqualTo(FittingConstruction.Transition));
            Assert.That(Classify("Round Tee", "Tee", ports: [Port(0), Port(1), Port(2)]).Construction.Value, Is.EqualTo(FittingConstruction.Unknown));
            Assert.That(Classify("Simple Round Tee", "Tee", ports: [Port(0), Port(1), Port(2)]).Construction.Value, Is.EqualTo(FittingConstruction.SimpleJunction));
            Assert.That(Classify("Smooth Round Elbow", radius: null).RadiusOverDiameter.Value, Is.Null);
            Assert.That(Classify("Smooth Round Elbow", ductRadius: null).RadiusOverDiameter.Value, Is.EqualTo(1));
            Assert.That(Classify("Smooth Round Elbow", ductRadius: .25).RadiusOverDiameter.Value, Is.Null);
            Assert.That(Classify("Smooth Round Elbow", radius: double.NaN).RadiusOverDiameter.Value, Is.Null);
        });
        var row = DuctCoefficientTable.Lookup(PressurePartType.Elbow, FittingPath.Bend,
            smooth.AngleDegrees.Value, smooth.RadiusOverDiameter.Value, 1, 1, 1, false, 1, smooth.Construction.Value);
        Assert.That(row?.Coefficient, Is.EqualTo(.22)); // 3-1, r/D=1, 90 degrees.
    }

    internal static DuctSnapshotData Network() {
        var fan = new DuctNode(1, DuctNodeKind.Equipment, "", "Fan", "", null, null, [0, 0, 0], null, "", "Exhaust Air",
            [Port(0) with { ConnectedTo = new(10, 0) }], []);
        var terminal = new DuctNode(2, DuctNodeKind.Terminal, "", "Terminal: exact", "", null, null, [10, 0, 0], null, "", "Exhaust Air",
            [Port(0) with { Point = [10, 0, 0], ConnectedTo = new(10, 1) }],
            [new(DuctNetwork.TerminalFlow, 200, null, "cfm", DuctProvenance.DesignerStated)]);
        var segment = new DuctSegment(10, DuctSegmentKind.Flex, "Flex: exact", DuctShape.Round, "12", 12, null, null, 10,
            [[0, 0, 0], [10, 0, 0]], null, null, "", "Exhaust Air", new(.0003, DuctProvenance.RevitDefault), new(null, null, null, null),
            [Port(0) with { ConnectedTo = new(1, 0) }, Port(1) with { Point = [10, 0, 0], ConnectedTo = new(2, 0) },
                Port(2) with { Kind = "curve", Point = [5, 0, 0] }]);
        var graph = DuctNetwork.Analyze([fan, terminal], [segment]);
        return new(new("authored", DateTimeOffset.UnixEpoch, 0), [], graph.Groups, graph.Nodes, graph.Segments, graph.Flows, graph.Issues, []);
    }

    [Test]
    public void Snapshot_argument_maps_exact_staged_keys_and_echoes_revision_without_changing_capture() {
        var snapshot = Network();
        var open = snapshot.Issues.Single(i => i.Kind == DuctIssueKind.OpenEnd).Id;
        var input = new DuctStagedAssumptions(37, new Dictionary<string, DuctWorkAssumption> {
            ["fan-static:1"] = new(DuctAssumptionKind.FanStatic, InWg: .5),
            ["component-drop:Terminal: exact"] = new(DuctAssumptionKind.ComponentDrop, InWg: 0),
            ["component-drop:Fan"] = new(DuctAssumptionKind.ComponentDrop, InWg: 0),
            ["flex-roughness:Flex: exact"] = new(DuctAssumptionKind.FlexRoughness, Ft: .001),
            [open] = new(DuctAssumptionKind.Verdict, Verdict: OpenEndVerdict.Capped)
        });
        var wire = JsonConvert.SerializeObject(new DuctSnapshotRequest { Assumptions = input }, Wire);
        var request = JsonConvert.DeserializeObject<DuctSnapshotRequest>(wire, Wire)!;
        var assessed = DuctPressureAssessment.Assess(snapshot, request.Assumptions);
        Assert.Multiple(() => {
            Assert.That(assessed.Nodes, Is.SameAs(snapshot.Nodes));
            Assert.That(assessed.Issues, Is.SameAs(snapshot.Issues));
            Assert.That(assessed.Pressure!.AssumptionRevision, Is.EqualTo(37));
            Assert.That(assessed.Pressure.Terminals.Single().IsComplete, Is.True);
            Assert.That(assessed.Pressure.Groups.Single().AvailableStaticInWg, Is.EqualTo(.5));
            Assert.That(assessed.Pressure.AssumptionsUsed.Count(a => a.Source == AssumptionSource.User), Is.EqualTo(5));
            Assert.That(assessed.Pressure.AssumptionsUsed.Where(a => a.Source == AssumptionSource.User).All(a => a.Reason.Contains("revision 37")), Is.True);
        });
        var defaults = DuctPressureAssessment.Assess(snapshot, JsonConvert.DeserializeObject<DuctSnapshotRequest>("{}")!.Assumptions);
        Assert.That(defaults.Pressure!.AssumptionRevision, Is.Null);
        Assert.That(defaults.Pressure.Issues.Any(i => i.Code == "unresolved-open-end"), Is.True);
        var connect = input with { Revision = 38, Values = new Dictionary<string, DuctWorkAssumption>(input.Values) { [open] = new(DuctAssumptionKind.Verdict, Verdict: OpenEndVerdict.Connect) } };
        Assert.That(DuctPressureAssessment.Assess(snapshot, connect).Pressure!.Issues.Any(i => i.Code == "unresolved-open-end"), Is.True);
    }

    [Test]
    public void Malformed_wrong_kind_nonfinite_and_stale_assumptions_are_refused() {
        var snapshot = Network();
        foreach (var pair in new Dictionary<string, DuctWorkAssumption> {
            ["fan-static:01"] = new(DuctAssumptionKind.FanStatic, InWg: .5),
            ["fan-static:99"] = new(DuctAssumptionKind.FanStatic, InWg: .5),
            ["fan-static:2"] = new(DuctAssumptionKind.FanStatic, InWg: .5),
            ["component-drop:absent"] = new(DuctAssumptionKind.ComponentDrop, InWg: 0),
            ["flex-roughness:Flex: exact"] = new(DuctAssumptionKind.FlexRoughness, Ft: 0),
            ["fan-static:1"] = new(DuctAssumptionKind.ComponentDrop, InWg: .5),
            ["component-drop:Terminal: exact"] = new(DuctAssumptionKind.ComponentDrop, InWg: double.NaN),
            ["open-end:g10:10:99"] = new(DuctAssumptionKind.Verdict, Verdict: OpenEndVerdict.Capped)
        }) Assert.Throws<ArgumentException>(() => DuctPressureAssessment.Assess(snapshot, new(1, new Dictionary<string, DuctWorkAssumption> { [pair.Key] = pair.Value })), pair.Key);
        Assert.Throws<ArgumentException>(() => DuctPressureAssessment.Assess(snapshot, new(-1, new Dictionary<string, DuctWorkAssumption>())));
        Assert.Throws<JsonSerializationException>(() => JsonConvert.DeserializeObject<DuctSnapshotRequest>("{\"assumptions\":{\"values\":{}}}"));
        Assert.Throws<JsonSerializationException>(() => JsonConvert.DeserializeObject<DuctWorkAssumption>("{\"inWg\":1}"));
    }

    [Test]
    public void Census_sample_radius_does_not_license_a_smooth_class_or_an_element_identity() {
        var census = JObject.Parse(File.ReadAllText(RequiredFile("PE_DUCTS_SOLVER_AIR_SETTINGS")));
        var sample = census["fittings"]!["famParamNames"]!.Single(f => (string?)f["fam"] == "Round Elbow");
        var values = sample["doubles"]!.Values<string>().ToArray();
        Assert.That(values, Does.Contain("Duct Radius=6\""));
        Assert.That(values, Does.Contain("Center Radius=12\""));
        Assert.That(values, Does.Contain("Angle=90.00°"));
        Assert.That(sample["id"], Is.Null);
        // These displayed sample values support r/D=12/(2*6)=1 for this anonymous sample only.
        var geometry = Classify("Round Elbow", radius: 12.0 / 12, ductRadius: 6.0 / 12);
        Assert.That(geometry.RadiusOverDiameter.Value, Is.EqualTo(1));
        Assert.That(geometry.Construction.Value, Is.EqualTo(FittingConstruction.Unknown));
    }

    [Test]
    public void Saved_fixture_match_rate_and_payload_growth_are_measured_without_fabricating_radius() {
        var path = RequiredFile("PE_DUCTS_SOLVER_FIXTURE");
        var original = File.ReadAllText(path);
        var snapshot = DuctPressureSolver.ReadSnapshot(original);
        var fittings = snapshot.Nodes.Where(n => n.Kind is DuctNodeKind.Fitting or DuctNodeKind.Cap).ToList();
        Assert.That(fittings.All(n => n.FittingGeometry is null && n.Facts.All(f => f.Key == "angle")), Is.True);
        var enriched = snapshot with { Nodes = snapshot.Nodes.Select(n => n.Kind is DuctNodeKind.Fitting or DuctNodeKind.Cap
            ? n with { FittingGeometry = DuctFittingGeometry.Classify(n.PartType, n.Family, n.Type, n.Connectors,
                Measured(n.Facts.FirstOrDefault(f => f.Key == "angle")?.Value, "saved angle fact"),
                Measured(null, "Center Radius absent from saved fixture"), Measured(null, "Duct Radius absent from saved fixture")) }
            : n).ToList() };
        var assessed = DuctPressureAssessment.Assess(enriched);
        Assert.That(assessed.Pressure!.Fittings.Count(f => f.CoefficientRow != "assumed-one-velocity-head"), Is.Zero);
        Assert.That(enriched.Nodes.Single(n => n.Id == 6979397).FittingGeometry!.Construction.Value, Is.EqualTo(FittingConstruction.Vaned));
        Assert.That(enriched.Nodes.Single(n => n.Id == 6522833).FittingGeometry!.Construction.Value, Is.EqualTo(FittingConstruction.Mitered));
        var summary = new {
            FixtureSha256 = Convert.ToHexString(System.Security.Cryptography.SHA256.HashData(File.ReadAllBytes(path))),
            FittingsIncludingCaps = fittings.Count,
            Classified = enriched.Nodes.Where(n => n.FittingGeometry != null).GroupBy(n => n.FittingGeometry!.Construction.Value).ToDictionary(g => g.Key.ToString(), g => g.Count()),
            CalculatedLegs = assessed.Pressure.Fittings.Count,
            SourcedLegs = assessed.Pressure.Fittings.Count(f => f.CoefficientRow != "assumed-one-velocity-head"),
            OriginalCompactBytes = Encoding.UTF8.GetByteCount(JObject.Parse(original).ToString(Formatting.None)),
            PressureBytes = Encoding.UTF8.GetByteCount(JsonConvert.SerializeObject(assessed.Pressure, Wire)),
            EnrichedSnapshotBytes = Encoding.UTF8.GetByteCount(JsonConvert.SerializeObject(enriched, Wire)),
            CombinedBytes = Encoding.UTF8.GetByteCount(JsonConvert.SerializeObject(assessed, Wire)),
            Caveat = "Fixture lacks per-element radius and selected friction method; geometry enrichment uses names, angles and connectors only. Runtime size and time need recapture."
        };
        Evidence("pressure-backend-payload.json", summary);
        Evidence("pressure-backend-solve.json", assessed.Pressure);
        TestContext.WriteLine(JsonConvert.SerializeObject(summary));
    }

    private static readonly JsonSerializerSettings Wire = new() {
        NullValueHandling = NullValueHandling.Ignore,
        ContractResolver = new DefaultContractResolver { NamingStrategy = new CamelCaseNamingStrategy { ProcessDictionaryKeys = false } },
        Converters = [new StringEnumConverter()]
    };
    private static string RequiredFile(string variable) {
        var path = Environment.GetEnvironmentVariable(variable);
        if (path is null || !File.Exists(path)) Assert.Ignore("Set " + variable + " to the private saved input.");
        return path!;
    }
    private static void Evidence(string name, object value) {
        if (Environment.GetEnvironmentVariable("PE_DUCTS_SOLVER_EVIDENCE") is not { } path) return;
        Directory.CreateDirectory(path);
        File.WriteAllText(Path.Combine(path, name), JsonConvert.SerializeObject(value, Formatting.Indented, Wire));
    }
}
