using System.Globalization;
using System.Text.RegularExpressions;
using Newtonsoft.Json;
using Newtonsoft.Json.Linq;
using Pe.Shared.RevitData.Ducts;

namespace Pe.Shared.Tests.RevitData;

/// <summary>Hand calculations, real saved oracle inputs, and a whole-fixture deterministic solve without Revit.</summary>
[TestFixture]
public sealed class DuctPressureTests {
    private static Assumption<T> User<T>(T value) => new(value, AssumptionSource.User, "Hand-case design input");
    private static FittingGeometry Geometry(double angle, double radius, FittingConstruction construction) => new(
        new(angle, DuctProvenance.DesignerStated, "Hand-case angle"),
        new(radius, DuctProvenance.DesignerStated, "Hand-case r/D"),
        new(construction, DuctProvenance.DesignerStated, "Hand-case construction"), []);
    private static Assumptions Budget => new() { DefaultFanExternalStatic = User<double?>(.5), DefaultComponentDrop = User<double?>(0) };
    private static DuctConnector Port(int index, long? to, int toPort, double x, double y = 0, double diameter = 8, string kind = "end") =>
        new(index, kind, [x, y, 0], DuctShape.Round, "", diameter, null, null, null, "bidirectional", null,
            to.HasValue ? new DuctRef(to.Value, toPort) : null);
    private static DuctNode Node(long id, DuctNodeKind kind, double x, double y, IReadOnlyList<DuctConnector> ports,
        double? flow = null, string? part = null, string classification = "Exhaust Air") =>
        new(id, kind, "", "Family", "", part, null, [x, y, 0], null, "", classification, ports,
            flow.HasValue ? [new(DuctNetwork.TerminalFlow, flow, null, "cfm", DuctProvenance.DesignerStated)] : []);
    private static DuctSegment Duct(long id, double length, params DuctConnector[] ports) =>
        new(id, DuctSegmentKind.Duct, "", DuctShape.Round, "", ports[0].DiameterIn, null, null, length,
            [ports[0].Point, ports[1].Point], null, null, "", "Exhaust Air", new(.0003, DuctProvenance.DesignerStated),
            new(null, null, null, null), ports);

    private static DuctNetwork.Analysis Straight(double length = 100) => DuctNetwork.Analyze([
        Node(1, DuctNodeKind.Equipment, 0, 0, [Port(0, 10, 0, 0)]),
        Node(2, DuctNodeKind.Terminal, length, 0, [Port(0, 10, 1, length)], 200)
    ], [Duct(10, length, Port(0, 1, 0, 0), Port(1, 2, 0, length))]);

    [Test]
    public void Round_straight_matches_a_hand_Darcy_Colebrook_calculation_and_budget() {
        // 8in, 200cfm, 100ft, eps=.0003ft, rho=1.204kg/m3, mu=.0000181Pa.s.
        // A=pi*(8/12)^2/4=.34906585ft2; v=572.957795fpm; solve 1/sqrt(f)=... then dp=f*L/D*rho*v^2/2.
        var solved = DuctPressureSolver.Solve(Straight(), Budget);
        var f = solved.Segments.Single().Friction;
        Assert.Multiple(() => {
            Assert.That(f.VelocityFpm, Is.EqualTo(572.95779513).Within(1e-7));
            Assert.That(f.ReynoldsNumber, Is.EqualTo(39342.13826584).Within(1e-6));
            Assert.That(f.FrictionFactor, Is.EqualTo(.02339924192165).Within(1e-12));
            Assert.That(f.PressureDropInWg, Is.EqualTo(.071935295934115).Within(1e-12));
            Assert.That(solved.Terminals.Single().TotalLossInWg, Is.EqualTo(f.PressureDropInWg));
            Assert.That(solved.Groups.Single().TotalEffectiveLengthFt, Is.EqualTo(100));
            Assert.That(solved.Groups.Single().FrictionRateInWgPer100Ft, Is.EqualTo(.5));
            Assert.That(solved.Groups.Single().MarginInWg, Is.EqualTo(.5 - f.PressureDropInWg).Within(1e-12));
            Assert.That(solved.Groups.Single().IsWalkable, Is.True);
            Assert.That(solved.Segments.Single().AssumptionsUsed, Does.Contain("air:density"));
        });
    }

