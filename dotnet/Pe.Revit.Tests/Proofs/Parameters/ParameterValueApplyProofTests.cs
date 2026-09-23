using Autodesk.Revit.DB.Structure;
using Pe.Revit.DocumentData.Parameters;
using Pe.Revit.Parameters;
using Pe.Shared.RevitData;

namespace Pe.Revit.Tests;

/// <summary>
///     Proofs for revit.apply.parameter-values (ParameterValueApplier): the project-document
///     mutation core. A wet run redeems the evidence a dry run read (stale or missing evidence
///     refuses, names are dry-run only, identical aliases write once, differing ones refuse).
///     Pins the behaviors the op contract promises: batch instance + type writes (type writes fan
///     out through the shared symbol element), dryRun parses everything but writes nothing,
///     read-only rejection is per-edit (IsReadOnly only — never UserModifiable), and Double
///     parameters accept unit display strings like 2' 6".
/// </summary>
[TestFixture]
public sealed class ParameterValueApplyProofTests {
    private const string FamilyName = "_PE_DA_ApplyMechEquip";
    private const string LengthParameterName = "PE Proof Length";
    private const string FlagParameterName = "PE Proof Flag";
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
                var data = ApplyReviewed(projectDocument,
                    new ParameterValueEdit(fixture.InstanceIds[0], MarkParameterId, Value: "PE-EDITED"),
                    // Type parameter write goes through the SYMBOL element id — the binding-handle
                    // fan-out semantics: one write changes every instance of the type.
                    new ParameterValueEdit(fixture.SymbolId, TypeCommentsParameterId, Value: "TC-EDITED"));

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
                    // The dry run is the evidence read: Current is the target exactly as the writer will compare it.
                    var instance = projectDocument.GetElement(fixture.InstanceIds[0].ToElementId());
                    Assert.That(data.Results[0].Current, Is.EqualTo(ParameterTargets.Read(instance,
                        instance.get_Parameter(BuiltInParameter.ALL_MODEL_MARK)!)));
                    Assert.That(data.Results[0].Current!.RawValue, Is.EqualTo(MarkA));
                    Assert.That(data.Results[1].Current!.ElementId, Is.EqualTo(fixture.SymbolId));

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

                var data = ApplyReviewed(projectDocument,
                    new ParameterValueEdit(fixture.InstanceIds[0], readOnlyParameter!.Id.Value(),
                        ParameterName: readOnlyParameter.Definition?.Name, Value: "Nope"),
                    new ParameterValueEdit(fixture.InstanceIds[0], MarkParameterId, Value: "PE-EDITED"));

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
                var data = ApplyReviewed(projectDocument,
                    new ParameterValueEdit(fixture.InstanceIds[0], lengthParameter.Id.Value(), Value: "2' 6\""));

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

    [Test]
    public void Unit_conversion_is_exact_via_revits_own_tables_and_symbols_resolve_within_spec(
        UIApplication uiApplication
    ) {
        RunWithPlacedInstances(
            uiApplication,
            nameof(this.Unit_conversion_is_exact_via_revits_own_tables_and_symbols_resolve_within_spec),
            (projectDocument, fixture) => {
                var lengthParameter = projectDocument.GetElement(fixture.InstanceIds[0].ToElementId())
                    .LookupParameter(LengthParameterName)!;
                // Expected values come from the same API the applier must use — correctness by
                // construction, no hand-written conversion constants.
                var expectedFeet = UnitUtils.ConvertToInternalUnits(30, UnitTypeId.Inches);
                // Resolve a symbol label ("in-ish") from the API so the proof survives label churn.
                var inchSymbol = ParameterUnitResolver.GetValidSymbols(UnitTypeId.Inches)
                    .Select(ParameterUnitResolver.GetSymbolLabel)
                    .FirstOrDefault(label => !string.IsNullOrWhiteSpace(label));
                Assert.That(inchSymbol, Is.Not.Null, "Inches must expose at least one symbol label.");

                var data = ApplyReviewed(projectDocument,
                    new ParameterValueEdit(fixture.InstanceIds[0], lengthParameter.Id.Value(),
                        Value: "30", Unit: "Inches"),
                    new ParameterValueEdit(fixture.InstanceIds[1], MarkParameterId, Value: "PE-KEEP"),
                    new ParameterValueEdit(fixture.InstanceIds[1],
                        projectDocument.GetElement(fixture.InstanceIds[1].ToElementId())
                            .LookupParameter(LengthParameterName)!.Id.Value(),
                        Value: "30", Unit: inchSymbol));

                Assert.Multiple(() => {
                    Assert.That(data.Results.Where(result => !result.Ok), Is.Empty,
                        string.Join("; ", data.Results.Where(result => !result.Ok).Select(result => result.Error)));
                    // Member-name spelling and symbol spelling land the IDENTICAL internal value.
                    foreach (var instanceId in fixture.InstanceIds) {
                        var reread = projectDocument.GetElement(instanceId.ToElementId())
                            .LookupParameter(LengthParameterName)!.AsDouble();
                        Assert.That(reread, Is.EqualTo(expectedFeet), $"instance {instanceId}");
                    }
                });
            });
    }

