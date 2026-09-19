using Pe.Revit.Extensions.FamDocument;
using Pe.Revit.Extensions.FamManager;
using Pe.Revit.Extensions.FamParameter;
using Pe.Revit.FamilyFoundry;
using Pe.Revit.FamilyFoundry.Reconcile;
using Pe.Shared.RevitData.Families;
using Newtonsoft.Json.Linq;

namespace Pe.Revit.Tests;

[TestFixture]
public sealed class FormulaTransferAtomicityTests {
    private Application _application = null!;

    [OneTimeSetUp]
    public void SetUp(UIApplication application) => this._application = application.Application;

    [Test]
    public void Compatible_source_formula_transfers_through_public_reconciliation() {
        var document = this.NewFamily("FF compatible formula", "Base * 2", createTarget: true);
        try {
            var (error, converged) = Reconcile(document);

            Assert.That(error, Is.Null, error?.Message);
            Assert.That(converged, Is.True);
            var manager = document.FamilyManager;
            Assert.That(manager.FindParameter("Source"), Is.Null);
            var target = manager.FindParameter("Target");
            Assert.That(target.Formula, Is.EqualTo("Base * 2"));
            AssertValues(manager, target, 2d, 4d);
        } finally { document.Close(false); }
    }

    [Test]
    public void Existing_destination_values_win_when_source_has_no_formula() {
        var document = this.NewFamily("FF destination wins", null, createTarget: true);
        try {
            var (error, converged) = Reconcile(document);

            Assert.That(error, Is.Null, error?.Message);
            Assert.That(converged, Is.True);
            var manager = document.FamilyManager;
            Assert.That(manager.FindParameter("Source"), Is.Null);
            AssertValues(manager, manager.FindParameter("Target"), 9d, 10d);
        } finally { document.Close(false); }
    }

    // A transfer that half-writes (labels moved, then a dependent formula cannot be rewired) rolls back whole: nothing is lost silently.
    [Test]
    public void Half_written_transfer_rolls_back_source_values_and_dimension_association() {
        // Dependent (type) = `Source * 2` cannot be rewired to an instance destination: a type formula cannot read an instance parameter.
        var document = this.NewFamily("FF half-written transfer", null, createTarget: true, labelSource: true, dependent: true, targetInstance: true);
        try {
            var manager = document.FamilyManager;
            var source = manager.FindParameter("Source");
            var target = manager.FindParameter("Target");
            var sourceId = source.Id;
            var dimensionId = source.AssociatedDimensions(new FamilyDocument(document)).Single().Id;
            var sourceValues = Values(manager, source);
            var targetValues = Values(manager, target);

            var (error, converged) = Reconcile(document);

            Assert.That(error?.ToString(), Does.Contain("Failed to transfer formula on 'Dependent'"), error?.ToString());
            Assert.That(converged, Is.False);
            manager = document.FamilyManager;
            source = manager.FindParameter("Source");
            Assert.That(source, Is.Not.Null);
            Assert.That(source.Id, Is.EqualTo(sourceId));
            Assert.That(Values(manager, source), Is.EqualTo(sourceValues), "source values");
            Assert.That(Values(manager, manager.FindParameter("Target")), Is.EqualTo(targetValues), "destination values");
            Assert.That(manager.FindParameter("Dependent").Formula, Is.EqualTo("Source * 2"));
            var dimension = (Dimension)document.GetElement(dimensionId);
            Assert.That(dimension.FamilyLabel?.Id, Is.EqualTo(sourceId));
            Assert.That(manager.Parameters.Cast<FamilyParameter>().Any(p => p.Definition.Name.StartsWith("FF_Transfer_")), Is.False);
        } finally { document.Close(false); }
    }

    // ruling-ff-coercion (2026-09-18): coerce, don't refuse. A formula that cannot cross is dropped with a named note (R1: never across
    // data types), and each type's value is carried by the mapping's declared strategy, any strategy. Old_template: Phase `"Single"` (Text).
    [Test]
    public void Text_formula_into_a_number_is_dropped_with_a_note_and_its_values_carried() {
        var document = this.NewFamily("FF formula text to number", "\"Single\"", createTarget: true,
            sourceSpec: SpecTypeId.String.Text, targetSpec: SpecTypeId.Number);
        try {
            var note = $"formula `\"Single\"` on 'Source' not copied to 'Target' ({SpecTypeId.String.Text.TypeId} → {SpecTypeId.Number.TypeId}: " +
                       "a formula is not copied across data types); per-type values carried by CoerceByStorageType";
            var (error, converged, preview, receipt) = ReconcileWithPreview(document, "Number", null);
            Assert.That(error, Is.Null, error?.Message);
            Assert.That(converged, Is.True);
            AssertNamed(note, preview, receipt);
            var manager = document.FamilyManager;
            Assert.That(manager.FindParameter("Source"), Is.Null);
            var target = manager.FindParameter("Target")!;
            Assert.That(target.Formula, Is.Null.Or.Empty);
            AssertValues(manager, target, 1d, 1d);
        } finally { document.Close(false); }
    }