    [Test]
    public void Smooth_elbow_uses_the_sourced_radius_and_angle_row() {
        var nodes = new[] {
            Node(1, DuctNodeKind.Equipment, 0, 0, [Port(0, 10, 0, 0)]),
            Node(20, DuctNodeKind.Fitting, 11, 0, [Port(0, 10, 1, 10), Port(1, 11, 0, 11, 1)], part: "Elbow"),
            Node(2, DuctNodeKind.Terminal, 11, 11, [Port(0, 11, 1, 11, 11)], 200)
        };
        var ducts = new[] { Duct(10, 10, Port(0, 1, 0, 0), Port(1, 20, 0, 10)), Duct(11, 10, Port(0, 20, 1, 11, 1), Port(1, 2, 0, 11, 11)) };
        var assumptions = Budget with { FittingGeometry = new Dictionary<long, Assumption<FittingGeometry>> { [20] = User(Geometry(90, 1.5, FittingConstruction.SmoothRound)) } };
        var solved = DuctPressureSolver.Solve(DuctNetwork.Analyze(nodes, ducts), assumptions);
        var fitting = solved.Fittings.Single();
        Assert.Multiple(() => {
            Assert.That(fitting.Coefficient, Is.EqualTo(.15)); // ASHRAE 3-1, 90deg, r/D=1.5.
            Assert.That(fitting.PressureDropInWg, Is.EqualTo(.00307425754112).Within(1e-12));
            Assert.That(fitting.EquivalentLengthFt, Is.EqualTo(.15 * (8.0 / 12) / .02339924192165).Within(1e-10));
            Assert.That(fitting.AssumptionsUsed, Does.Contain("geometry:20"));
            Assert.That(solved.Issues.Any(i => i.Code == "unmatched-fitting"), Is.False);
        });
        // The captured geometry path must select the same row without an authored geometry override.
        var capturedNodes = nodes.Select(n => n.Id == 20 ? n with { FittingGeometry = assumptions.FittingGeometry[20].Value } : n).ToArray();
        var captured = DuctPressureSolver.Solve(DuctNetwork.Analyze(capturedNodes, ducts), Budget);
        Assert.That(captured.Fittings.Single().Coefficient, Is.EqualTo(fitting.Coefficient));
        Assert.That(captured.Fittings.Single().CoefficientRow, Is.EqualTo(fitting.CoefficientRow));
    }

    private static DuctNetwork.Analysis Split(double mainLength = 5, double branchLength = 40) {
        var branchDiameter = Math.Sqrt(32); // Ab/Ac=.5, Ac=As. A deliberately authored, unmapped network.
        var nodes = new[] {
            Node(1, DuctNodeKind.Equipment, 0, 0, [Port(0, 10, 0, 0)], classification: "Supply Air"),
            Node(20, DuctNodeKind.Fitting, 11, 0, [Port(0, 10, 1, 10), Port(1, 11, 0, 12), Port(2, 12, 0, 11, 1, branchDiameter)], part: "Tee", classification: "Supply Air"),
            Node(2, DuctNodeKind.Terminal, 12 + mainLength, 0, [Port(0, 11, 1, 12 + mainLength)], 100, classification: "Supply Air"),
            Node(3, DuctNodeKind.Terminal, 11, 1 + branchLength, [Port(0, 12, 1, 11, 1 + branchLength, branchDiameter)], 100, classification: "Supply Air")
        };
        var ducts = new[] {
            Duct(10, 10, Port(0, 1, 0, 0), Port(1, 20, 0, 10)),
            Duct(11, mainLength, Port(0, 20, 1, 12), Port(1, 2, 0, 12 + mainLength)),
            Duct(12, branchLength, Port(0, 20, 2, 11, 1, branchDiameter), Port(1, 3, 0, 11, 1 + branchLength, branchDiameter))
        }.Select(s => s with { Classification = "Supply Air" }).ToArray();
        return DuctNetwork.Analyze(nodes, ducts);
    }
    private static Assumptions TeeAssumptions => Budget with {
        FittingGeometry = new Dictionary<long, Assumption<FittingGeometry>> { [20] = User(Geometry(90, 1, FittingConstruction.SimpleJunction)) }
    };

