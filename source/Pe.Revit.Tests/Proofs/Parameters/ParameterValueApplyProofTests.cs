using Autodesk.Revit.DB.Structure;
using Pe.Revit.DocumentData.Parameters;
using Pe.Shared.RevitData;

namespace Pe.Revit.Tests;

/// <summary>
///     Proofs for revit.apply.parameter-values (ParameterValueApplier): the project-document
///     mutation core that redeems schedule cell binding handles (element id + parameter id).
///     Pins the behaviors the op contract promises: batch instance + type writes (type writes fan
///     out through the shared symbol element), dryRun parses everything but writes nothing,
///     read-only rejection is per-edit (IsReadOnly only — never UserModifiable), and Double
///     parameters accept unit display strings like 2' 6".
/// </summary>
[TestFixture]
public sealed class ParameterValueApplyProofTests {
    private const string FamilyName = "_PE_DA_ApplyMechEquip";
    private const string LengthParameterName = "PE Proof Length";
    private const string MarkA = "PE-A";
    private const string MarkB = "PE-B";
    private const string TypeComment = "TC-1";

    private static readonly long MarkParameterId = (long)BuiltInParameter.ALL_MODEL_MARK;
    private static readonly long TypeCommentsParameterId = (long)BuiltInParameter.ALL_MODEL_TYPE_COMMENTS;

    [Test]
    public void Batch_write_sets_instance_mark_and_fans_type_comments_out_through_the_symbol(
        UIApplication uiApplication
    ) {
        RunWithPlacedInstances(
            uiApplication,
            nameof(this.Batch_write_sets_instance_mark_and_fans_type_comments_out_through_the_symbol),
            (projectDocument, fixture) => {
                var request = new ParameterValueApplyRequest([
                    new ParameterValueEdit(fixture.InstanceIds[0], MarkParameterId, Value: "PE-EDITED"),
                    // Type parameter write goes through the SYMBOL element id — the binding-handle
                    // fan-out semantics: one write changes every instance of the type.
                    new ParameterValueEdit(fixture.SymbolId, TypeCommentsParameterId, Value: "TC-EDITED")
                ]);

                var data = ParameterValueApplier.Apply(projectDocument, request);

                Assert.Multiple(() => {
                    Assert.That(data.Applied, Is.EqualTo(2));
                    Assert.That(data.DryRun, Is.False);
                    Assert.That(data.Results.Where(result => !result.Ok), Is.Empty,
                        string.Join("; ", data.Results.Where(result => !result.Ok).Select(result => result.Error)));

                    Assert.That(ReadInstanceMark(projectDocument, fixture.InstanceIds[0]), Is.EqualTo("PE-EDITED"));
                    Assert.That(ReadInstanceMark(projectDocument, fixture.InstanceIds[1]), Is.EqualTo(MarkB));

                    // The write landed on the shared type element itself.
                    var symbol = projectDocument.GetElement(fixture.SymbolId.ToElementId());
                    Assert.That(symbol.get_Parameter(BuiltInParameter.ALL_MODEL_TYPE_COMMENTS)!.AsString(),
                        Is.EqualTo("TC-EDITED"));

                    // And fans out: every instance's type now renders the new comment.
                    foreach (var instanceId in fixture.InstanceIds) {
                        var instance = (FamilyInstance)projectDocument.GetElement(instanceId.ToElementId());
                        Assert.That(instance.Symbol.get_Parameter(BuiltInParameter.ALL_MODEL_TYPE_COMMENTS)!.AsString(),
                            Is.EqualTo("TC-EDITED"));
                    }
                });
            });
    }