    // ruling-ff-coercion #3: the declaration wins. Revit refuses a type formula reading an instance parameter (GROUNDING-REVIT.md #4), so the
    // formula is dropped with a note and each family type's value of the instance source is carried. Placed-instance inputs are not read.
    [Test]
    public void Instance_formula_onto_a_type_destination_is_dropped_with_a_note_and_its_values_carried() {
        var document = this.NewFamily("FF formula scope", "Inst * 2", createTarget: true, sourceInstance: true);
        try {
            var note = "formula `Inst * 2` on 'Source' not copied to 'Target' (a type parameter cannot read instance parameter 'Inst'); " +
                       "per-type values carried by CoerceByStorageType";
            var (error, converged, preview, receipt) = ReconcileWithPreview(document, "Length", null);
            Assert.That(error, Is.Null, error?.Message);
            Assert.That(converged, Is.True);
            AssertNamed(note, preview, receipt);
            var manager = document.FamilyManager;
            Assert.That(manager.FindParameter("Source"), Is.Null);
            var target = manager.FindParameter("Target")!;
            Assert.That(target.Formula, Is.Null.Or.Empty);
            Assert.That(target.IsInstance, Is.False);
            AssertValues(manager, target, 4d, 6d); // Inst is 2 ft in A, 3 ft in B
        } finally { document.Close(false); }
    }

    // ruling-ff-coercion: an existing destination of another data type is no longer refused ("incompatible destination datatype"). It steps
    // aside as the first-ranked source, and its values cross under the mapping's strategy.
    [Test]
    public void Existing_destination_of_another_data_type_is_retyped_and_its_values_carried() {
        var document = RevitFamilyFixtureHarness.CreateFamilyDocument(this._application, BuiltInCategory.OST_GenericModel, "FF retype destination");
        try {
            using (var transaction = new Transaction(document, "Seed retype")) {
                transaction.Start();
                var manager = document.FamilyManager;
                var seeded = manager.AddParameter("Target", GroupTypeId.General, SpecTypeId.String.Text, false);
                manager.AddParameter("Source", GroupTypeId.General, SpecTypeId.String.Text, false);
                foreach (var (typeName, text) in new[] { ("A", "2"), ("B", "3") }) {
                    manager.CurrentType = manager.NewType(typeName);
                    manager.Set(seeded, text);
                }
                Assert.That(transaction.Commit(), Is.EqualTo(TransactionStatus.Committed));
            }
            var (error, converged, _, _) = ReconcileWithPreview(document, "Number", null);
            Assert.That(error, Is.Null, error?.ToString());
            Assert.That(converged, Is.True);
            var fm = document.FamilyManager;
            Assert.That(fm.FindParameter("Source"), Is.Null);
            var target = fm.FindParameter("Target")!;
            Assert.That(target.Definition.GetDataType(), Is.EqualTo(SpecTypeId.Number));
            AssertValues(fm, target, 2d, 3d);
            Assert.That(fm.Parameters.Cast<FamilyParameter>().Any(p => p.Definition.Name.StartsWith("FF_")), Is.False);
        } finally { document.Close(false); }
    }

    [Test]
    public void Exact_alias_of_the_destination_transfers_without_copying_its_formula() {
        // Source = `Target`: it reads the destination in every type, so skipping the circular copy is lossless. Its dependent is rewired.
        var document = this.NewFamily("FF formula exact alias", "Target", createTarget: true, dependent: true);
        try {
            var manager = document.FamilyManager;
            AssertValues(manager, manager.FindParameter("Source")!, 9d, 10d);
            AssertValues(manager, manager.FindParameter("Dependent")!, 18d, 20d);

            var (error, converged) = Reconcile(document);

            Assert.That(error, Is.Null, error?.Message);
            Assert.That(converged, Is.True);
            manager = document.FamilyManager;
            Assert.That(manager.FindParameter("Source"), Is.Null);
            var target = manager.FindParameter("Target")!;
            Assert.That(target.Formula, Is.Null.Or.Empty, "the destination keeps its own values, not a circular formula");
            AssertValues(manager, target, 9d, 10d);
            var dependent = manager.FindParameter("Dependent")!;
            Assert.That(dependent.Formula, Is.EqualTo("Target * 2"));
            AssertValues(manager, dependent, 18d, 20d);
            Assert.That(manager.Parameters.Cast<FamilyParameter>().Any(p => p.Definition.Name.StartsWith("FF_Transfer_")), Is.False);
        } finally { document.Close(false); }
    }

