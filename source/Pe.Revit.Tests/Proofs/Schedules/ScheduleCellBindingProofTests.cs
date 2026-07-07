using Autodesk.Revit.DB.Structure;
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

    private static ScheduleRenderedScheduleEntry CollectEntry(Document projectDocument, long scheduleId) {
        var data = ScheduleQueryCollector.Collect(
            projectDocument,
            new ScheduleQuery {
                Kind = ScheduleQueryKind.ScheduleReferences,
                ScheduleIds = [scheduleId],
                Projection = new ScheduleQueryProjection {
                    View = RevitDataResultView.Full,
                    IncludeBindings = true
                }
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
        Action<Document, BindingFixture, ScheduleRenderedScheduleEntry> assert
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

            var fixture = CreateBoundSchedule(projectDocument, loadedFamily!, scheduleName, includeCombinedAndCount, out var schedule);
            var entry = CollectEntry(projectDocument, schedule.Id.Value());
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
        out ViewSchedule schedule
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
        foreach (var (mark, position) in new[] { (MarkA, XYZ.Zero), (MarkB, new XYZ(10, 0, 0)) }) {
            var instance = projectDocument.Create.NewFamilyInstance(position, symbol, level, StructuralType.NonStructural);
            _ = instance.get_Parameter(BuiltInParameter.ALL_MODEL_MARK)!.Set(mark);
            instanceIds.Add(instance.Id.Value());
        }

        schedule = ViewSchedule.CreateSchedule(projectDocument, new ElementId(BuiltInCategory.OST_MechanicalEquipment));
        schedule.Name = scheduleName;
        schedule.Definition.IsItemized = true;
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
