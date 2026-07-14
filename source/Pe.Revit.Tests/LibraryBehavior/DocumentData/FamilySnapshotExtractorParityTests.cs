using Pe.Revit.DocumentData.Families.Extraction;
using Pe.Revit.Extensions.FamDocument;
using Pe.Revit.Tasks;
using Pe.Shared.RevitData;

namespace Pe.Revit.Tests;

/// <summary>
///     Parity proof for the FamilyType.As* extraction path: values must match, cell for cell, what the
///     old FamilyManager.CurrentType loop produced (both funnel through GetValueString, so divergence
///     here means the FamilyType overload behaves differently from the CurrentType one).
/// </summary>
[TestFixture]
public sealed class FamilySnapshotExtractorParityTests {
    private Application _dbApplication = null!;

    [OneTimeSetUp]
    public void SetUp(UIApplication uiApplication) =>
        this._dbApplication = uiApplication?.Application
                              ?? throw new InvalidOperationException(
                                  "ricaun.RevitTest did not provide a UIApplication.");

    [Test]
    public void Extractor_matches_currenttype_ground_truth_cell_by_cell() {
        var familyDocument = RevitFamilyFixtureHarness.CreateFamilyDocument(
            this._dbApplication,
            BuiltInCategory.OST_GenericModel,
            "Snapshot Parity Generic Model");
        try {
            var fm = familyDocument.FamilyManager;
            using (var transaction = new Transaction(familyDocument, "Build parity fixture")) {
                _ = transaction.Start();
                var typeA = RevitFamilyFixtureHarness.EnsureFamilyType(familyDocument, "Parity Type A");
                var typeB = RevitFamilyFixtureHarness.EnsureFamilyType(familyDocument, "Parity Type B");
                var lengthParameter = RevitFamilyFixtureHarness.AddFamilyParameter(
                    familyDocument,
                    new RevitFamilyFixtureHarness.ParameterDefinitionSpec(
                        "Parity Length", SpecTypeId.Length, GroupTypeId.Geometry, false));
                var textParameter = RevitFamilyFixtureHarness.AddFamilyParameter(
                    familyDocument,
                    new RevitFamilyFixtureHarness.ParameterDefinitionSpec(
                        "Parity Text", SpecTypeId.String.Text, GroupTypeId.IdentityData, true));
                var yesNoParameter = RevitFamilyFixtureHarness.AddFamilyParameter(
                    familyDocument,
                    new RevitFamilyFixtureHarness.ParameterDefinitionSpec(
                        "Parity YesNo", SpecTypeId.Boolean.YesNo, GroupTypeId.Constraints, false));
                var formulaParameter = RevitFamilyFixtureHarness.AddFamilyParameter(
                    familyDocument,
                    new RevitFamilyFixtureHarness.ParameterDefinitionSpec(
                        "Parity Formula Length", SpecTypeId.Length, GroupTypeId.Geometry, false));

                fm.CurrentType = typeA;
                fm.Set(lengthParameter, 1.0);
                fm.Set(textParameter, "alpha");
                fm.Set(yesNoParameter, 1);
                fm.CurrentType = typeB;
                fm.Set(lengthParameter, 2.5);
                fm.Set(textParameter, "");
                fm.Set(yesNoParameter, 0);
                fm.SetFormula(formulaParameter, "Parity Length * 2");
                _ = transaction.Commit();
            }

            // Ground truth via the legacy path: switch CurrentType, read with the CurrentType-based
            // GetValueString overload. Sandbox because CurrentType switching mutates the document.
            var famDoc = new FamilyDocument(familyDocument);
            var groundTruth = new Dictionary<string, string?>(StringComparer.Ordinal);
            using (DocumentSandbox.BeginRollback(familyDocument, "Parity ground truth")) {
                foreach (var familyType in fm.Types.Cast<FamilyType>()) {
                    fm.CurrentType = familyType;
                    foreach (var parameter in fm.GetParameters())
                        groundTruth[$"{parameter.Definition.Name}|{familyType.Name}"] = famDoc.GetValueString(parameter);
                }
            }

            var record = FamilySnapshotExtractor.ExtractFromFamilyDocument(familyDocument);

            Assert.That(record.IsPartial, Is.False);
            Assert.That(record.Issues.Where(issue => issue.Severity == RevitDataIssueSeverity.Error), Is.Empty);
            Assert.That(record.TypeNames, Does.Contain("Parity Type A").And.Contain("Parity Type B"));

            var comparedCells = 0;
            foreach (var parameterSnapshot in record.Parameters) {
                foreach (var (typeName, extractedValue) in parameterSnapshot.ValuesPerType) {
                    var key = $"{parameterSnapshot.Definition.Identity.Name}|{typeName}";
                    Assert.That(groundTruth.ContainsKey(key), Is.True, $"Ground truth missing cell '{key}'.");
                    Assert.That(extractedValue, Is.EqualTo(groundTruth[key]), $"Cell '{key}' diverged.");
                    comparedCells++;
                }
            }

            Assert.That(comparedCells, Is.GreaterThanOrEqualTo(8), "Expected at least 4 parameters × 2 types.");

            var formulaSnapshot = record.Parameters.Single(parameter =>
                parameter.Definition.Identity.Name == "Parity Formula Length");
            Assert.That(formulaSnapshot.Formula, Is.EqualTo("Parity Length * 2"));
            Assert.That(formulaSnapshot.FormulaState, Is.EqualTo(FormulaState.Present));
        } finally {
            RevitFamilyFixtureHarness.CloseDocument(familyDocument);
        }
    }
}