    [Test]
    public void Tee_split_uses_separate_branch_and_main_C_at_common_velocity_and_finds_the_critical_path() {
        var solved = DuctPressureSolver.Solve(Split(), TeeAssumptions);
        var branch = solved.Fittings.Single(f => f.Path == FittingPath.Branch);
        var main = solved.Fittings.Single(f => f.Path == FittingPath.Straight);
        Assert.Multiple(() => {
            Assert.That(branch.FlowRatio, Is.EqualTo(.5));
            Assert.That(branch.AreaRatio, Is.EqualTo(.5).Within(1e-12));
            Assert.That(branch.PressureDropInWg, Is.EqualTo(.02869307038378).Within(1e-12)); // 1.4 * common VP.
            Assert.That(main.PressureDropInWg, Is.EqualTo(.00204950502741).Within(1e-12)); // .1 * common VP.
            Assert.That(main.Coefficient, Is.EqualTo(.4).Within(1e-12)); // converted to local VP, which is common VP/4.
            Assert.That(solved.Groups.Single().CriticalPath!.TerminalId, Is.EqualTo(3));
            Assert.That(solved.Groups.Single().CriticalPath!.Path, Is.EqualTo(new long[] { 1, 10, 20, 12, 3 }));
            Assert.That(solved.Groups.Single().TotalEffectiveLengthFt, Is.Null, "Supply alone is not full Manual D TEL.");
            Assert.That(solved.Groups.Single().MarginInWg, Is.Null);
        });
        var total = solved.Terminals.Single(t => t.TerminalId == 3).DuctLossInWg;
        Assert.That(total, Is.EqualTo(solved.Segments.Where(s => s.SegmentId is 10 or 12).Sum(s => s.Friction.PressureDropInWg) + branch.PressureDropInWg).Within(1e-12));
    }

    [Test]
    public void Unknown_fittings_get_a_named_nonzero_assumption_and_an_issue() {
        var solved = DuctPressureSolver.Solve(Split(), Budget);
        Assert.That(solved.Fittings.All(f => f.Coefficient == 1 && f.CoefficientRow == "assumed-one-velocity-head"), Is.True);
        Assert.That(solved.Issues.Any(i => i.Code == "unmatched-fitting" && i.ElementId == 20), Is.True);
        Assert.That(solved.Fittings.All(f => f.AssumptionsUsed.Contains("fitting:unmatched")), Is.True);
        Assert.That(DuctCoefficientTable.Lookup(PressurePartType.Tee, FittingPath.Branch, 90, null, 1, 1, .5, false, 2, FittingConstruction.SimpleJunction), Is.Null);
        Assert.That(DuctCoefficientTable.Lookup(PressurePartType.Tee, FittingPath.Branch, 90, null, .5, 1, .5, true, 2, FittingConstruction.SimpleJunction), Is.Null);
    }