    [Test]
    public void DryRun_parses_and_reports_but_writes_nothing(
        UIApplication uiApplication
    ) {
        RunWithPlacedInstances(
            uiApplication,
            nameof(this.DryRun_parses_and_reports_but_writes_nothing),
            (projectDocument, fixture) => {
                var request = new ParameterValueApplyRequest(
                    [
                        new ParameterValueEdit(fixture.InstanceIds[0], MarkParameterId, Value: "PE-DRY"),
                        new ParameterValueEdit(fixture.SymbolId, TypeCommentsParameterId, Value: "TC-DRY")
                    ],
                    DryRun: true
                );

                var data = ParameterValueApplier.Apply(projectDocument, request);

                Assert.Multiple(() => {
                    Assert.That(data.Applied, Is.EqualTo(0));
                    Assert.That(data.DryRun, Is.True);
                    Assert.That(data.Results, Has.Count.EqualTo(2));
                    foreach (var result in data.Results) {
                        Assert.That(result.Ok, Is.True, result.Error);
                        Assert.That(result.ParsedRaw, Is.Not.Null,
                            $"dry-run result {result.Index} must report what would be written");
                    }

                    // No transaction was opened and nothing changed.
                    Assert.That(ReadInstanceMark(projectDocument, fixture.InstanceIds[0]), Is.EqualTo(MarkA));
                    var symbol = projectDocument.GetElement(fixture.SymbolId.ToElementId());
                    Assert.That(symbol.get_Parameter(BuiltInParameter.ALL_MODEL_TYPE_COMMENTS)!.AsString(),
                        Is.EqualTo(TypeComment));
                });
            });
    }

    [Test]
    public void ReadOnly_parameter_is_rejected_per_edit_while_the_valid_edit_still_applies(
        UIApplication uiApplication
    ) {
        RunWithPlacedInstances(
            uiApplication,
            nameof(this.ReadOnly_parameter_is_rejected_per_edit_while_the_valid_edit_still_applies),
            (projectDocument, fixture) => {
                var instance = projectDocument.GetElement(fixture.InstanceIds[0].ToElementId());
                // Discover a genuinely read-only parameter on the instance rather than trusting a
                // specific built-in to report IsReadOnly across Revit versions.
                var readOnlyParameter = instance.Parameters
                    .Cast<Parameter>()
                    .FirstOrDefault(parameter => parameter.IsReadOnly);
                Assert.That(readOnlyParameter, Is.Not.Null,
                    "Fixture precondition: the instance must expose at least one read-only parameter.");

                var request = new ParameterValueApplyRequest([
                    new ParameterValueEdit(fixture.InstanceIds[0], readOnlyParameter!.Id.Value(),
                        ParameterName: readOnlyParameter.Definition?.Name, Value: "Nope"),
                    new ParameterValueEdit(fixture.InstanceIds[0], MarkParameterId, Value: "PE-EDITED")
                ]);

                var data = ParameterValueApplier.Apply(projectDocument, request);

                Assert.Multiple(() => {
                    Assert.That(data.Applied, Is.EqualTo(1));
                    Assert.That(data.Results[0].Ok, Is.False);
                    Assert.That(data.Results[0].Error, Does.Contain("read-only"));
                    Assert.That(data.Results[1].Ok, Is.True, data.Results[1].Error);
                    Assert.That(ReadInstanceMark(projectDocument, fixture.InstanceIds[0]), Is.EqualTo("PE-EDITED"));
                });
            });
    }

    [Test]
    public void Length_parameter_accepts_imperial_display_string_and_stores_raw_feet(
        UIApplication uiApplication
    ) {
        RunWithPlacedInstances(
            uiApplication,
            nameof(this.Length_parameter_accepts_imperial_display_string_and_stores_raw_feet),
            (projectDocument, fixture) => {
                var instance = projectDocument.GetElement(fixture.InstanceIds[0].ToElementId());
                var lengthParameter = instance.LookupParameter(LengthParameterName);
                Assert.That(lengthParameter, Is.Not.Null,
                    $"Fixture precondition: instance family parameter '{LengthParameterName}' must exist.");
                Assert.That(lengthParameter!.StorageType, Is.EqualTo(StorageType.Double));

                // Address the edit by the positive parameter id, like a binding handle would.
                var request = new ParameterValueApplyRequest([
                    new ParameterValueEdit(fixture.InstanceIds[0], lengthParameter.Id.Value(), Value: "2' 6\"")
                ]);

                var data = ParameterValueApplier.Apply(projectDocument, request);

                Assert.Multiple(() => {
                    Assert.That(data.Applied, Is.EqualTo(1));
                    Assert.That(data.Results[0].Ok, Is.True, data.Results[0].Error);
                    Assert.That(data.Results[0].ParsedRaw, Is.Not.Null);
                    Assert.That(double.Parse(data.Results[0].ParsedRaw!, System.Globalization.CultureInfo.InvariantCulture),
                        Is.EqualTo(2.5).Within(1e-9), "parsedRaw carries the raw internal feet");

                    var reread = projectDocument.GetElement(fixture.InstanceIds[0].ToElementId())
                        .LookupParameter(LengthParameterName)!;
                    Assert.That(reread.AsDouble(), Is.EqualTo(2.5).Within(1e-9));
                });
            });
    }

