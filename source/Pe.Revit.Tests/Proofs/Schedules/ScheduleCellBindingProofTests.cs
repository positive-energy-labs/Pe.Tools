using Autodesk.Revit.DB.Structure;
using Pe.Revit.DocumentData.Schedules.Apply;
using Pe.Revit.DocumentData.Schedules.Collect;
using Pe.Shared.RevitData;
using Pe.Shared.RevitData.Schedules;

namespace Pe.Revit.Tests;

/// <summary>
///     Proofs for the schedule cell binding surface (projection.includeBindings). These pin the
///     Revit behaviors the write surface must survive: type-parameter columns fan out through the
///     shared type element, rendered cells can exist with no writable parameter behind them
///     (calculated/combined/count — Revit's own editor refuses those too), and a Count column used
///     to make the row-binding heuristic demand a comparable value no subject can supply.
/// </summary>
[TestFixture]
public sealed class ScheduleCellBindingProofTests {
    private const string FamilyName = "_PE_DA_BindMechEquip";
    private const string MarkA = "PE-A";
    private const string MarkB = "PE-B";
    private const string TypeComment = "TC-1";

    [Test]
    public void Schedule_cell_bindings_expose_type_parameter_fanout_through_the_shared_type_element(
        UIApplication uiApplication
    ) {
        RunWithBoundSchedule(
            uiApplication,
            "Binding Fanout Proof",
            nameof(this.Schedule_cell_bindings_expose_type_parameter_fanout_through_the_shared_type_element),
            includeCombinedAndCount: false,
            (projectDocument, fixture, entry) => {
                var dataRows = BoundDataRows(entry);
                Assert.That(dataRows, Has.Count.EqualTo(2));

                var markBindings = dataRows.Select(row => BindingFor(entry, row, "Mark")).ToList();
                var typeCommentBindings = dataRows.Select(row => BindingFor(entry, row, "Type Comments")).ToList();

                Assert.Multiple(() => {
                    // Instance column: each row targets exactly its own instance.
                    Assert.That(markBindings.Select(binding => binding.TargetElementIds.Single()),
                        Is.EquivalentTo(fixture.InstanceIds));
                    foreach (var binding in markBindings) {
                        Assert.That(binding.IsTypeParameter, Is.False, binding.ToString());
                        Assert.That(binding.IsEditable, Is.True, binding.ToString());
                        Assert.That(binding.Targets, Has.Count.EqualTo(1));
                        Assert.That(binding.Targets[0].ParameterId, Is.Not.Zero);
                        Assert.That(binding.Targets[0].HasValue, Is.True);
                    }

                    // Type column: every row resolves to the SAME shared type element — one write
                    // through this binding changes the rendered cell of every row of the type.
                    Assert.That(typeCommentBindings.Select(binding => binding.TargetElementIds.Single()),
                        Is.All.EqualTo(fixture.SymbolId));
                    foreach (var binding in typeCommentBindings) {
                        Assert.That(binding.IsTypeParameter, Is.True, binding.ToString());
                        Assert.That(binding.IsEditable, Is.True, binding.ToString());
                    }

                    // The Revit lie that shaped the resolver: UserModifiable reports false for
                    // Mark on a family instance even though IsReadOnly is false and Set() succeeds
                    // (the write-back proof). Editability must gate on IsReadOnly only.
                    var instance = projectDocument.GetElement(fixture.InstanceIds[0].ToElementId());
                    var markParameter = instance.get_Parameter(BuiltInParameter.ALL_MODEL_MARK)!;
                    Assert.That(markParameter.IsReadOnly, Is.False);
                    Assert.That(markParameter.UserModifiable, Is.False,
                        "UserModifiable now reports true for Mark — the resolver could re-add it to the editability gate.");
                });
            });
    }