    [Test]
    public void Bare_numerals_on_measurable_doubles_are_rejected_unless_rawInternal(
        UIApplication uiApplication
    ) {
        RunWithPlacedInstances(
            uiApplication,
            nameof(this.Bare_numerals_on_measurable_doubles_are_rejected_unless_rawInternal),
            (projectDocument, fixture) => {
                var lengthParameterId = projectDocument.GetElement(fixture.InstanceIds[0].ToElementId())
                    .LookupParameter(LengthParameterName)!.Id.Value();

                // One call each: three differing edits to one parameter in one call are an alias conflict.
                // The landmine this feature exists to close: "1500" meant as CFM must never
                // silently write 1500 internal units.
                var bare = ApplyReviewed(projectDocument,
                    new ParameterValueEdit(fixture.InstanceIds[0], lengthParameterId, Value: "2.5"));
                var both = ApplyReviewed(projectDocument, new ParameterValueEdit(fixture.InstanceIds[0], lengthParameterId,
                    Value: "2.5", Unit: "Feet", RawInternal: true));
                var raw = ApplyReviewed(projectDocument,
                    new ParameterValueEdit(fixture.InstanceIds[0], lengthParameterId, Value: "2.5", RawInternal: true));

                Assert.Multiple(() => {
                    Assert.That(bare.Results[0].Ok, Is.False);
                    Assert.That(bare.Results[0].Error, Does.Contain("ambiguous"));
                    Assert.That(both.Results[0].Ok, Is.False);
                    Assert.That(both.Results[0].Error, Does.Contain("mutually exclusive"));
                    Assert.That(raw.Results[0].Ok, Is.True, raw.Results[0].Error);
                    Assert.That(projectDocument.GetElement(fixture.InstanceIds[0].ToElementId())
                        .LookupParameter(LengthParameterName)!.AsDouble(), Is.EqualTo(2.5));
                });
            });
    }

    [Test]
    public void Invalid_unit_fails_listing_the_specs_valid_vocabulary_and_dryRun_echoes_display(
        UIApplication uiApplication
    ) {
        RunWithPlacedInstances(
            uiApplication,
            nameof(this.Invalid_unit_fails_listing_the_specs_valid_vocabulary_and_dryRun_echoes_display),
            (projectDocument, fixture) => {
                var lengthParameterId = projectDocument.GetElement(fixture.InstanceIds[0].ToElementId())
                    .LookupParameter(LengthParameterName)!.Id.Value();

                // Separate calls: differing values for one parameter in one call are an alias conflict, dry or wet.
                var wrongUnit = ParameterValueApplier.Apply(projectDocument, new ParameterValueApplyRequest(
                    [new ParameterValueEdit(fixture.InstanceIds[0], lengthParameterId, Value: "1500", Unit: "CFM")],
                    DryRun: true));
                var data = ParameterValueApplier.Apply(projectDocument, new ParameterValueApplyRequest(
                    [new ParameterValueEdit(fixture.InstanceIds[0], lengthParameterId, Value: "30", Unit: "Inches")],
                    DryRun: true));

                Assert.Multiple(() => {
                    // Wrong-spec unit fails per-edit and teaches the valid vocabulary.
                    Assert.That(wrongUnit.Results[0].Ok, Is.False);
                    Assert.That(wrongUnit.Results[0].Error, Does.Contain("not valid"));
                    Assert.That(wrongUnit.Results[0].Error, Does.Contain("Feet").IgnoreCase);

                    // The round-trip echo: internal value re-formatted with document units, so the
                    // caller can assert intent before a wet run.
                    Assert.That(data.Results[0].Ok, Is.True, data.Results[0].Error);
                    var expectedDisplay = UnitFormatUtils.Format(
                        projectDocument.GetUnits(),
                        SpecTypeId.Length,
                        UnitUtils.ConvertToInternalUnits(30, UnitTypeId.Inches),
                        forEditing: false);
                    Assert.That(data.Results[0].ParsedDisplay, Is.EqualTo(expectedDisplay));

                    // dryRun still wrote nothing.
                    Assert.That(projectDocument.GetElement(fixture.InstanceIds[0].ToElementId())
                        .LookupParameter(LengthParameterName)!.AsDouble(), Is.EqualTo(0));
                });
            });
    }

