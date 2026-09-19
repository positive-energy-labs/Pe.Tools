using Newtonsoft.Json;
using Newtonsoft.Json.Linq;
using Pe.Revit.Extensions.FamDocument;
using Pe.Revit.Extensions.FamManager;
using Pe.Revit.FamilyFoundry;
using Pe.Revit.FamilyFoundry.Reconcile;
using Pe.Revit.Global.Services.Aps;
using Pe.Shared.RevitData.Families;

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
        var (from, to, _) = this.Carry(SpecTypeId.HeatingLoad, SpecTypeId.HvacPower, "CoerceByStorageType",
            (m, p) => m.Set(p, UnitUtils.ConvertToInternalUnits(12000, UnitTypeId.BritishThermalUnitsPerHour)),
            (m, p) => m.Set(p, UnitUtils.ConvertToInternalUnits(24000, UnitTypeId.BritishThermalUnitsPerHour)));
        Assert.That(from, Is.Empty, string.Join("; ", from));
        Assert.That(to.Select(v => UnitUtils.ConvertFromInternalUnits((double)v!, UnitTypeId.BritishThermalUnitsPerHour)),
            Is.EqualTo(new[] { 12000d, 24000d }).Within(1e-6));
    }

    // Old_template: `Phase` (numberOfPoles, Integer) → `PE_E___Phase` (Number), 20 rows.
    [Test]
    public void Number_of_poles_into_a_number_carries_the_count() {
        var (errors, values, _) = this.Carry(SpecTypeId.Int.NumberOfPoles, SpecTypeId.Number, "CoerceByStorageType",
            (m, p) => m.Set(p, 3), (m, p) => m.Set(p, 1));
        Assert.That(errors, Is.Empty, string.Join("; ", errors));
        Assert.That(values, Is.EqualTo(new object[] { 3d, 1d }));
    }

    // Old_template: `Phase` (Text, "Single") → `PE_E___Phase` (Number), 4 rows.
    [Test]
    public void Text_count_into_a_number_parses_number_words_and_digits() {
        var (errors, values, _) = this.Carry(SpecTypeId.String.Text, SpecTypeId.Number, "CoerceByStorageType",
            (m, p) => m.Set(p, "Single"), (m, p) => m.Set(p, "3 phase"));
        Assert.That(errors, Is.Empty, string.Join("; ", errors));
        Assert.That(values, Is.EqualTo(new object[] { 1d, 3d }));
    }

    // "require units for every number": text naming its unit parses. A bare number with no declared mappingUnit is never guessed and never
    // refused (ruling 2026-09-19): that value is reported by name with the declaration that would carry it.
    [Test]
    public void Text_into_a_length_needs_its_own_unit_and_a_bare_number_is_reported_by_name_and_type() {
        var (errors, values, reports) = this.Carry(SpecTypeId.String.Text, SpecTypeId.Length, "CoerceByStorageType",
            (m, p) => m.Set(p, "18 in"), (m, p) => m.Set(p, "18"));
        Assert.That(values[0], Is.EqualTo(1.5d).Within(1e-9));
        Assert.That(errors, Is.Empty, string.Join("; ", errors));
        Assert.That(reports, Has.Count.EqualTo(1));
        Assert.That(reports[0], Does.Contain("did not carry 'Source' value '18'").And.Contain("in type 'B' under CoerceByStorageType")
            .And.Contain("names no unit").And.Contain("declare mappingUnit on 'Target' (a unit of length, e.g. \"in\")"));
    }

    // Old_template's class, ruling 2026-09-19: a bare Number into PE_M___BoilerOutput (hvac:power) crosses through the declared unit, exactly.
    [Test]
    public void A_bare_number_into_hvac_power_converts_exactly_through_its_declared_mapping_unit() {
        var (error, _, receipt, btuh, source) = this.MigrateBoilerOutput("Btu/h").Single();
        Assert.That(error, Is.Null, error?.ToString());
        Assert.That(receipt?.Converged, Is.True);
        Assert.That(source, Is.Null, "a carried source is removed");
        Assert.That(btuh, Is.EqualTo(new double?[] { 12000d, 24000d }).Within(1e-6));
    }

    // With no mappingUnit the value is not guessed and the family is not refused: it migrates, and preview and receipt name each value, its
    // type, and the exact declaration that would carry it. Its source stays with its values, so nothing the person never saw is lost.
    [Test]
    public void A_bare_number_into_hvac_power_without_a_mapping_unit_is_reported_by_name_its_source_kept_and_the_family_still_migrates() {
        var (error, preview, receipt, btuh, source) = this.MigrateBoilerOutput(null).Single();
        Assert.That(error, Is.Null, error?.ToString());
        Assert.That(receipt?.Converged, Is.True);
        Assert.That(btuh, Is.All.Null, "a value is never guessed");
        Assert.That(source, Is.EqualTo(new double?[] { 12000d, 24000d }), "the source keeps its values");
        foreach (var (type, value) in new[] { ("A", "12000"), ("B", "24000") }) {
            var named = Has.Some.Contains($"did not carry 'Boiler Output' value '{value}'")
                .And.Contain($"into 'PE_M___BoilerOutput' ({SpecTypeId.HvacPower.TypeId}, type) in type '{type}' under CoerceByStorageType")
                .And.Contain("declare mappingUnit on 'PE_M___BoilerOutput' (a unit of power, e.g. \"Btu/h\"); source 'Boiler Output' kept so its values are not lost");
            Assert.That(preview.RunEffects, named, "preview names it before any effect");
            Assert.That(receipt!.RunEffects, named, "the receipt names it");
        }
    }

    // Never a raw internal copy across dimensions: Length (feet) into Area is refused per value, naming both specs.
    [Test]
    public void A_length_is_never_copied_raw_into_an_area() {
        var (errors, _, _) = this.Carry(SpecTypeId.Length, SpecTypeId.Area, "CoerceByStorageType", (m, p) => m.Set(p, 2d), (m, p) => m.Set(p, 3d));
        Assert.That(errors, Has.Count.EqualTo(2));
        Assert.That(errors[0], Does.Contain($"{SpecTypeId.Length.TypeId} and {SpecTypeId.Area.TypeId} share no unit"));
    }

    // CoerceElectrical reads a bare number in the strategy's explicit unit (volts), never the project's display unit for potential.
    [Test]
    public void Electrical_text_is_read_in_the_strategys_explicit_unit_whatever_the_project_displays() {
        var (errors, values, _) = this.Carry(SpecTypeId.String.Text, SpecTypeId.ElectricalPotential, "CoerceElectrical",
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
    private (List<string> Refusals, List<object?> Values, List<string> Reports) Carry(ForgeTypeId sourceSpec, ForgeTypeId targetSpec, string strategy,
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
            var (carried, reported) = FamilyFormulaCopy.Carry(family, source, "Source", target, strategy, keep: true);
            bool Seeded(string line) => line.Contains("in type 'A'") || line.Contains("in type 'B'");
            var refusals = carried.Where(Seeded).ToList();
            var reports = reported.Where(Seeded).ToList();
            var values = manager.Types.Cast<FamilyType>().Where(t => t.Name is "A" or "B").OrderBy(t => t.Name)
                .Select(t => family.GetValue(t, target)).ToList();
            transaction.RollBack();
            return (refusals, values, reports);
        } finally { document.Close(false); }
    }

    // The fix the report names: the same family re-run with mappingUnit declared carries the values the kept source still holds, then removes it.
    [Test]
    public void A_source_kept_for_want_of_a_unit_is_carried_and_removed_when_the_rerun_declares_one() {
        var runs = this.MigrateBoilerOutput(null, "Btu/h");
        Assert.That(runs[0].Error, Is.Null, runs[0].Error?.ToString());
        Assert.That(runs[0].Source, Is.EqualTo(new double?[] { 12000d, 24000d }), "run 1 keeps the source");
        var (error, _, receipt, btuh, source) = runs[1];
        Assert.That(error, Is.Null, error?.ToString());
        Assert.That(receipt?.Converged, Is.True);
        Assert.That(btuh, Is.EqualTo(new double?[] { 12000d, 24000d }).Within(1e-6), "run 2 carries exactly through Btu/h");
        Assert.That(source, Is.Null, "run 2 removes the carried source");
        Assert.That(receipt!.RunEffects, Has.None.Contains("kept so its values are not lost").And.None.Contains("did not carry"));
    }

    /// <summary>
    ///     Seeds `Boiler Output` (Number: 12000 in type A, 24000 in B), then reconciles the same family once per entry of
    ///     <paramref name="units" />: a patch mapping it into the company's shared PE_M___BoilerOutput (hvac:power), declaring that unit or none.
    ///     Per run: each type's destination value in Btu/h (null when unset) and the source's values (null when it was removed).
    /// </summary>
    private List<(Exception? Error, FamilyPreview Preview, FamilyReceipt? Receipt, List<double?> Btuh, List<double?>? Source)> MigrateBoilerOutput(
        params string?[] units) {
        var definitions = JsonConvert.DeserializeObject<List<ParametersApi.Parameters.ParametersResult>>(File.ReadAllText(
            RevitFamilyFixtureHarness.GetProfileFixturePath("normalization-company-definitions.json")))!.Where(d => d.Name == "PE_M___BoilerOutput").ToList();
        Assert.That(definitions, Has.Count.EqualTo(1));
        var document = RevitFamilyFixtureHarness.CreateFamilyDocument(this._application, BuiltInCategory.OST_MechanicalEquipment, "FF mapping unit " + Guid.NewGuid().ToString("N")[..6]);
        try {
            using (var transaction = new Transaction(document, "Seed Boiler Output")) {
                transaction.Start();
                var manager = document.FamilyManager;
                var source = manager.AddParameter("Boiler Output", GroupTypeId.General, SpecTypeId.Number, false);
                foreach (var (name, value) in new[] { ("A", 12000d), ("B", 24000d) }) {
                    manager.CurrentType = manager.NewType(name);
                    manager.Set(source, value);
                }
                Assert.That(transaction.Commit(), Is.EqualTo(TransactionStatus.Committed));
            }
            var runs = new List<(Exception?, FamilyPreview, FamilyReceipt?, List<double?>, List<double?>?)>();
            foreach (var unit in units) {
                var target = new JObject {
                    ["shared"] = true, ["sharedGuid"] = definitions[0].DownloadOptions.GetGuid().ToString(), ["sharedSpecId"] = SpecTypeId.HvacPower.TypeId,
                    ["wasNamed"] = new JArray("Boiler Output")
                };
                if (unit is not null) target["mappingUnit"] = unit;
                var patch = new FamilyPatch { Patch = new JObject { ["parameters"] = new JObject { ["PE_M___BoilerOutput"] = target } } };
                var preview = document.PreviewFamily(patch, sharedSource: d => new FamilySharedParameterSource(d, definitions));
                Assert.That(preview.Diagnostics, Is.Empty, string.Join("; ", preview.Diagnostics.Select(d => d.Message)));
                var operation = new ReconcileFamily(patch, sharedSource: d => new FamilySharedParameterSource(d, definitions));
                Exception? error;
                using (var processor = new OperationProcessor(document)) {
                    var (contexts, _) = processor.ProcessQueue(new OperationQueue().Add(operation));
                    (_, error) = contexts.Single().OperationLogs;
                }
                var fm = document.FamilyManager;
                var output = fm.get_Parameter("PE_M___BoilerOutput");
                var btuh = fm.Types.Cast<FamilyType>().Where(t => t.Name is "A" or "B").OrderBy(t => t.Name)
                    .Select(t => output is not null && t.HasValue(output) && t.AsDouble(output) is { } v && v != 0
                        ? UnitUtils.ConvertFromInternalUnits(v, UnitTypeId.BritishThermalUnitsPerHour) : (double?)null).ToList();
                var kept = fm.get_Parameter("Boiler Output");
                var sourceValues = kept is null ? null : fm.Types.Cast<FamilyType>().Where(t => t.Name is "A" or "B").OrderBy(t => t.Name).Select(t => t.AsDouble(kept)).ToList();
                runs.Add((error, preview, operation.LastReceipt, btuh, sourceValues));
            }
            return runs;
        } finally { document.Close(false); }
    }
}