    [Test]
    public void Reviewed_schedule_cells_apply_instance_and_coalesced_type_edits_and_refuse_conflicts(
        UIApplication uiApplication
    ) {
        RunWithBoundSchedule(uiApplication, "Reviewed Apply Proof",
            nameof(this.Reviewed_schedule_cells_apply_instance_and_coalesced_type_edits_and_refuse_conflicts),
            includeCombinedAndCount: true,
            (projectDocument, _, entry) => {
                var rows = BoundDataRows(entry);
                var mark = BindingFor(entry, rows[0], "Mark");
                var typeA = BindingFor(entry, rows[0], "Type Comments");
                var typeB = BindingFor(entry, rows[1], "Type Comments");
                var identical = projectDocument.ApplyReviewedScheduleCells(new ScheduleCellApplyRequest(
                    entry.ScheduleId, entry.ScheduleUniqueId, [
                        new(rows[0].RowNumber, typeA.ColumnNumber, typeA, "TC-SHARED"),
                        new(rows[1].RowNumber, typeB.ColumnNumber, typeB, "TC-SHARED")
                    ]));
                Assert.Multiple(() => {
                    Assert.That(identical.AppliedCells, Is.EqualTo(2));
                    Assert.That(identical.AppliedParameterWrites, Is.EqualTo(1));
                });

                var afterShared = CollectEntry(projectDocument, entry.ScheduleId);
                var afterRows = BoundDataRows(afterShared);
                var changedMark = BindingFor(afterShared, afterRows[0], "Mark");
                var instance = projectDocument.ApplyReviewedScheduleCells(new ScheduleCellApplyRequest(
                    entry.ScheduleId, entry.ScheduleUniqueId,
                    [new(afterRows[0].RowNumber, changedMark.ColumnNumber, changedMark, "PE-INSTANCE")]));
                Assert.Multiple(() => {
                    Assert.That(instance.AppliedParameterWrites, Is.EqualTo(1));
                    Assert.That(projectDocument.GetElement(changedMark.Targets.Single().ElementId.ToElementId())
                        .get_Parameter(BuiltInParameter.ALL_MODEL_MARK)!.AsString(), Is.EqualTo("PE-INSTANCE"));
                });

                var conflictEntry = CollectEntry(projectDocument, entry.ScheduleId);
                var conflictRows = BoundDataRows(conflictEntry);
                var conflictA = BindingFor(conflictEntry, conflictRows[0], "Type Comments");
                var conflictB = BindingFor(conflictEntry, conflictRows[1], "Type Comments");
                var conflict = projectDocument.ApplyReviewedScheduleCells(new ScheduleCellApplyRequest(
                    entry.ScheduleId, entry.ScheduleUniqueId, [
                        new(conflictRows[0].RowNumber, conflictA.ColumnNumber, conflictA, "TC-A"),
                        new(conflictRows[1].RowNumber, conflictB.ColumnNumber, conflictB, "TC-B")
                    ]));
                Assert.Multiple(() => {
                    Assert.That(conflict.AppliedParameterWrites, Is.Zero);
                    Assert.That(conflict.Results, Has.All.Property(nameof(ScheduleCellEditResult.Ok)).False);
                    Assert.That(projectDocument.GetElement(conflictA.Targets.Single().ElementId.ToElementId())
                        .get_Parameter(BuiltInParameter.ALL_MODEL_TYPE_COMMENTS)!.AsString(), Is.EqualTo("TC-SHARED"));
                });

                var blocked = BindingFor(entry, rows[0], "Count");
                var blockedResult = projectDocument.ApplyReviewedScheduleCells(new ScheduleCellApplyRequest(
                    entry.ScheduleId, entry.ScheduleUniqueId,
                    [new(rows[0].RowNumber, blocked.ColumnNumber, blocked, "9")]));
                Assert.That(blockedResult.Results.Single().Error, Does.Contain("unavailable"));

                var missing = mark with { Targets = [] };
                var missingResult = projectDocument.ApplyReviewedScheduleCells(new ScheduleCellApplyRequest(
                    entry.ScheduleId, entry.ScheduleUniqueId,
                    [new(rows[0].RowNumber, mark.ColumnNumber, missing, "NOPE")]));
                Assert.That(missingResult.Results.Single().Error, Does.Contain("missing canonical target evidence"));
                Assert.That(missingResult.Results.Single().Code, Is.Null, "only stale cell evidence carries a cell-level code");

                var wrongParameterId = typeA.Targets.Single().ParameterId;
                var invalidExactId = mark with {
                    ParameterId = wrongParameterId,
                    Targets = [mark.Targets.Single() with { ParameterId = wrongParameterId }]
                };
                var invalidIdResult = projectDocument.ApplyReviewedScheduleCells(new ScheduleCellApplyRequest(
                    entry.ScheduleId, entry.ScheduleUniqueId,
                    [new(rows[0].RowNumber, mark.ColumnNumber, invalidExactId, "NO-FUZZY-FALLBACK")]));
                Assert.That(invalidIdResult.Results.Single().Error, Does.Contain("stale"));
                Assert.That(invalidIdResult.Results.Single().Code, Is.EqualTo(EditRefusalCode.TargetEvidenceStale), "the web keys stale on the code");

                var beforeCancel = projectDocument.GetElement(mark.Targets.Single().ElementId.ToElementId())
                    .get_Parameter(BuiltInParameter.ALL_MODEL_MARK)!.AsString();
                using var cancellation = new CancellationTokenSource();
                cancellation.Cancel();
                Assert.Throws<OperationCanceledException>(() => projectDocument.ApplyReviewedScheduleCells(
                    new ScheduleCellApplyRequest(entry.ScheduleId, entry.ScheduleUniqueId,
                        [new(rows[0].RowNumber, mark.ColumnNumber, mark, "NO-CANCEL-WRITE")]), cancellation.Token));
                Assert.That(projectDocument.GetElement(mark.Targets.Single().ElementId.ToElementId())
                    .get_Parameter(BuiltInParameter.ALL_MODEL_MARK)!.AsString(), Is.EqualTo(beforeCancel));
            });
    }