    [Test]
    public void Taps_split_length_and_flow_instead_of_applying_upstream_flow_to_the_entire_duct() {
        var nodes = new[] {
            Node(1, DuctNodeKind.Equipment, 0, 0, [Port(0, 10, 0, 0)]),
            Node(2, DuctNodeKind.Terminal, 10, 0, [Port(0, 10, 1, 10)], 100),
            Node(3, DuctNodeKind.Terminal, 5, 0, [Port(0, 10, 2, 5)], 100)
        };
        var duct = Duct(10, 10, Port(0, 1, 0, 0), Port(1, 2, 0, 10), Port(2, 3, 0, 5, kind: "curve"));
        var solved = DuctPressureSolver.Solve(DuctNetwork.Analyze(nodes, [duct]), Budget);
        Assert.That(solved.Segments.Select(s => (s.StartFt, s.EndFt, s.FlowCfm)), Is.EqualTo(new[] { (0.0, 5.0, 200.0), (5.0, 10.0, 100.0) }));
        Assert.That(solved.Terminals.Single(t => t.TerminalId == 3).DuctLossInWg, Is.EqualTo(.071935295934115 * .05).Within(1e-12));
        Assert.That(solved.Terminals.Single(t => t.TerminalId == 2).DuctLossInWg, Is.EqualTo(solved.Segments.Sum(s => s.Friction.PressureDropInWg)).Within(1e-12));
        var centerFed = DuctNetwork.Analyze([
            Node(1, DuctNodeKind.Equipment, 5, 0, [Port(0, 10, 2, 5)]),
            Node(2, DuctNodeKind.Terminal, 0, 0, [Port(0, 10, 0, 0)], 100),
            Node(3, DuctNodeKind.Terminal, 10, 0, [Port(0, 10, 1, 10)], 100)
        ], [Duct(10, 10, Port(0, 2, 0, 0), Port(1, 3, 0, 10), Port(2, 1, 0, 5, kind: "curve"))]);
        var bidirectional = DuctPressureSolver.Solve(centerFed, Budget);
        Assert.That(bidirectional.Segments.Select(s => s.FlowCfm), Is.EqualTo(new[] { 100.0, 100.0 }));
        Assert.That(bidirectional.Terminals.Select(t => t.EffectiveLengthFt), Is.EqualTo(new[] { 5.0, 5.0 }));
    }

    [Test]
    public void Open_end_verdict_resolves_unknown_flow_and_is_a_transitive_dependency() {
        var graph = Straight();
        var duct = graph.Segments.Single();
        duct = duct with { Connectors = duct.Connectors.Concat(new[] { Port(2, null, 0, 50, kind: "curve") }).ToList() };
        graph = DuctNetwork.Analyze(graph.Nodes, [duct]);
        var partial = DuctPressureSolver.Solve(graph, Budget);
        Assert.That(partial.Terminals.Single().IsComplete, Is.False);
        Assert.That(partial.Groups.Single().IsWalkable, Is.False);
        var solved = DuctPressureSolver.Solve(graph, Budget with { OpenEnds = new Dictionary<PressurePort, Assumption<OpenEndVerdict>> { [new(10, 2)] = User(OpenEndVerdict.Capped) } });
        Assert.That(solved.Groups.Single().IsWalkable, Is.True);
        Assert.That(solved.Terminals.Single().AssumptionsUsed, Does.Contain("open:10:2"));
    }

    [Test]
    public void A_cycle_keeps_the_unique_root_subtree_and_never_invents_a_path_through_the_cycle() {
        var graph = Straight(10);
        var duct = graph.Segments.Single();
        duct = duct with { Connectors = duct.Connectors.Concat(new[] { Port(2, 11, 0, 5, kind: "curve") }).ToList() };
        var nodes = graph.Nodes.Concat(new[] {
            Node(20, DuctNodeKind.Fitting, 5, 5, [Port(0, 11, 1, 5, 4), Port(1, 12, 0, 6, 5), Port(2, 13, 0, 5, 6)], part: "Tee")
        }).ToList();
        var s11 = Duct(11, 4, Port(0, 10, 2, 5), Port(1, 20, 0, 5, 4));
        var s12 = Duct(12, 5, Port(0, 20, 1, 6, 5), Port(1, 13, 1, 10, 5));
        var s13 = Duct(13, 5, Port(0, 20, 2, 5, 6), Port(1, 12, 1, 10, 5));
        var solved = DuctPressureSolver.Solve(DuctNetwork.Analyze(nodes, [duct, s11, s12, s13]), Budget);
        Assert.That(solved.Terminals.Single().TerminalId, Is.EqualTo(2));
        Assert.That(solved.Terminals.Single().IsComplete, Is.False);
        Assert.That(solved.Segments.Any(s => s.SegmentId == 10 && s.Friction.PressureDropInWg > 0), Is.True);
        Assert.That(solved.Segments.Any(s => s.SegmentId is 12 or 13), Is.False);
        Assert.That(solved.Issues.Any(i => i.Code == "cycle-boundary"), Is.True);
    }

