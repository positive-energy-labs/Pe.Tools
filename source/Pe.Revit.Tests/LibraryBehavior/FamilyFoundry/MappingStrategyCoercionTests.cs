using Pe.Revit.Extensions.FamDocument;
using Pe.Revit.Extensions.FamManager;

namespace Pe.Revit.Tests;

/// <summary>
///     ruling-ff-coercion (2026-09-18): a mapping carries each value across data type, unit spec and storage type under its strategy, and
///     refuses only the value it cannot carry. Units cross through an explicit unit, never the project's display units, never raw across
///     dimensions. One case per Old_template class.
/// </summary>
[TestFixture]
public sealed class MappingStrategyCoercionTests {
    private Application _application = null!;

    [OneTimeSetUp]
    public void SetUp(UIApplication application) => this._application = application.Application;

    // Old_template: `Total Heating Capacity` (hvac:heatingLoad) → `PE_M___BoilerOutput` (hvac:power), 44 rows.
    [Test]
    public void Heating_load_into_hvac_power_converts_exactly() {
        var (from, to) = this.Carry(SpecTypeId.HeatingLoad, SpecTypeId.HvacPower, "CoerceByStorageType",
            (m, p) => m.Set(p, UnitUtils.ConvertToInternalUnits(12000, UnitTypeId.BritishThermalUnitsPerHour)),
            (m, p) => m.Set(p, UnitUtils.ConvertToInternalUnits(24000, UnitTypeId.BritishThermalUnitsPerHour)));
        Assert.That(from, Is.Empty, string.Join("; ", from));
        Assert.That(to.Select(v => UnitUtils.ConvertFromInternalUnits((double)v!, UnitTypeId.BritishThermalUnitsPerHour)),
            Is.EqualTo(new[] { 12000d, 24000d }).Within(1e-6));
    }

    // Old_template: `Phase` (numberOfPoles, Integer) → `PE_E___Phase` (Number), 20 rows.
    [Test]
    public void Number_of_poles_into_a_number_carries_the_count() {
        var (errors, values) = this.Carry(SpecTypeId.Int.NumberOfPoles, SpecTypeId.Number, "CoerceByStorageType",
            (m, p) => m.Set(p, 3), (m, p) => m.Set(p, 1));
        Assert.That(errors, Is.Empty, string.Join("; ", errors));
        Assert.That(values, Is.EqualTo(new object[] { 3d, 1d }));
    }

    // Old_template: `Phase` (Text, "Single") → `PE_E___Phase` (Number), 4 rows.
    [Test]
    public void Text_count_into_a_number_parses_number_words_and_digits() {
        var (errors, values) = this.Carry(SpecTypeId.String.Text, SpecTypeId.Number, "CoerceByStorageType",
            (m, p) => m.Set(p, "Single"), (m, p) => m.Set(p, "3 phase"));
        Assert.That(errors, Is.Empty, string.Join("; ", errors));
        Assert.That(values, Is.EqualTo(new object[] { 1d, 3d }));
    }

    // "require units for every number": text naming its unit parses; a bare number into a measurable spec is refused, that value only.
    [Test]
    public void Text_into_a_length_needs_its_own_unit_and_a_bare_number_is_refused_by_name_and_type() {
        var (errors, values) = this.Carry(SpecTypeId.String.Text, SpecTypeId.Length, "CoerceByStorageType",
            (m, p) => m.Set(p, "18 in"), (m, p) => m.Set(p, "18"));
        Assert.That(values[0], Is.EqualTo(1.5d).Within(1e-9));
        Assert.That(errors, Has.Count.EqualTo(1));
        Assert.That(errors[0], Does.Contain("cannot carry 'Source' value '18'").And.Contain("in type 'B' under CoerceByStorageType")
            .And.Contain("names no unit"));
    }

    // Never a raw internal copy across dimensions: Length (feet) into Area is refused per value, naming both specs.
    [Test]
    public void A_length_is_never_copied_raw_into_an_area() {
        var (errors, _) = this.Carry(SpecTypeId.Length, SpecTypeId.Area, "CoerceByStorageType", (m, p) => m.Set(p, 2d), (m, p) => m.Set(p, 3d));
        Assert.That(errors, Has.Count.EqualTo(2));
        Assert.That(errors[0], Does.Contain($"{SpecTypeId.Length.TypeId} and {SpecTypeId.Area.TypeId} share no unit"));
    }

    // CoerceElectrical reads a bare number in the strategy's explicit unit (volts), never the project's display unit for potential.
    [Test]
    public void Electrical_text_is_read_in_the_strategys_explicit_unit_whatever_the_project_displays() {
        var (errors, values) = this.Carry(SpecTypeId.String.Text, SpecTypeId.ElectricalPotential, "CoerceElectrical",
            (m, p) => m.Set(p, "208/230V"), (m, p) => m.Set(p, "115"),
            document => {
                var units = document.GetUnits();
                units.SetFormatOptions(SpecTypeId.ElectricalPotential, new FormatOptions(UnitTypeId.Kilovolts));
                document.SetUnits(units);
            });
        Assert.That(errors, Is.Empty, string.Join("; ", errors));
        Assert.That(values.Select(v => UnitUtils.ConvertFromInternalUnits((double)v!, UnitTypeId.Volts)), Is.EqualTo(new[] { 208d, 115d }).Within(1e-9));
    }

    /// <summary>Seeds Source (types A, B) and an empty Target, then carries A and B through FamilyFormulaCopy.Carry, the migration's own path.</summary>
    private (List<string> Refusals, List<object?> Values) Carry(ForgeTypeId sourceSpec, ForgeTypeId targetSpec, string strategy,
        Action<FamilyManager, FamilyParameter> a, Action<FamilyManager, FamilyParameter> b, Action<Document>? units = null) {
        var document = RevitFamilyFixtureHarness.CreateFamilyDocument(this._application, BuiltInCategory.OST_GenericModel, "FF coercion " + Guid.NewGuid().ToString("N")[..6]);
        try {
            using var transaction = new Transaction(document, "Carry");
            transaction.Start();
            units?.Invoke(document);
            var manager = document.FamilyManager;
            var source = manager.AddParameter("Source", GroupTypeId.General, sourceSpec, false);
            var target = manager.AddParameter("Target", GroupTypeId.General, targetSpec, false);
            foreach (var (name, seed) in new[] { ("A", a), ("B", b) }) {
                manager.CurrentType = manager.NewType(name);
                seed(manager, source);
            }
            var family = new FamilyDocument(document);
            var refusals = FamilyFormulaCopy.Carry(family, source, "Source", target, strategy, keep: true)
                .Where(r => r.Contains("in type 'A'") || r.Contains("in type 'B'")).ToList();
            var values = manager.Types.Cast<FamilyType>().Where(t => t.Name is "A" or "B").OrderBy(t => t.Name)
                .Select(t => family.GetValue(t, target)).ToList();
            transaction.RollBack();
            return (refusals, values);
        } finally { document.Close(false); }
    }
}
