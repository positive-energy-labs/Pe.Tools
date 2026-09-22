using System.Diagnostics;
using System.Globalization;
using Newtonsoft.Json;
using Pe.Revit.Extensions.FamDocument;

namespace Pe.Revit.Tests;

/// <summary>Revit observations, not an adopted optimization. Every method starts from the same saved family.</summary>
[TestFixture]
public sealed class ValueWriteExperimentTests {
    private static readonly ForgeTypeId[] Specs =
        [SpecTypeId.Length, SpecTypeId.Number, SpecTypeId.Int.Integer, SpecTypeId.HvacTemperature, SpecTypeId.String.Text];

    [Test]
    public void Compare_formula_clear_with_one_batched_type_pass(UIApplication ui) {
        var output = Environment.GetEnvironmentVariable("PE_FF_PROOF_OUTPUT")
            ?? throw new InvalidOperationException("PE_FF_PROOF_OUTPUT is required");
        Directory.CreateDirectory(output);
        var results = new List<object>();
        var failures = new List<string>();
        var initial = Path.Combine(output, "values-initial.rfa");
        var app = ui.Application;
        Document doc;
        if (Environment.GetEnvironmentVariable("PE_FF_PROOF_PROJECT") is { Length: > 0 } projectPath) {
            var project = app.OpenDocumentFile(projectPath);
            try {
                var family = new FilteredElementCollector(project).OfClass(typeof(Family)).Cast<Family>()
                    .Where(f => f.IsEditable && f.FamilyCategory?.Id.Value() == (long)BuiltInCategory.OST_MechanicalEquipment)
                    .OrderByDescending(f => f.GetFamilySymbolIds().Count).ThenBy(f => f.Name, StringComparer.Ordinal).First();
                doc = project.EditFamily(family);
                results.Add(new { method = "realFamily", family.Name, originalTypes = family.GetFamilySymbolIds().Count,
                    elements = new FilteredElementCollector(doc).GetElementCount(), parameters = doc.FamilyManager.Parameters.Size, projectPath });
            } finally { project.Close(false); }
        } else doc = app.NewFamilyDocument(RevitFamilyFixtureHarness.ResolveGenericModelTemplatePath(app));
        try {
            using var tx = new Transaction(doc, "Prepare value experiment");
            tx.Start();
            var fm = doc.FamilyManager;
            for (var p = 0; p < Specs.Length; p++) {
                fm.AddParameter("FFSource" + p, GroupTypeId.Data, Specs[p], false);
                fm.AddParameter("FFTarget" + p, GroupTypeId.Data, Specs[p], false);
            }
            for (var t = fm.Types.Size; t < 3; t++) fm.NewType("FFType" + t);
            var initialTypes = fm.Types.Cast<FamilyType>().OrderBy(t => t.Name, StringComparer.Ordinal).ToArray();
            for (var t = 0; t < initialTypes.Length; t++) {
                fm.CurrentType = initialTypes[t];
                for (var p = 0; p < Specs.Length; p++) Set(fm, fm.get_Parameter("FFSource" + p), Expected(p, t));
            }
            var guarded = fm.AddParameter("FFExistingFormula", GroupTypeId.Data, SpecTypeId.Number, false);
            fm.SetFormula(guarded, "FFSource1 * 2");
            Assert.That(tx.Commit(), Is.EqualTo(TransactionStatus.Committed));
            doc.SaveAs(initial, new SaveAsOptions { OverwriteExistingFile = true });
        } finally { doc.Close(false); }

        foreach (var (method, repetition) in Enumerable.Range(0, 3).SelectMany(repetition =>
                     (repetition % 2 == 0 ? new[] { "baseline", "source", "selector" } : new[] { "selector", "source", "baseline" })
                     .Select(method => (method, repetition)))) {
            doc = app.OpenDocumentFile(initial);
            var phases = new Dictionary<string, double>();
            try {
                var fm = doc.FamilyManager;
                var constraints = Constraints(doc);
                var associated = fm.Parameters.Cast<FamilyParameter>().Where(p => p.AssociatedParameters.Size > 0).ToArray();
                Assert.That(associated.All(p => !CanWrite(p)), Is.True, "associated targets must be refused");
                var types = fm.Types.Cast<FamilyType>().OrderBy(t => t.Name, StringComparer.Ordinal).ToArray();
                var originalType = fm.CurrentType.Name;
                var targets = Enumerable.Range(0, Specs.Length).Select(p => fm.get_Parameter("FFTarget" + p)).ToArray();
                Assert.That(targets.All(CanWrite), Is.True);
                Assert.That(CanWrite(fm.get_Parameter("FFExistingFormula")), Is.False, "existing formula must be refused");
                var total = Stopwatch.StartNew();
                using (var tx = new Transaction(doc, "Value experiment " + method)) {
                    tx.Start();
                    FamilyParameter? selector = null;
                    if (method == "selector") {
                        Measure(phases, "selectorCreation", () => selector = fm.AddParameter("FFSelector", GroupTypeId.Data, SpecTypeId.Int.Integer, false));
                        Measure(phases, "selectorPopulation", () => {
                            for (var t = 0; t < types.Length; t++) { fm.CurrentType = types[t]; fm.Set(selector!, t + 1); }
                        });
                    }
                    Measure(phases, "writeOrFormulaAndClear", () => {
                        if (method == "baseline") {
                            for (var t = 0; t < types.Length; t++) {
                                fm.CurrentType = types[t];
                                for (var p = 0; p < targets.Length; p++) Set(fm, targets[p], Expected(p, t));
                            }
                        } else {
                            for (var p = 0; p < targets.Length; p++) {
                                var formula = "FFSource" + p;
                                if (method == "selector") {
                                    formula = Literal(p, types.Length - 1);
                                    for (var t = types.Length - 2; t >= 0; t--)
                                        formula = $"if(FFSelector = {t + 1}, {Literal(p, t)}, {formula})";
                                }
                                fm.SetFormula(targets[p], formula);
                                fm.SetFormula(targets[p], null);
                            }
                        }
                    });
                    Measure(phases, "regeneration", doc.Regenerate);
                    Measure(phases, "cleanup", () => {
                        if (selector != null) fm.RemoveParameter(selector);
                        fm.CurrentType = types.Single(t => t.Name == originalType);
                    });
                    Measure(phases, "commit", () => Assert.That(tx.Commit(), Is.EqualTo(TransactionStatus.Committed)));
                }
                total.Stop();
                phases["total"] = total.Elapsed.TotalMilliseconds;
                var committed = Read(doc);
                var saved = Path.Combine(output, "values-" + method + ".rfa");
                doc.SaveAs(saved, new SaveAsOptions { OverwriteExistingFile = true });
                doc.Close(false);
                doc = app.OpenDocumentFile(saved);
                var reopened = Read(doc);
                var mismatches = reopened.Count(r => !r.Correct);
                var constraintsPreserved = constraints == Constraints(doc);
                results.Add(new { method, repetition, phases, typeCount = types.Length, targetCount = targets.Length,
                    switches = method == "source" ? 0 : types.Length, committed, reopened, mismatches,
                    associatedParametersRefused = associated.Length, constraintsPreserved,
                    selectorRemoved = doc.FamilyManager.get_Parameter("FFSelector") == null,
                    preservedFormula = doc.FamilyManager.get_Parameter("FFExistingFormula").Formula });
                if (mismatches != 0) failures.Add(method + " mismatches=" + mismatches);
                Assert.That(constraintsPreserved, Is.True, "existing formulas and associations changed");
                Assert.That(doc.FamilyManager.get_Parameter("FFSelector"), Is.Null);
                Assert.That(doc.FamilyManager.get_Parameter("FFExistingFormula").Formula, Is.EqualTo("FFSource1 * 2"));
            } catch (Exception ex) { failures.Add(method + ": " + ex.Message); results.Add(new { method, phases, error = ex.ToString() }); }
            finally { doc.Close(false); Write(output, results, failures); }
        }

        doc = app.OpenDocumentFile(initial);
        try {
            var fm = doc.FamilyManager;
            var initialType = fm.CurrentType.Name;
            var before = Read(doc);
            using (var tx = new Transaction(doc, "Injected failure")) {
                tx.Start();
                try {
                    var selector = fm.AddParameter("FFSelector", GroupTypeId.Data, SpecTypeId.Int.Integer, false);
                    fm.Set(selector, 1);
                    fm.SetFormula(fm.get_Parameter("FFTarget1"), "FFSource1");
                    throw new InvalidOperationException("injected after partial formula write");
                } catch (InvalidOperationException) { tx.RollBack(); }
            }
            fm = doc.FamilyManager; // Rollback invalidates the previously acquired FamilyManager wrapper.
            var after = Read(doc);
            var restored = JsonConvert.SerializeObject(before) == JsonConvert.SerializeObject(after)
                && fm.CurrentType.Name == initialType && fm.get_Parameter("FFSelector") == null;
            results.Add(new { method = "injectedFailureRollback", restored, before, after });
            Assert.That(restored, Is.True);

            using var probe = new Transaction(doc, "Unset zero and uniform helper");
            probe.Start();
            var observations = new List<object>();
            foreach (var p in new[] { 1, 2, 3 }) {
                var parameter = fm.AddParameter("FFNewBlank" + p, GroupTypeId.Data, Specs[p], false);
                var unset = fm.CurrentType.HasValue(parameter);
                var newRaw = Raw(fm.CurrentType, parameter);
                Set(fm, parameter, p == 2 ? (object)0 : 0.0);
                var zeroHasValue = fm.CurrentType.HasValue(parameter);
                fm.SetFormula(parameter, null);
                var afterClearHasValue = fm.CurrentType.HasValue(parameter);
                string? blankError = null;
                try { fm.SetValueString(parameter, ""); } catch (Exception ex) { blankError = ex.Message; }
                observations.Add(new { p, unsetHasValue = unset, newRaw, zeroHasValue,
                    afterClearHasValue, blankError, afterBlankHasValue = fm.CurrentType.HasValue(parameter), raw = Raw(fm.CurrentType, parameter) });
            }
            var temperature = fm.get_Parameter("FFTarget3");
            var uniform = new FamilyDocument(doc).TrySetUnsetFormula(temperature, 0.0, out var error);
            results.Add(new { method = "unsetAndZero", observations, uniformZeroKelvinAccepted = uniform,
                error, raw = Raw(fm.CurrentType, temperature), hasValue = fm.CurrentType.HasValue(temperature) });
            if (uniform) Assert.That(fm.CurrentType.AsDouble(temperature), Is.EqualTo(0.0).Within(1e-9));
            var uniformCases = new List<object>();
            for (var p = 0; p < Specs.Length; p++) {
                var target = fm.get_Parameter("FFTarget" + p);
                var accepted = new FamilyDocument(doc).TrySetUnsetFormula(target, Expected(p, 1), out var failure);
                var actual = Raw(fm.CurrentType, target);
                var expected = Expected(p, 1);
                var correct = expected is double number ? actual is double a && Math.Abs(a - number) <= 1e-9 : Equals(actual, expected);
                uniformCases.Add(new { p, accepted, failure, expected, actual, correct });
                if (accepted && !correct) failures.Add("uniform wrong value " + p);
            }
            results.Add(new { method = "uniformPrecision", uniformCases });
            probe.RollBack();
        } finally { doc.Close(false); Write(output, results, failures); }
        Assert.That(failures, Is.Empty, string.Join(Environment.NewLine, failures));
    }