    [Test]
    public void Wet_edits_refuse_stale_or_missing_evidence_and_names_are_dry_run_only(
        UIApplication uiApplication
    ) {
        RunWithPlacedInstances(
            uiApplication,
            nameof(this.Wet_edits_refuse_stale_or_missing_evidence_and_names_are_dry_run_only),
            (projectDocument, fixture) => {
                var edit = new ParameterValueEdit(fixture.InstanceIds[0], MarkParameterId, Value: "PE-LATE");
                var read = ParameterValueApplier.Apply(projectDocument, new ParameterValueApplyRequest([edit], DryRun: true));
                // Someone else changes the Mark after the review read it.
                using (var transaction = new Transaction(projectDocument, "Concurrent edit")) {
                    _ = transaction.Start();
                    projectDocument.GetElement(fixture.InstanceIds[0].ToElementId())
                        .get_Parameter(BuiltInParameter.ALL_MODEL_MARK)!.Set("PE-OTHER");
                    _ = transaction.Commit();
                }

                var stale = ParameterValueApplier.Apply(projectDocument,
                    new ParameterValueApplyRequest([edit with { Expected = read.Results[0].Current }]));
                var missing = ParameterValueApplier.Apply(projectDocument, new ParameterValueApplyRequest([edit]));
                var byName = ParameterValueApplier.Apply(projectDocument, new ParameterValueApplyRequest([
                    new ParameterValueEdit(fixture.InstanceIds[0], ParameterName: "Mark", Value: "PE-NAME",
                        Expected: read.Results[0].Current)
                ]));

                Assert.Multiple(() => {
                    Assert.That(stale.Results[0].Error, Is.EqualTo(ParameterEditPlan.Stale(read.Results[0].Current!, stale.Results[0].Current!)));
                    Assert.That(stale.Results[0].Error, Does.Contain($"value expected '{read.Results[0].Current!.RawValue}', now 'PE-OTHER'"));
                    Assert.That(stale.Results[0].Code, Is.EqualTo(EditRefusalCode.TargetEvidenceStale));
                    Assert.That(missing.Results[0].Code, Is.EqualTo(EditRefusalCode.TargetEvidenceMissing));
                    Assert.That(stale.Results[0].Current!.RawValue, Is.EqualTo("PE-OTHER"));
                    Assert.That(missing.Results[0].Error, Is.EqualTo(ParameterEditPlan.MissingExpected));
                    Assert.That(byName.Results[0].Error, Does.Contain("dry-run discovery only"));
                    Assert.That(ReadInstanceMark(projectDocument, fixture.InstanceIds[0]), Is.EqualTo("PE-OTHER"));
                });
            });
    }

    [Test]
    public void Identical_edits_to_one_parameter_write_once_and_differing_ones_refuse_together(
        UIApplication uiApplication
    ) {
        RunWithPlacedInstances(
            uiApplication,
            nameof(this.Identical_edits_to_one_parameter_write_once_and_differing_ones_refuse_together),
            (projectDocument, fixture) => {
                var same = ApplyReviewed(projectDocument,
                    new ParameterValueEdit(fixture.InstanceIds[0], MarkParameterId, Value: "PE-SAME"),
                    new ParameterValueEdit(fixture.InstanceIds[0], MarkParameterId, Value: "PE-SAME"));
                var differing = ApplyReviewed(projectDocument,
                    new ParameterValueEdit(fixture.InstanceIds[1], MarkParameterId, Value: "PE-ONE"),
                    new ParameterValueEdit(fixture.InstanceIds[1], MarkParameterId, Value: "PE-TWO"));

                Assert.Multiple(() => {
                    Assert.That(same.Results.Select(result => result.Ok), Is.All.True);
                    Assert.That(ReadInstanceMark(projectDocument, fixture.InstanceIds[0]), Is.EqualTo("PE-SAME"));
                    Assert.That(differing.Results.Select(result => result.Error), Is.All.EqualTo(ParameterEditPlan.AliasConflict));
                    Assert.That(ReadInstanceMark(projectDocument, fixture.InstanceIds[1]), Is.EqualTo(MarkB));
                });
            });
    }