    [Test]
    public void Supply_plus_return_budget_combines_series_sides_and_counts_the_root_component_once() {
        var graph = Straight(10);
        var supplyNodes = graph.Nodes.Select(n => n with { Classification = "Supply Air" }).ToList();
        supplyNodes[0] = supplyNodes[0] with { Connectors = [Port(0, 10, 0, 0), Port(1, 11, 0, 0, 2)] };
        supplyNodes.Add(Node(3, DuctNodeKind.Terminal, 20, 2, [Port(0, 11, 1, 20, 2)], 200, classification: "Return Air"));
        var ducts = new[] { graph.Segments[0] with { Classification = "Supply Air" }, Duct(11, 20, Port(0, 1, 1, 0, 2), Port(1, 3, 0, 20, 2)) with { Classification = "Return Air" } };
        var a = Budget with { ComponentDropByElement = new Dictionary<long, Assumption<double>> { [1] = User(.1), [2] = User(.02), [3] = User(.03) } };
        var solved = DuctPressureSolver.Solve(DuctNetwork.Analyze(supplyNodes, ducts), a);
        foreach (var group in solved.Groups) Assert.Multiple(() => {
            Assert.That(group.TotalEffectiveLengthFt, Is.EqualTo(30));
            Assert.That(group.AvailableStaticInWg, Is.EqualTo(.35).Within(1e-12));
            Assert.That(group.FrictionRateInWgPer100Ft, Is.EqualTo(.35 * 100 / 30).Within(1e-12));
            Assert.That(group.MarginInWg, Is.EqualTo(.35 - .071935295934115 * .3).Within(1e-12));
            Assert.That(group.AssumptionsUsed, Does.Contain("component:element:1"));
            Assert.That(group.AssumptionsUsed, Does.Contain("component:element:3"));
        });
    }

    [Test]
    public void Missing_budgets_stay_null_and_invalid_numeric_inputs_do_not_become_results() {
        var solved = DuctPressureSolver.Solve(Straight(), new());
        Assert.That(solved.Groups.Single().CriticalPath!.DuctLossInWg, Is.GreaterThan(0));
        Assert.That(solved.Groups.Single().AvailableStaticInWg, Is.Null);
        Assert.That(solved.Terminals.Single().TotalLossInWg, Is.Null);
        Assert.Throws<ArgumentException>(() => DuctPressureSolver.Solve(Straight(), new() { AirDensityKgPerM3 = User(double.NaN) }));
        Assert.That(DuctPressurePhysics.Section(DuctShape.Rectangular, null, 12, 6), Is.EqualTo((.5, 2.0 / 3)));
        Assert.That(DuctPressurePhysics.FrictionFactor(1000, 0), Is.EqualTo(.064));
        Assert.That(DuctPressurePhysics.Straight(DuctShape.Round, 8, null, null, 10, 0, .0003, 1.204, 1.81e-5).PressureDropInWg, Is.Zero);
    }