    // User ruling R2 (2026-09-18): the mapping's coercion strategy is the door across a data-type change. The formula is not copied; each
    // type's evaluated value is carried, and preview, receipt and log all name it.
    [Test]
    public void Voltage_text_formula_is_evaluated_and_coerced_by_CoerceElectrical() {
        var document = this.NewFamily("FF formula voltage", "\"208/230V\"", createTarget: true,
            sourceSpec: SpecTypeId.String.Text, targetSpec: SpecTypeId.ElectricalPotential);
        try {
            var note = $"formula `\"208/230V\"` on 'Source' not copied to 'Target' ({SpecTypeId.String.Text.TypeId} → {SpecTypeId.ElectricalPotential.TypeId}: " +
                       "a formula is not copied across data types); per-type values carried by CoerceElectrical";
            var (error, converged, preview, receipt) = ReconcileWithPreview(document, "ElectricalPotential", "CoerceElectrical");
            Assert.That(error, Is.Null, error?.Message);
            Assert.That(converged, Is.True);
            AssertNamed(note, preview, receipt);
            var manager = document.FamilyManager;
            Assert.That(manager.FindParameter("Source"), Is.Null);
            var target = manager.FindParameter("Target")!;
            Assert.That(target.Formula, Is.Null.Or.Empty);
            foreach (var type in manager.Types.Cast<FamilyType>().Where(type => type.Name is "A" or "B"))
                Assert.That(UnitUtils.ConvertFromInternalUnits(type.AsDouble(target)!.Value, UnitTypeId.Volts), Is.EqualTo(208d).Within(1e-9), type.Name);
        } finally { document.Close(false); }
    }

    // ruling-ff-coercion: refuse only a value the declared strategy cannot carry, by name and type. Preview refuses it, and apply refuses
    // with the same diagnostic before any effect.
    [Test]
    public void Voltage_text_the_strategy_cannot_read_refuses_at_preview_naming_value_and_type() {
        var document = this.NewFamily("FF formula voltage unreadable", "\"N/A\"", createTarget: true,
            sourceSpec: SpecTypeId.String.Text, targetSpec: SpecTypeId.ElectricalPotential);
        try {
            var before = Snapshot(document);
            var patch = Patch("ElectricalPotential", "CoerceElectrical", "Source");
            var preview = document.PreviewFamily(patch);
            var refusals = preview.Diagnostics.Where(d => d.Code == FamilyModelDiagnosticCodes.ValueNotCoercible).ToList();
            foreach (var type in new[] { "A", "B" })
                Assert.That(refusals.Select(d => d.Message), Has.Some.Contains($"cannot carry 'Source' value 'N/A' ({SpecTypeId.String.Text.TypeId}, type) " +
                    $"into 'Target' ({SpecTypeId.ElectricalPotential.TypeId}, type) in type '{type}' under CoerceElectrical"));
            var operation = new ReconcileFamily(patch);
            Exception? error;
            using (var processor = new OperationProcessor(document)) {
                var (contexts, _) = processor.ProcessQueue(new OperationQueue().Add(operation));
                (_, error) = contexts.Single().OperationLogs;
            }
            Assert.That(error, Is.Not.Null);
            foreach (var diagnostic in preview.Diagnostics)
                Assert.That(error!.ToString(), Does.Contain($"{diagnostic.Code}: {diagnostic.Message}"), error.ToString());
            Assert.That(operation.LastReceipt, Is.Null);
            Assert.That(Snapshot(document), Is.EqualTo(before), "a refused transfer changes nothing");
        } finally { document.Close(false); }
    }