    [Test]
    public void Reviewed_schedule_cell_requested_beyond_default_projection_budget_is_applied(
        UIApplication uiApplication
    ) {
        RunWithBoundSchedule(uiApplication, "Reviewed Beyond 25 Proof",
            nameof(this.Reviewed_schedule_cell_requested_beyond_default_projection_budget_is_applied),
            includeCombinedAndCount: false,
            (projectDocument, _, entry) => {
                var beyondBudgetRows = BoundDataRows(entry).Where(item => item.RowNumber > 25).ToList();
                Assert.That(beyondBudgetRows, Has.Count.GreaterThanOrEqualTo(1));
                var row = beyondBudgetRows.Last();
                var binding = BindingFor(entry, row, "Mark");
                var result = projectDocument.ApplyReviewedScheduleCells(new ScheduleCellApplyRequest(
                    entry.ScheduleId, entry.ScheduleUniqueId,
                    [new(row.RowNumber, binding.ColumnNumber, binding, "PE-BEYOND-25")]));
                Assert.Multiple(() => {
                    Assert.That(result.AppliedParameterWrites, Is.EqualTo(1));
                    Assert.That(projectDocument.GetElement(binding.Targets.Single().ElementId.ToElementId())
                        .get_Parameter(BuiltInParameter.ALL_MODEL_MARK)!.AsString(), Is.EqualTo("PE-BEYOND-25"));
                });
            }, instanceCount: 30, collectionRowBudget: 40);
    }

    [Test]
    public void Reviewed_schedule_cell_refuses_when_a_nonfirst_native_target_changed(
        UIApplication uiApplication
    ) {
        RunWithBoundSchedule(uiApplication, "Reviewed Mixed Stale Proof",
            nameof(this.Reviewed_schedule_cell_refuses_when_a_nonfirst_native_target_changed),
            includeCombinedAndCount: false,
            (projectDocument, fixture, entry) => {
                var row = BoundDataRows(entry).Single();
                var binding = BindingFor(entry, row, "Mark");
                var typeComments = BindingFor(entry, row, "Type Comments");
                Assert.Multiple(() => {
                    Assert.That(binding.Targets, Has.Count.EqualTo(2));
                    Assert.That(binding.HasMixedValues, Is.True);
                    Assert.That(binding.Targets.Select(target => target.RawValue),
                        Is.EquivalentTo(new[] { MarkA, MarkB }));
                });
                var firstRawValue = binding.RawValue;
                var dryRun = projectDocument.ApplyReviewedScheduleCells(new ScheduleCellApplyRequest(
                    entry.ScheduleId, entry.ScheduleUniqueId,
                    [
                        new(row.RowNumber, typeComments.ColumnNumber, typeComments, "TC-DRY-FIRST"),
                        new(row.RowNumber, binding.ColumnNumber, binding, "PE-DRY-MULTI")
                    ], DryRun: true));
                Assert.That(dryRun.Results[1].ParameterResults.Select(result => result.Index),
                    Is.EqualTo(new[] { 0, 1 }), "nested indices must map to this cell's Targets positions");
                using (var transaction = new Transaction(projectDocument, "Change nonfirst reviewed target")) {
                    _ = transaction.Start();
                    _ = projectDocument.GetElement(binding.Targets[1].ElementId.ToElementId())
                        .get_Parameter(BuiltInParameter.ALL_MODEL_MARK)!.Set("PE-STALE-SECOND");
                    _ = transaction.Commit();
                }

                var result = projectDocument.ApplyReviewedScheduleCells(new ScheduleCellApplyRequest(
                    entry.ScheduleId, entry.ScheduleUniqueId,
                    [new(row.RowNumber, binding.ColumnNumber, binding, "MUST-NOT-WRITE")]));
                var current = result.Results.Single().CurrentBinding;
                Assert.Multiple(() => {
                    Assert.That(result.AppliedParameterWrites, Is.Zero);
                    Assert.That(result.Results.Single().Error, Does.Contain("stale"));
                    // The cell answers with its first target, a sibling of the stale one: the group refusal, carrying the stale cause's code.
                    Assert.That((result.Results.Single().Code, result.Results.Single().CauseCode),
                        Is.EqualTo(((EditRefusalCode?)EditRefusalCode.AdmissionGroupRefused, (EditRefusalCode?)EditRefusalCode.TargetEvidenceStale)));
                    Assert.That(result.Results.Single().ParameterResults.Select(leaf => leaf.Code),
                        Is.EqualTo(new EditRefusalCode?[] { EditRefusalCode.AdmissionGroupRefused, EditRefusalCode.TargetEvidenceStale }));
                    Assert.That(current, Is.Not.Null);
                    Assert.That(current!.HasMixedValues, Is.True);
                    Assert.That(current.RawValue, Is.EqualTo(firstRawValue));
                    Assert.That(current.Targets[0], Is.EqualTo(binding.Targets[0]));
                    Assert.That(current.Targets[1], Is.Not.EqualTo(binding.Targets[1]));
                    Assert.That(projectDocument.GetElement(fixture.InstanceIds[0].ToElementId())
                        .get_Parameter(BuiltInParameter.ALL_MODEL_MARK)!.AsString(), Is.EqualTo(MarkA));
                    Assert.That(projectDocument.GetElement(fixture.InstanceIds[1].ToElementId())
                        .get_Parameter(BuiltInParameter.ALL_MODEL_MARK)!.AsString(), Is.EqualTo("PE-STALE-SECOND"));
                });
            }, groupedRows: true);
    }

