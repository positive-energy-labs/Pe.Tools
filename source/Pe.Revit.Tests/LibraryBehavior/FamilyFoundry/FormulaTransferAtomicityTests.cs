using Pe.Revit.Extensions.FamDocument;
using Pe.Revit.Extensions.FamManager;
using Pe.Revit.Extensions.FamParameter;
using Pe.Revit.FamilyFoundry;
using Pe.Revit.FamilyFoundry.Reconcile;
using Pe.Shared.RevitData.Families;

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

    [Test]
    public void Refused_formula_copy_rolls_back_source_values_and_dimension_association() {
        var document = this.NewFamily("FF refused formula", "Target * 2", createTarget: true, labelSource: true);
        try {
            var manager = document.FamilyManager;
            var source = manager.FindParameter("Source");
            var target = manager.FindParameter("Target");
            var sourceId = source.Id;
            var dimensionId = source.AssociatedDimensions(new FamilyDocument(document)).Single().Id;
            var sourceValues = Values(manager, source);
            var targetValues = Values(manager, target);

            var (error, converged) = Reconcile(document);

            Assert.That(error?.ToString(), Does.Contain("Formula setting failed").Or.Contain("circular"));
            Assert.That(converged, Is.False);
            manager = document.FamilyManager;
            source = manager.FindParameter("Source");
            Assert.That(source, Is.Not.Null);
            Assert.That(source.Id, Is.EqualTo(sourceId));
            Assert.That(source.Formula, Is.EqualTo("Target * 2"));
            Assert.That(Values(manager, source), Is.EqualTo(sourceValues), "source values");
            Assert.That(Values(manager, manager.FindParameter("Target")), Is.EqualTo(targetValues), "destination values");
            var dimension = (Dimension)document.GetElement(dimensionId);
            Assert.That(dimension.FamilyLabel?.Id, Is.EqualTo(sourceId));
            Assert.That(manager.Parameters.Cast<FamilyParameter>().Any(p => p.Definition.Name.StartsWith("FF_Transfer_")), Is.False);
        } finally { document.Close(false); }
    }

    private Document NewFamily(string name, string? sourceFormula, bool createTarget, bool labelSource = false) {
        var document = RevitFamilyFixtureHarness.CreateFamilyDocument(this._application, BuiltInCategory.OST_GenericModel, name);
        using var transaction = new Transaction(document, "Seed formula transfer");
        transaction.Start();
        var manager = document.FamilyManager;
        var basis = manager.AddParameter("Base", GroupTypeId.Geometry, SpecTypeId.Length, false);
        var source = manager.AddParameter("Source", GroupTypeId.Geometry, SpecTypeId.Length, false);
        var target = createTarget ? manager.AddParameter("Target", GroupTypeId.Geometry, SpecTypeId.Length, false) : null;
        foreach (var (typeName, basisValue, targetValue) in new[] { ("A", 1d, 9d), ("B", 2d, 10d) }) {
            manager.CurrentType = manager.NewType(typeName);
            manager.Set(basis, basisValue);
            if (target is not null) manager.Set(target, targetValue);
            if (sourceFormula is null) manager.Set(source, basisValue + 4d);
        }
        if (sourceFormula is not null) manager.SetFormula(source, sourceFormula);
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

    private static (Exception? Error, bool Converged) Reconcile(Document document) {
        var operation = new ReconcileFamily(FamilyPatch.Parse("""{"patch":{"parameters":{"Target":{"dataType":"Length","wasNamed":["Source"]}}}}"""));
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