    [Test]
    public void Force_formula_into_a_number_is_evaluated_per_type_by_CoerceMeasurableToNumber() {
        var document = this.NewFamily("FF formula weight", "if(Base > 1', 20 lbf, 10 lbf)", createTarget: true,
            sourceSpec: SpecTypeId.Force, targetSpec: SpecTypeId.Number);
        try {
            // Revit keeps the formula in project units (hold #3 read `20 lbf` back as `0.02 kip`); the note names it as Revit holds it.
            var held = document.FamilyManager.get_Parameter("Source")!.Formula;
            var note = $"formula `{held}` on 'Source' not copied to 'Target' ({SpecTypeId.Force.TypeId} → {SpecTypeId.Number.TypeId}: " +
                       "a formula is not copied across data types); per-type values carried by CoerceMeasurableToNumber";
            var (error, converged, preview, receipt) = ReconcileWithPreview(document, "Number", "CoerceMeasurableToNumber");
            Assert.That(error, Is.Null, error?.Message);
            Assert.That(converged, Is.True);
            AssertNamed(note, preview, receipt);
            var manager = document.FamilyManager;
            Assert.That(manager.FindParameter("Source"), Is.Null);
            var target = manager.FindParameter("Target")!;
            Assert.That(target.Formula, Is.Null.Or.Empty);
            AssertValues(manager, target, 10d, 20d); // lbf evaluated per type: Base is 1 ft in A, 2 ft in B
        } finally { document.Close(false); }
    }

    // User ruling R3 (2026-09-18): Source reads the destination through exact aliases (Old_template: `Mech Equip Model Number = Model` with
    // `Model = PE_G___Model`, 86 of 136 refusals), so the circular copy is skipped, not refused. Revit refuses a text formula naming the
    // built-in `Model` in a fresh Generic Model family (hold #3), so the chain here runs through a plain alias parameter `Via = Target`.
    [Test]
    public void Source_aliasing_the_destination_through_an_alias_chain_transfers_losslessly() {
        var document = this.NewFamily("FF formula alias chain", "Via", createTarget: true,
            sourceSpec: SpecTypeId.String.Text, targetSpec: SpecTypeId.String.Text, via: true);
        try {
            var patch = Patch("Text", null, "Source");
            var operation = new ReconcileFamily(patch);
            Exception? error;
            using (var processor = new OperationProcessor(document)) {
                var (contexts, _) = processor.ProcessQueue(new OperationQueue().Add(operation));
                (_, error) = contexts.Single().OperationLogs;
            }
            Assert.That(error, Is.Null, error?.Message);
            Assert.That(operation.LastReceipt?.Converged, Is.True);
            var manager = document.FamilyManager;
            Assert.That(manager.FindParameter("Source"), Is.Null);
            var target = manager.FindParameter("Target")!;
            Assert.That(target.Formula, Is.Null.Or.Empty, "the destination keeps its own values, not a circular formula");
            foreach (var type in manager.Types.Cast<FamilyType>().Where(type => type.Name is "A" or "B"))
                Assert.That(type.AsString(target), Is.EqualTo($"T-{type.Name}"));
            Assert.That(manager.get_Parameter("Via")?.Formula, Is.EqualTo("Target"), "the alias in the chain still reads the destination");
        } finally { document.Close(false); }
    }

    private static void AssertNamed(string note, FamilyPreview preview, FamilyReceipt? receipt) {
        Assert.That(preview.Diagnostics, Is.Empty);
        Assert.That(preview.RunEffects, Has.Member(note), "preview names the evaluated coercion");
        Assert.That(receipt?.RunEffects, Has.Member(note), "the receipt names it");
        Assert.That(receipt?.Outcomes.Select(o => o.Message ?? ""), Has.Some.Contains(note), "the source log names it");
    }

    private static FamilyPatch Patch(string dataType, string? strategy, params string[] wasNamed) {
        var target = new JObject { ["dataType"] = dataType, ["wasNamed"] = new JArray(wasNamed.Cast<object>().ToArray()) };
        if (strategy is not null) target["mappingStrategy"] = strategy;
        return new FamilyPatch { Patch = new JObject { ["parameters"] = new JObject { ["Target"] = target } } };
    }

    private static (Exception? Error, bool Converged, FamilyPreview Preview, FamilyReceipt? Receipt) ReconcileWithPreview(
        Document document, string dataType, string? strategy) {
        var patch = Patch(dataType, strategy, "Source");
        var preview = document.PreviewFamily(patch);
        var operation = new ReconcileFamily(patch, expectedPlanHash: preview.PlanHash);
        using var processor = new OperationProcessor(document);
        var (contexts, _) = processor.ProcessQueue(new OperationQueue().Add(operation));
        var (_, error) = contexts.Single().OperationLogs;
        return (error, operation.LastReceipt?.Converged == true, preview, operation.LastReceipt);
    }

    // Everything the refusal must leave alone: parameter names, formulas and per-type values.
    private static string Snapshot(Document document) {
        var manager = document.FamilyManager;
        return string.Join(" ; ", manager.Parameters.Cast<FamilyParameter>().Where(p => p.Id.Value() > 0).OrderBy(p => p.Definition.Name, StringComparer.Ordinal)
            .Select(p => $"{p.Definition.Name}|{p.Formula}|{string.Join(",", manager.Types.Cast<FamilyType>().OrderBy(t => t.Name, StringComparer.Ordinal).Select(t => t.AsValueString(p)))}"));
    }