    private static string? ReadInstanceMark(Document projectDocument, long instanceId) =>
        projectDocument.GetElement(instanceId.ToElementId())
            .get_Parameter(BuiltInParameter.ALL_MODEL_MARK)!.AsString();

    private sealed record ApplyFixture(
        long SymbolId,
        List<long> InstanceIds
    );

    private static void RunWithPlacedInstances(
        UIApplication uiApplication,
        string testName,
        Action<Document, ApplyFixture> assert
    ) {
        var application = uiApplication.Application;
        var outputDirectory = RevitFamilyFixtureHarness.CreateTemporaryOutputDirectory(testName);
        var projectDocument = RevitFamilyFixtureHarness.CreateProjectDocument(application);
        var familyDocument = RevitFamilyFixtureHarness.CreateFamilyDocument(
            application,
            BuiltInCategory.OST_MechanicalEquipment,
            FamilyName
        );

        try {
            using (var transaction = new Transaction(familyDocument, "Seed mechanical equipment family")) {
                _ = transaction.Start();
                _ = RevitFamilyFixtureHarness.EnsureFamilyType(familyDocument, "Primary");
                _ = RevitFamilyFixtureHarness.AddFamilyParameter(
                    familyDocument,
                    new RevitFamilyFixtureHarness.ParameterDefinitionSpec(
                        LengthParameterName,
                        SpecTypeId.Length,
                        GroupTypeId.Geometry,
                        IsInstance: true));
                _ = transaction.Commit();
            }

            var familyPath = RevitFamilyFixtureHarness.SaveDocumentCopy(familyDocument, outputDirectory, "apply-mech-equip");
            var loadedFamily = RevitFamilyFixtureHarness.LoadFamilyIntoProject(application, projectDocument, familyPath);
            Assert.That(loadedFamily, Is.Not.Null);

            var fixture = PlaceInstances(projectDocument, loadedFamily!);
            assert(projectDocument, fixture);
        } finally {
            RevitFamilyFixtureHarness.CloseDocument(familyDocument);
            RevitFamilyFixtureHarness.CloseDocument(projectDocument);
        }
    }

    private static ApplyFixture PlaceInstances(Document projectDocument, Family loadedFamily) {
        using var transaction = new Transaction(projectDocument, "Place apply-proof instances");
        _ = transaction.Start();

        var symbol = (FamilySymbol)projectDocument.GetElement(loadedFamily.GetFamilySymbolIds().First());
        if (!symbol.IsActive)
            symbol.Activate();
        _ = symbol.get_Parameter(BuiltInParameter.ALL_MODEL_TYPE_COMMENTS)!.Set(TypeComment);

        var level = new FilteredElementCollector(projectDocument)
            .OfClass(typeof(Level))
            .Cast<Level>()
            .OrderBy(item => item.Elevation)
            .First();
        var instanceIds = new List<long>();
        foreach (var (mark, position) in new[] { (MarkA, XYZ.Zero), (MarkB, new XYZ(10, 0, 0)) }) {
            var instance = projectDocument.Create.NewFamilyInstance(position, symbol, level, StructuralType.NonStructural);
            _ = instance.get_Parameter(BuiltInParameter.ALL_MODEL_MARK)!.Set(mark);
            instanceIds.Add(instance.Id.Value());
        }

        _ = transaction.Commit();
        return new ApplyFixture(symbol.Id.Value(), instanceIds);
    }
}
