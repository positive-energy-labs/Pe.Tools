using Pe.Shared.RevitData.Families;

namespace Pe.Shared.Tests;

/// <summary>
///     Ruling 2026-09-19 ("always map, and always be careful of implicit units bc project units are a bitch and hidden"): a mapping may
///     declare the unit its bare source numbers are written in. A declared unit that is not a unit of the destination spec refuses at parse.
/// </summary>
[TestFixture]
public sealed class MappingUnitTests {
    private const string Power = "autodesk.spec.aec.hvac:power-2.0.0";

    private static FamilyModelParseResult Parse(string parameter) =>
        FamilyModelJson.Parse($$$"""{"family":{"name":"F","category":"GenericModels","template":"Generic Model","placement":"OneLevelBased"},"parameters":{"P":{{{parameter}}}}}""");

    private static string Shared(string spec, string unit) =>
        $$"""{"shared":true,"sharedGuid":"692091cc-1e3d-47e6-a7c5-9336c3149419","sharedSpecId":"{{spec}}","wasNamed":["S"],"mappingUnit":"{{unit}}"}""";

    [TestCase("Btu/h")]
    [TestCase("btu/h")]
    [TestCase("kW")]
    public void A_unit_of_the_destination_spec_parses_and_roundtrips(string unit) {
        var result = Parse(Shared(Power, unit));
        Assert.That(result.Diagnostics, Is.Empty);
        Assert.That(result.Value!.Parameters["P"].MappingUnit, Is.EqualTo(unit));
        Assert.That(FamilyModelJson.Parse(FamilyModelJson.Serialize(result.Value)).Value!.Parameters["P"].MappingUnit, Is.EqualTo(unit));
    }

    [Test]
    public void A_unit_of_another_spec_is_refused_at_parse_naming_the_allowed_units() {
        var diagnostic = Parse(Shared(Power, "in")).Diagnostics.Single();
        Assert.That(diagnostic.Code, Is.EqualTo(FamilyModelDiagnosticCodes.MappingUnitNotOfSpec));
        Assert.That(diagnostic.Path, Is.EqualTo("$.parameters.P.mappingUnit"));
        Assert.That(diagnostic.Message, Does.Contain("'in' is not a unit of power").And.Contain("Legal: \"Btu/h\", \"MBH\", \"W\", \"kW\", \"ton\""));
    }

    [Test]
    public void A_dataType_destination_is_judged_by_its_own_spec() {
        Assert.That(Parse("""{"dataType":"Length","wasNamed":["S"],"mappingUnit":"in"}""").Diagnostics, Is.Empty);
        Assert.That(Parse("""{"dataType":"Length","wasNamed":["S"],"mappingUnit":"Btu/h"}""").Diagnostics.Single().Message,
            Does.Contain("'Btu/h' is not a unit of length"));
    }

    [Test]
    public void A_spec_that_measures_no_unit_takes_no_mapping_unit() =>
        Assert.That(Parse("""{"dataType":"Number","wasNamed":["S"],"mappingUnit":"in"}""").Diagnostics.Single().Message,
            Does.Contain("number takes no mappingUnit"));

    [TestCase("autodesk.spec.aec.hvac:power-2.0.0", "power")]
    [TestCase("autodesk.spec.aec.electrical:potential-2.0.0", "potential")]
    [TestCase("autodesk.spec.aec:length-2.0.1", "length")]
    public void A_spec_is_keyed_by_its_leaf(string spec, string leaf) => Assert.That(MappingUnits.Leaf(spec), Is.EqualTo(leaf));

    [Test]
    public void Every_measured_data_type_has_mapping_units_and_every_symbol_is_unique_within_its_spec() {
        var measured = new[] {
            DataType.Length, DataType.Area, DataType.Volume, DataType.Angle, DataType.ElectricalPotential, DataType.Current, DataType.ApparentPower,
            DataType.Wattage, DataType.AirFlow, DataType.Pressure, DataType.Temperature, DataType.PipingFlow, DataType.PipeSize, DataType.DuctSize,
            DataType.HvacVelocity
        };
        Assert.Multiple(() => {
            foreach (var dataType in measured)
                Assert.That(MappingUnits.ByLeaf.ContainsKey(MappingUnits.Leaf(dataType)), dataType.ToString());
            foreach (var (leaf, units) in MappingUnits.ByLeaf) {
                var spellings = units.SelectMany(unit => unit.Aliases.Prepend(unit.Symbol)).ToList();
                Assert.That(spellings, Is.Unique.Using((IEqualityComparer<string>)StringComparer.OrdinalIgnoreCase), leaf);
            }
        });
    }
}