    [Test]
    public void Schedule_cell_bindings_block_columns_revit_itself_cannot_edit(
        UIApplication uiApplication
    ) {
        RunWithBoundSchedule(
            uiApplication,
            "Binding Blocker Proof",
            nameof(this.Schedule_cell_bindings_block_columns_revit_itself_cannot_edit),
            includeCombinedAndCount: true,
            (projectDocument, fixture, entry) => {
                var dataRows = BoundDataRows(entry);
                // Proof of the fixed trap: a Count column renders text but no subject can produce a
                // comparable value for it; before the HasSchedulableField guard this alone made
                // every row in the schedule Unbound.
                Assert.That(dataRows, Has.Count.EqualTo(2));

                var row = dataRows[0];
                var combinedColumn = entry.Columns.Single(column => column.IsCombinedParameter);
                var countColumn = entry.Columns.Single(column =>
                    string.Equals(column.FieldName, "Count", StringComparison.OrdinalIgnoreCase));
                var combinedBinding = row.Bindings!.Single(binding => binding.ColumnNumber == combinedColumn.ColumnNumber);
                var countBinding = row.Bindings!.Single(binding => binding.ColumnNumber == countColumn.ColumnNumber);
                var combinedCellText = row.Values[entry.Columns.IndexOf(combinedColumn)];
                var countCellText = row.Values[entry.Columns.IndexOf(countColumn)];

                Assert.Multiple(() => {
                    // The asymmetry this surface exists to expose: GetCellText renders a value, but
                    // there is no writable parameter behind the cell.
                    Assert.That(combinedCellText, Is.Not.Empty);
                    Assert.That(combinedBinding.IsEditable, Is.False);
                    Assert.That(combinedBinding.Blocker, Is.EqualTo(ScheduleCellBindingBlocker.CombinedParameterField));
                    Assert.That(combinedBinding.TargetElementIds, Is.Empty);

                    Assert.That(countCellText, Is.Not.Empty);
                    Assert.That(countBinding.IsEditable, Is.False);
                    Assert.That(countBinding.Blocker, Is.Not.EqualTo(ScheduleCellBindingBlocker.None));
                });
            });
    }