    [Test]
    public void Flex_compression_needs_a_named_multiplier_and_changes_the_whole_pressure_result() {
        var graph = Straight(10);
        graph = DuctNetwork.Analyze(graph.Nodes, [graph.Segments.Single() with { Kind = DuctSegmentKind.Flex }]);
        var extended = DuctPressureSolver.Solve(graph, Budget);
        var compressed = Budget with { FlexCompression = User(FlexCompression.Compressed) };
        var missing = DuctPressureSolver.Solve(graph, compressed);
        Assert.That(missing.Terminals.Single().IsComplete, Is.False);
        Assert.That(missing.Issues.Any(i => i.Code == "unknown-flex-compression"), Is.True);
        var solved = DuctPressureSolver.Solve(graph, compressed with { FlexPressureMultiplier = User<double?>(2.5) });
        Assert.That(solved.Terminals.Single().DuctLossInWg, Is.EqualTo(extended.Terminals.Single().DuctLossInWg * 2.5).Within(1e-12));
        Assert.That(solved.Terminals.Single().IsComplete, Is.True);
        Assert.That(solved.Groups.Single().AssumptionsUsed, Does.Contain("flex:multiplier"));
        var byType = DuctPressureSolver.Solve(graph, Budget with { FlexRoughnessByType = new Dictionary<string, Assumption<double>> { [""] = User(.0003) } });
        Assert.That(byType.Terminals.Single().DuctLossInWg, Is.EqualTo(.071935295934115 * .1).Within(1e-12));
        Assert.That(byType.Terminals.Single().AssumptionsUsed, Does.Contain("flex:type:"));
        Assert.That(byType.Terminals.Single().AssumptionsUsed, Does.Not.Contain("flex:roughness"));
    }

    [Test]
    public void Component_element_override_beats_family_and_changes_the_critical_terminal() {
        var solved = DuctPressureSolver.Solve(Split(), TeeAssumptions with {
            ComponentDropByFamily = new Dictionary<string, Assumption<double>> { ["Family"] = User(.02) },
            ComponentDropByElement = new Dictionary<long, Assumption<double>> { [2] = User(1.0) }
        });
        Assert.That(solved.Groups.Single().CriticalPath!.TerminalId, Is.EqualTo(2), "The short main has the larger component loss.");
        Assert.That(solved.Groups.Single().CriticalPathIncludesComponents, Is.True);
        Assert.That(solved.Terminals.Single(t => t.TerminalId == 2).ComponentLossInWg, Is.EqualTo(1));
        Assert.That(solved.Terminals.Single(t => t.TerminalId == 3).ComponentLossInWg, Is.EqualTo(.02));
        Assert.That(solved.Groups.Single().PathEffectiveLengthFt, Is.GreaterThan(solved.Groups.Single().CriticalPath!.EffectiveLengthFt),
            "The maximum effective length and maximum pressure path are different selections.");
    }

    [Test]
    public void Coefficient_interpolation_is_bounded_and_preserves_the_primary_velocity_reference() {
        var wye = DuctCoefficientTable.Lookup(PressurePartType.LateralTee, FittingPath.Branch, 45, null, .5, 1, .55, false, 2, FittingConstruction.SimpleJunction)!;
        Assert.That(wye.Coefficient, Is.EqualTo(.425).Within(1e-12));
        Assert.That(wye.CommonVelocity, Is.True);
        Assert.That(wye.Source, Does.Contain("#page=38"));
        Assert.That(DuctCoefficientTable.Lookup(PressurePartType.LateralTee, FittingPath.Branch, 45, null, .5, 1, .95, false, 2, FittingConstruction.SimpleJunction), Is.Null);
        Assert.That(DuctCoefficientTable.Lookup(PressurePartType.Elbow, FittingPath.Bend, 90, 1.5, 1, 1, 1, false, 1, FittingConstruction.Unknown), Is.Null);
    }