    [Test]
    public void The_script_door_writes_without_evidence_but_keeps_alias_and_coalescing_rules(
        UIApplication uiApplication
    ) {
        RunWithPlacedInstances(
            uiApplication,
            nameof(this.The_script_door_writes_without_evidence_but_keeps_alias_and_coalescing_rules),
            (projectDocument, fixture) => {
                var data = ParameterValueApplier.WriteWithoutEvidence(projectDocument, [
                    new ParameterValueEdit(fixture.InstanceIds[0], MarkParameterId, Value: "PE-SCRIPT"),
                    new ParameterValueEdit(fixture.InstanceIds[0], MarkParameterId, Value: "PE-SCRIPT"),
                    new ParameterValueEdit(fixture.InstanceIds[1], MarkParameterId, Value: "PE-ONE"),
                    new ParameterValueEdit(fixture.InstanceIds[1], MarkParameterId, Value: "PE-TWO")
                ]);

                Assert.Multiple(() => {
                    Assert.That(data.Results.Take(2).Select(result => result.Ok), Is.All.True);
                    Assert.That(ReadInstanceMark(projectDocument, fixture.InstanceIds[0]), Is.EqualTo("PE-SCRIPT"));
                    Assert.That(data.Results.Skip(2).Select(result => result.Error), Is.All.EqualTo(ParameterEditPlan.AliasConflict));
                    Assert.That(ReadInstanceMark(projectDocument, fixture.InstanceIds[1]), Is.EqualTo(MarkB));
                });
            });
    }

    // A wet run redeems the evidence a dry run read: each edit carries its Current as Expected.
    // F-J3-5b: a Yes/No parameter reads through the one Yes/No reader (YesNoValue): true/yes/1 and false/no/0 in any case; any other
    // integer is not a Yes/No value and refuses, naming the parameter and the value.
    [Test]
    public void YesNo_parameter_accepts_true_and_refuses_other_integers(UIApplication uiApplication) {
        RunWithPlacedInstances(
            uiApplication,
            nameof(this.YesNo_parameter_accepts_true_and_refuses_other_integers),
            (projectDocument, fixture) => {
                var flagId = projectDocument.GetElement(fixture.InstanceIds[0].ToElementId()).LookupParameter(FlagParameterName)!.Id.Value();
                var applied = ApplyReviewed(projectDocument, new ParameterValueEdit(fixture.InstanceIds[0], flagId, Value: "TRUE"));
                Assert.That(applied.Results.Single().Ok, Is.True, applied.Results.Single().Error);
                Assert.That(projectDocument.GetElement(fixture.InstanceIds[0].ToElementId()).LookupParameter(FlagParameterName)!.AsInteger(), Is.EqualTo(1));
                foreach (var value in new[] { "2", "-5" }) {
                    var refused = ParameterValueApplier.Apply(projectDocument, new ParameterValueApplyRequest(
                        [new ParameterValueEdit(fixture.InstanceIds[1], flagId, Value: value)], DryRun: true)).Results.Single();
                    Assert.That(refused.Ok, Is.False, value);
                    Assert.That(refused.Error, Does.Contain($"'{value}'").And.Contain(FlagParameterName).And.Contain("Yes/No"));
                }
            });
    }

    private static ParameterValueApplyData ApplyReviewed(Document projectDocument, params ParameterValueEdit[] edits) {
        var read = ParameterValueApplier.Apply(projectDocument, new ParameterValueApplyRequest(edits, DryRun: true));
        return ParameterValueApplier.Apply(projectDocument, new ParameterValueApplyRequest(
            edits.Select((edit, index) => edit with { Expected = read.Results[index].Current }).ToList()));
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
                _ = RevitFamilyFixtureHarness.AddFamilyParameter(
                    familyDocument,
                    new RevitFamilyFixtureHarness.ParameterDefinitionSpec(
                        FlagParameterName,
                        SpecTypeId.Boolean.YesNo,
                        GroupTypeId.Data,
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