    private Document NewFamily(string name, string? sourceFormula, bool createTarget, bool labelSource = false,
        ForgeTypeId? targetSpec = null, bool sourceInstance = false, bool dependent = false, ForgeTypeId? sourceSpec = null, bool via = false,
        bool targetInstance = false) {
        var document = RevitFamilyFixtureHarness.CreateFamilyDocument(this._application, BuiltInCategory.OST_GenericModel, name);
        using var transaction = new Transaction(document, "Seed formula transfer");
        transaction.Start();
        var manager = document.FamilyManager;
        var basis = manager.AddParameter("Base", GroupTypeId.Geometry, SpecTypeId.Length, false);
        var inst = sourceInstance ? manager.AddParameter("Inst", GroupTypeId.Geometry, SpecTypeId.Length, true) : null;
        var source = manager.AddParameter("Source", GroupTypeId.Geometry, sourceSpec ?? SpecTypeId.Length, sourceInstance);
        var target = createTarget ? manager.AddParameter("Target", GroupTypeId.Geometry, targetSpec ?? SpecTypeId.Length, targetInstance) : null;
        foreach (var (typeName, basisValue, targetValue) in new[] { ("A", 1d, 9d), ("B", 2d, 10d) }) {
            manager.CurrentType = manager.NewType(typeName);
            manager.Set(basis, basisValue);
            if (inst is not null) manager.Set(inst, basisValue + 1d);
            if (target?.StorageType == StorageType.String) manager.Set(target, $"T-{typeName}");
            else if (target is not null) manager.Set(target, targetValue);
            if (sourceFormula is null) manager.Set(source, basisValue + 4d);
        }
        if (via) manager.SetFormula(manager.AddParameter("Via", GroupTypeId.Geometry, sourceSpec ?? SpecTypeId.Length, false), "Target");
        if (sourceFormula is not null) manager.SetFormula(source, sourceFormula);
        if (dependent) manager.SetFormula(manager.AddParameter("Dependent", GroupTypeId.Geometry, SpecTypeId.Length, false), "Source * 2");
        if (labelSource) LabelDimension(document, source);
        Assert.That(transaction.Commit(), Is.EqualTo(TransactionStatus.Committed));
        return document;
    }

    private static void LabelDimension(Document document, FamilyParameter source) {
        var view = new FilteredElementCollector(document).OfClass(typeof(ViewPlan)).Cast<ViewPlan>().First(v => !v.IsTemplate);
        var sketch = SketchPlane.Create(document, Plane.CreateByNormalAndOrigin(XYZ.BasisZ, XYZ.Zero));
        var first = document.FamilyCreate.NewModelCurve(Line.CreateBound(new XYZ(0, -2, 0), new XYZ(0, 2, 0)), sketch);
        var second = document.FamilyCreate.NewModelCurve(Line.CreateBound(new XYZ(4, -2, 0), new XYZ(4, 2, 0)), sketch);
        var references = new ReferenceArray();
        references.Append(first.GeometryCurve.Reference);
        references.Append(second.GeometryCurve.Reference);
        document.FamilyCreate.NewLinearDimension(view, Line.CreateBound(new XYZ(0, -1, 0), new XYZ(4, -1, 0)), references).FamilyLabel = source;
    }

    private static (Exception? Error, bool Converged) Reconcile(Document document, string dataType = "Length") {
        var operation = new ReconcileFamily(FamilyPatch.Parse("""{"patch":{"parameters":{"Target":{"dataType":"DATATYPE","wasNamed":["Source"]}}}}""".Replace("DATATYPE", dataType)));
        using var processor = new OperationProcessor(document);
        var (contexts, _) = processor.ProcessQueue(new OperationQueue().Add(operation));
        var (_, error) = contexts.Single().OperationLogs;
        return (error, operation.LastReceipt?.Converged == true);
    }

    private static void AssertValues(FamilyManager manager, FamilyParameter parameter, double a, double b) {
        foreach (var (name, expected) in new[] { ("A", a), ("B", b) })
            Assert.That(manager.Types.Cast<FamilyType>().Single(type => type.Name == name).AsDouble(parameter), Is.EqualTo(expected), name);
    }

    private static IReadOnlyDictionary<string, double?> Values(FamilyManager manager, FamilyParameter parameter) =>
        manager.Types.Cast<FamilyType>().Where(type => type.Name is "A" or "B")
            .ToDictionary(type => type.Name, type => type.AsDouble(parameter), StringComparer.Ordinal);
}