    [Test]
    public void Every_private_fixture_group_completes_and_writes_the_default_scenario_distribution() {
        var snapshot = DuctPressureSolver.ReadSnapshot(File.ReadAllText(RequiredFile("PE_DUCTS_SOLVER_FIXTURE")));
        var solved = DuctPressureSolver.Solve(snapshot, new());
        Assert.That(solved.Groups.Select(g => g.GroupId), Is.EquivalentTo(snapshot.Groups.Select(g => g.Id)));
        Assert.That(solved.Groups, Has.Count.EqualTo(401));
        Assert.That(solved.Segments.All(s => double.IsFinite(s.Friction.PressureDropInWg)), Is.True);
        Assert.That(solved.Fittings.All(f => double.IsFinite(f.PressureDropInWg)), Is.True);
        var used = solved.AssumptionsUsed.Select(a => a.Id).ToHashSet();
        Assert.That(solved.Segments.SelectMany(s => s.AssumptionsUsed).Concat(solved.Fittings.SelectMany(s => s.AssumptionsUsed))
            .Concat(solved.Terminals.SelectMany(s => s.AssumptionsUsed)).Concat(solved.Groups.SelectMany(s => s.AssumptionsUsed)).All(used.Contains), Is.True);
        var walkable = solved.Groups.Where(g => g.IsWalkable).ToList();
        Assert.That(walkable, Is.Not.Empty);
        object Distribution(IEnumerable<double> values) {
            var a = values.OrderBy(v => v).ToArray();
            double? Quantile(double p) => a.Length == 0 ? null : a[(int)Math.Round(p * (a.Length - 1))];
            return new { Count = a.Length, Min = Quantile(0), P25 = Quantile(.25), Median = Quantile(.5), P75 = Quantile(.75), P95 = Quantile(.95), Max = Quantile(1) };
        }
        var summary = new {
            Groups = solved.Groups.Count, Walkable = walkable.Count, PartialPaths = solved.Terminals.Count(t => !t.IsComplete),
            Segments = solved.Segments.Count, Fittings = solved.Fittings.Count,
            CriticalDuctLossInWg = Distribution(walkable.Select(g => g.CriticalPath!.DuctLossInWg)),
            CriticalTotalLossInWg = Distribution(walkable.Where(g => g.CriticalPathIncludesComponents).Select(g => g.CriticalPath!.TotalLossInWg!.Value)),
            FrictionRateInWgPer100Ft = Distribution(walkable.Where(g => g.FrictionRateInWgPer100Ft.HasValue).Select(g => g.FrictionRateInWgPer100Ft!.Value)),
            Issues = solved.Issues.GroupBy(i => i.Code).ToDictionary(g => g.Key, g => g.Count())
        };
        Evidence("chadds-distribution.json", summary);
        Evidence("chadds-solve.json", solved);
    }