    [Test]
    public void Schedule_cell_binding_display_values_match_rendered_cell_text_for_standard_columns(
        UIApplication uiApplication
    ) {
        RunWithBoundSchedule(
            uiApplication,
            "Binding Parity Proof",
            nameof(this.Schedule_cell_binding_display_values_match_rendered_cell_text_for_standard_columns),
            includeCombinedAndCount: false,
            (projectDocument, fixture, entry) => {
                var dataRows = BoundDataRows(entry);
                Assert.That(dataRows, Has.Count.EqualTo(2));

                Assert.Multiple(() => {
                    foreach (var row in dataRows) {
                        foreach (var fieldName in new[] { "Mark", "Type Comments" }) {
                            var column = ColumnFor(entry, fieldName);
                            var binding = row.Bindings!.Single(item => item.ColumnNumber == column.ColumnNumber);
                            var cellText = row.Values[entry.Columns.IndexOf(column)].Trim();
                            // Direct parameter reads and the rendered grid agree cell-for-cell on
                            // standard columns — the editor can trust bindings as display truth.
                            Assert.That(binding.DisplayValue?.Trim(), Is.EqualTo(cellText),
                                $"{fieldName} row {row.RowNumber}");
                            Assert.That(binding.RawValue, Is.EqualTo(binding.DisplayValue),
                                $"{fieldName} row {row.RowNumber} (string storage: raw == display)");
                        }
                    }
                });
            });
    }

    [Test]
    public void Schedule_cell_binding_writes_change_the_rendered_grid(
        UIApplication uiApplication
    ) {
        RunWithBoundSchedule(
            uiApplication,
            "Binding Write-Back Proof",
            nameof(this.Schedule_cell_binding_writes_change_the_rendered_grid),
            includeCombinedAndCount: false,
            (projectDocument, fixture, entry) => {
                var dataRows = BoundDataRows(entry);
                var markRow = dataRows.Single(row =>
                    row.Values[entry.Columns.IndexOf(ColumnFor(entry, "Mark"))].Trim() == MarkA);
                var markBinding = BindingFor(entry, markRow, "Mark");
                var typeCommentBinding = BindingFor(entry, markRow, "Type Comments");

                // Write exactly the way an external editor client would: resolve the parameter on
                // the binding's target element by the binding's parameter id, then Set.
                using (var transaction = new Transaction(projectDocument, "Apply cell binding edits")) {
                    _ = transaction.Start();
                    SetThroughBinding(projectDocument, markBinding, "PE-EDITED");
                    SetThroughBinding(projectDocument, typeCommentBinding, "TC-EDITED");
                    _ = transaction.Commit();
                }

                var after = CollectEntry(projectDocument, entry.ScheduleId);
                var afterRows = BoundDataRows(after);
                var markIndex = after.Columns.IndexOf(ColumnFor(after, "Mark"));
                var typeCommentIndex = after.Columns.IndexOf(ColumnFor(after, "Type Comments"));

                Assert.Multiple(() => {
                    // Instance write landed in exactly one row.
                    Assert.That(afterRows.Select(row => row.Values[markIndex].Trim()),
                        Is.EquivalentTo(new[] { "PE-EDITED", MarkB }));
                    // Type write fanned out to every row of the type, as the shared target id promised.
                    Assert.That(afterRows.Select(row => row.Values[typeCommentIndex].Trim()),
                        Is.All.EqualTo("TC-EDITED"));
                });
            });
    }

    private static void SetThroughBinding(Document doc, ScheduleCellBinding binding, string value) {
        var target = doc.GetElement(binding.TargetElementIds.Single().ToElementId());
        var parameter = target.Parameters
            .Cast<Parameter>()
            .Single(item => item.Id.Value() == binding.ParameterId);
        Assert.That(parameter.IsReadOnly, Is.False);
        _ = parameter.Set(value);
    }

    private static List<ScheduleRenderedRow> BoundDataRows(ScheduleRenderedScheduleEntry entry) =>
        entry.Rows
            .Where(row => row.Kind == ScheduleRenderedRowKind.Data
                && row.ResolutionStatus == ScheduleRenderedRowSubjectResolutionStatus.Bound)
            .ToList();

    private static ScheduleRenderedColumn ColumnFor(ScheduleRenderedScheduleEntry entry, string fieldName) =>
        entry.Columns.Single(column =>
            string.Equals(column.FieldName, fieldName, StringComparison.OrdinalIgnoreCase));

    private static ScheduleCellBinding BindingFor(
        ScheduleRenderedScheduleEntry entry,
        ScheduleRenderedRow row,
        string fieldName
    ) {
        Assert.That(row.Bindings, Is.Not.Null, $"row {row.RowNumber} has no bindings");
        return row.Bindings!.Single(binding => binding.ColumnNumber == ColumnFor(entry, fieldName).ColumnNumber);
    }