    private static bool CanWrite(FamilyParameter p) => !p.IsReadOnly && string.IsNullOrEmpty(p.Formula) && p.AssociatedParameters.Size == 0;
    private static object Expected(int p, int t) => p switch {
        0 => UnitUtils.ConvertToInternalUnits(1234.56789 + t * 321.12345, UnitTypeId.Millimeters),
        1 => 1.23456789 + t * 2.34567891,
        2 => 7 + t * 3,
        3 => UnitUtils.ConvertToInternalUnits(t == 0 ? 0 : 273.15 + t * 12.34567, UnitTypeId.Kelvin),
        _ => "value " + t
    };
    private static string Literal(int p, int t) => p switch {
        0 => (1234.56789 + t * 321.12345).ToString("R", CultureInfo.InvariantCulture) + " mm",
        3 => (t == 0 ? 0 : 273.15 + t * 12.34567).ToString("R", CultureInfo.InvariantCulture) + " K",
        4 => "\"value " + t + "\"",
        _ => Convert.ToString(Expected(p, t), CultureInfo.InvariantCulture)!
    };
    private static void Set(FamilyManager fm, FamilyParameter p, object value) {
        if (value is int i) fm.Set(p, i);
        else if (value is double d) fm.Set(p, d);
        else fm.Set(p, (string)value);
    }
    private static object? Raw(FamilyType type, FamilyParameter p) => p.StorageType switch {
        StorageType.Double => type.AsDouble(p), StorageType.Integer => type.AsInteger(p), _ => type.AsString(p)
    };
    private static string Constraints(Document doc) => JsonConvert.SerializeObject(doc.FamilyManager.Parameters.Cast<FamilyParameter>()
        .OrderBy(p => p.Definition.Name, StringComparer.Ordinal).Select(p => new { Name = p.Definition.Name, p.Formula,
            Associations = p.AssociatedParameters.Cast<Parameter>().Select(a => $"{a.Element.Id.Value()}:{a.Id.Value()}").OrderBy(a => a).ToArray() }));
    private sealed record ValueRow(string Type, int Parameter, bool HasValue, object? Value, object Expected, double? AbsoluteError, string? Formula, bool Correct);
    private static ValueRow[] Read(Document doc) => doc.FamilyManager.Types.Cast<FamilyType>()
        .OrderBy(t => t.Name, StringComparer.Ordinal).SelectMany((type, t) => Enumerable.Range(0, Specs.Length).Select(p => {
            var parameter = doc.FamilyManager.get_Parameter("FFTarget" + p);
            var value = Raw(type, parameter);
            var expected = Expected(p, t);
            var equal = expected is double d ? value is double actual && Math.Abs(actual - d) <= 1e-9 : Equals(value, expected);
            return new ValueRow(type.Name, p, type.HasValue(parameter), value, expected,
                expected is double e && value is double v ? Math.Abs(e - v) : null,
                parameter.Formula, equal && type.HasValue(parameter) && string.IsNullOrEmpty(parameter.Formula));
        })).ToArray();
    private static void Measure(Dictionary<string, double> phases, string name, Action action) {
        var sw = Stopwatch.StartNew();
        try { action(); } finally { phases[name] = sw.Elapsed.TotalMilliseconds; }
    }
    private static void Write(string output, List<object> results, List<string> failures) =>
        File.WriteAllText(Path.Combine(output, "value-experiment.json"), JsonConvert.SerializeObject(new {
            pid = Environment.ProcessId, assembly = typeof(ValueWriteExperimentTests).Assembly.Location,
            results, failures }, Formatting.Indented));
}