    [Test]
    public void Saved_Revit_oracle_exposes_the_friction_method_mismatch_without_widening_tolerance() {
        var snapshot = DuctPressureSolver.ReadSnapshot(File.ReadAllText(RequiredFile("PE_DUCTS_SOLVER_FIXTURE")));
        var oracle = JObject.Parse(File.ReadAllText(RequiredFile("PE_DUCTS_SOLVER_ORACLE")));
        var settings = JObject.Parse(File.ReadAllText(RequiredFile("PE_DUCTS_SOLVER_AIR_SETTINGS")))["settings"]!["ductSettings"]!["props"]!;
        var rho = double.Parse(settings["AirDensity"]!.ToString(), CultureInfo.InvariantCulture) / Math.Pow(.3048, 3);
        var mu = double.Parse(settings["AirDynamicViscosity"]!.ToString(), CultureInfo.InvariantCulture) / .3048;
        var byId = snapshot.Segments.ToDictionary(s => s.Id);
        var rows = new List<object>();
        var failures = 0;
        foreach (var cp in oracle["cp"]!)
        foreach (var section in cp["secs"]!.Values<string>()) {
            var flow = double.Parse(Regex.Match(section!, @"flow=([\d.]+)cfm").Groups[1].Value, CultureInfo.InvariantCulture);
            foreach (Match match in Regex.Matches(section!, @"(\d+):(Ducts|Flex Ducts):pd=([\d.]+)inwg:len=([\d.]+)ft:C=([\d.]+)")) {
                var segment = byId[long.Parse(match.Groups[1].Value, CultureInfo.InvariantCulture)];
                var saved = double.Parse(match.Groups[3].Value, CultureInfo.InvariantCulture);
                var length = double.Parse(match.Groups[4].Value, CultureInfo.InvariantCulture);
                double Pressure(double dimensionDelta, double lengthDelta, double flowDelta, bool tsal) {
                    var f = DuctPressurePhysics.Straight(segment.Shape, segment.DiameterIn + dimensionDelta,
                        segment.WidthIn + dimensionDelta, segment.HeightIn + dimensionDelta, Math.Max(0, length + lengthDelta),
                        Math.Max(0, flow + flowDelta), segment.Roughness.ValueFt, rho, mu);
                    if (!tsal) return f.PressureDropInWg;
                    // Diagnostic only: Autodesk's documented Altshul-Tsal equation. Production remains Colebrook.
                    var factor = .11 * Math.Pow(segment.Roughness.ValueFt / f.HydraulicDiameterFt + 68 / f.ReynoldsNumber, .25);
                    if (factor < .018) factor = .85 * factor + .0028;
                    return f.PressureDropInWg * factor / f.FrictionFactor;
                }
                // H2 formats Q to integer CFM, L to .01ft and dP to .0001inwg. Snapshot sizes round to .001in.
                // Evaluate the full serialization interval, including Q; these bounds were fixed before running the solver.
                var cbLo = Pressure(.0005, -.005, -.5, false);
                var cbHi = Pressure(-.0005, .005, .5, false);
                var tsLo = Pressure(.0005, -.005, -.5, true);
                var tsHi = Pressure(-.0005, .005, .5, true);
                var cbMatches = cbLo <= saved + .00005 && cbHi >= Math.Max(0, saved - .00005);
                var tsMatches = tsLo <= saved + .00005 && tsHi >= Math.Max(0, saved - .00005);
                if (!cbMatches) failures++;
                Assert.That(tsMatches, Is.True, $"Altshul-Tsal diagnosis failed for section member {segment.Id}.");
                rows.Add(new { SegmentId = segment.Id, Section = section!.Split(' ')[0], FlowCfm = flow, LengthFt = length,
                    Saved = saved, Colebrook = Pressure(0, 0, 0, false), AltshulTsal = Pressure(0, 0, 0, true),
                    ColebrookMin = cbLo, ColebrookMax = cbHi, ColebrookMatches = cbMatches, AltshulTsalMatches = tsMatches });
            }
        }
        Assert.That(rows, Has.Count.EqualTo(50));
        Assert.That(failures, Is.GreaterThan(0), "The captured engine uses a different friction method; the discrepancy must remain visible.");
        Evidence("oracle.json", new { DensityKgPerM3 = rho, ViscosityPaS = mu, Cases = rows.Count,
            ColebrookMismatches = failures, Cause = "Saved values reproduce Altshul-Tsal, not Colebrook. Selector itself was not captured.", Rows = rows });
    }

    private static string RequiredFile(string key) {
        var path = Environment.GetEnvironmentVariable(key);
        if (string.IsNullOrEmpty(path)) Assert.Ignore($"Set {key} to run the private saved-input lane.");
        Assert.That(File.Exists(path), Is.True, $"{key} names a missing file: {path}");
        return path!;
    }

    private static void Evidence(string name, object result) {
        var text = JsonConvert.SerializeObject(result, Formatting.Indented);
        TestContext.Progress.WriteLine(name + ": " + (name == "chadds-solve.json" || name == "oracle.json" ? "detailed evidence saved" : text));
        var root = Environment.GetEnvironmentVariable("PE_DUCTS_SOLVER_EVIDENCE");
        if (string.IsNullOrEmpty(root)) return;
        Directory.CreateDirectory(root);
        File.WriteAllText(Path.Combine(root, name), text);
    }
}