    private static ScheduleRenderedScheduleEntry CollectEntry(Document projectDocument, long scheduleId, int rowBudget = 25) {
        var data = ScheduleQueryCollector.Collect(
            projectDocument,
            new ScheduleQuery {
                Kind = ScheduleQueryKind.ScheduleReferences,
                ScheduleIds = [scheduleId],
                Projection = new ScheduleQueryProjection {
                    View = RevitDataResultView.Full,
                    IncludeBindings = true
                },
                Budget = new RevitDataOutputBudget { MaxRowsPerEntry = rowBudget }
            }
        );
        return data.Entries.Single();
    }

    private sealed record BindingFixture(
        long SymbolId,
        List<long> InstanceIds
    );

    private static void RunWithBoundSchedule(
        UIApplication uiApplication,
        string scheduleName,
        string testName,
        bool includeCombinedAndCount,
        Action<Document, BindingFixture, ScheduleRenderedScheduleEntry> assert,
        int instanceCount = 2,
        int collectionRowBudget = 25,
        bool groupedRows = false
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
                _ = transaction.Commit();
            }

            var familyPath = RevitFamilyFixtureHarness.SaveDocumentCopy(familyDocument, outputDirectory, "bind-mech-equip");
            var loadedFamily = RevitFamilyFixtureHarness.LoadFamilyIntoProject(application, projectDocument, familyPath);
            Assert.That(loadedFamily, Is.Not.Null);

            var fixture = CreateBoundSchedule(projectDocument, loadedFamily!, scheduleName, includeCombinedAndCount,
                out var schedule, instanceCount, groupedRows);
            var entry = CollectEntry(projectDocument, schedule.Id.Value(), collectionRowBudget);
            assert(projectDocument, fixture, entry);
        } finally {
            RevitFamilyFixtureHarness.CloseDocument(familyDocument);
            RevitFamilyFixtureHarness.CloseDocument(projectDocument);
        }
    }

    private static BindingFixture CreateBoundSchedule(
        Document projectDocument,
        Family loadedFamily,
        string scheduleName,
        bool includeCombinedAndCount,
        out ViewSchedule schedule,
        int instanceCount = 2,
        bool groupedRows = false
    ) {
        using var transaction = new Transaction(projectDocument, $"Create schedule '{scheduleName}'");
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
        var marks = Enumerable.Range(0, instanceCount)
            .Select(index => index switch { 0 => MarkA, 1 => MarkB, _ => $"PE-{index + 1:D3}" });
        foreach (var (mark, index) in marks.Select((mark, index) => (mark, index))) {
            var position = new XYZ(index * 10, 0, 0);
            var instance = projectDocument.Create.NewFamilyInstance(position, symbol, level, StructuralType.NonStructural);
            _ = instance.get_Parameter(BuiltInParameter.ALL_MODEL_MARK)!.Set(mark);
            instanceIds.Add(instance.Id.Value());
        }

        schedule = ViewSchedule.CreateSchedule(projectDocument, new ElementId(BuiltInCategory.OST_MechanicalEquipment));
        schedule.Name = scheduleName;
        schedule.Definition.IsItemized = !groupedRows;
        _ = AddSchedulableField(schedule, "Mark");
        _ = AddSchedulableField(schedule, "Type Comments");

        if (includeCombinedAndCount) {
            _ = AddSchedulableField(schedule, "Count");
            var combinedParts = new List<TableCellCombinedParameterData>();
            foreach (var builtIn in new[] { BuiltInParameter.ALL_MODEL_MARK, BuiltInParameter.ALL_MODEL_TYPE_COMMENTS }) {
                var part = TableCellCombinedParameterData.Create();
                part.ParamId = new ElementId(builtIn);
                part.Separator = " / ";
                combinedParts.Add(part);
            }

            Assert.That(schedule.Definition.IsValidCombinedParameters(combinedParts), Is.True);
            _ = schedule.Definition.InsertCombinedParameterField(
                combinedParts,
                "Mark + Type Comments",
                schedule.Definition.GetFieldCount()
            );
            foreach (var part in combinedParts)
                part.Dispose();
        }

        _ = transaction.Commit();
        return new BindingFixture(symbol.Id.Value(), instanceIds);
    }

    private static ScheduleField AddSchedulableField(ViewSchedule schedule, string fieldName) {
        var schedulableField = schedule.Definition.GetSchedulableFields()
            .First(field =>
                string.Equals(field.GetName(schedule.Document), fieldName, StringComparison.OrdinalIgnoreCase));
        return schedule.Definition.AddField(schedulableField);
    }
}
