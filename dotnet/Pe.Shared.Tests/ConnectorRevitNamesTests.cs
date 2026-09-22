using Pe.Shared.RevitData.Families;

namespace Pe.Shared.Tests;

/// <summary>
///     w8-revit claim 3e: capture wrote `FireProtectionDry` and apply parsed it as a `PipeSystemType` name, so every
///     captured sprinkler failed to apply. The fixture is the member w8-revit captured from
///     "Sprinkler - Dry - Horizontal Sidewall - Hosted" (`reports/w8-revit-evidence/44-editfamily-member.json`,
///     sha 8a7d4f9b…), committed verbatim. The Revit member names are Revit 2025's, read from `RevitAPI.xml`.
/// </summary>
[TestFixture]
public sealed class ConnectorRevitNamesTests {
    [Test]
    public void Captured_sprinkler_connector_round_trips_through_the_revit_names() {
        var json = File.ReadAllText(Path.Combine(FamilyModelContractTests.FixtureDir, "w8-revit-sprinkler.captured.json"));
        var connector = FamilyModelJson.Parse(json).Value!.Connectors["pipe-fireprotectiondry"];

        Assert.That(ConnectorRevitNames.RevitName(connector.SystemType), Is.EqualTo("FireProtectDry"));
        Assert.That(ConnectorRevitNames.FromRevitName<ConnectorSystemType>("FireProtectDry"), Is.EqualTo(connector.SystemType));
        Assert.That(ConnectorRevitNames.FromRevitName<FlowDirection>(ConnectorRevitNames.RevitName(connector.FlowDirection!.Value)), Is.EqualTo(connector.FlowDirection));
        Assert.That(ConnectorRevitNames.FromRevitName<FlowConfiguration>(ConnectorRevitNames.RevitName(connector.FlowConfiguration!.Value)), Is.EqualTo(connector.FlowConfiguration));
        Assert.That(ConnectorRevitNames.FromRevitName<LossMethod>(ConnectorRevitNames.RevitName(connector.LossMethod!.Value)), Is.EqualTo(connector.LossMethod));
    }

    [Test]
    public void Every_system_type_round_trips_and_names_a_revit_member() {
        var revit = new HashSet<string> {
            // DuctSystemType, PipeSystemType, ElectricalSystemType (Revit 2025), less UndefinedSystemType.
            "SupplyAir", "ReturnAir", "ExhaustAir", "OtherAir", "Global", "Fitting",
            "SupplyHydronic", "ReturnHydronic", "DomesticHotWater", "DomesticColdWater", "Sanitary", "Vent", "OtherPipe",
            "FireProtectWet", "FireProtectDry", "FireProtectPreaction", "FireProtectOther",
            "PowerCircuit", "PowerBalanced", "PowerUnBalanced", "Data", "Telephone", "Security", "FireAlarm", "NurseCall", "Controls", "Communication"
        };
        foreach (var t in Enum.GetValues<ConnectorSystemType>()) {
            Assert.That(revit, Does.Contain(ConnectorRevitNames.RevitName(t)), t.ToString());
            Assert.That(ConnectorRevitNames.FromRevitName<ConnectorSystemType>(ConnectorRevitNames.RevitName(t)), Is.EqualTo(t));
        }
        Assert.That(ConnectorRevitNames.FromRevitName<ConnectorSystemType>("DataCircuit"), Is.EqualTo(ConnectorSystemType.Data),
            "MEPSystemClassification spells the electrical Data system DataCircuit.");
        Assert.That(ConnectorRevitNames.FromRevitName<ConnectorSystemType>("Storm"), Is.Null, "A classification no connector can be created with stays unmodeled.");
    }
}
