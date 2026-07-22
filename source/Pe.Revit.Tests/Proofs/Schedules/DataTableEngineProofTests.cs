using Pe.Revit.DocumentData.Schedules.DataTables;
using Pe.Shared.RevitData.Schedules;

namespace Pe.Revit.Tests;

/// <summary>
///     Proofs for the synthetic data-table primitive. These pin the Revit behaviors the engine
///     depends on: key-schedule body InsertRow creates collectable key elements, the key-name
///     parameter is writable and acts as the stable row key, pool shared parameters bind and
///     write per kind, and upsert preserves the element identity of surviving rows (the property
///     parameter-links and external UIs address rows by).
/// </summary>
[TestFixture]
public sealed class DataTableEngineProofTests {
    private const string TableName = "_PE_Proof Design Conditions";

    [Test]
    public void Data_table_apply_creates_key_schedule_with_stable_editable_rows(UIApplication uiApplication) {
        var projectDocument = RevitFamilyFixtureHarness.CreateProjectDocument(uiApplication.Application);
        try {
            var spec = new DataTableSpec(TableName) {
                Columns = [
                    new DataTableColumnSpec("Condition"),
                    new DataTableColumnSpec("Value (°F)") { Kind = DataTableColumnKind.Number },
                    new DataTableColumnSpec("Source")
                ],
                Rows = [
                    new DataTableRowSpec("cooling-db") { Values = ["Cooling Design DB", "94.1", "ASHRAE 2021"] },
                    new DataTableRowSpec("heating-db") { Values = ["Heating Design DB", "12.3", "ASHRAE 2021"] }
                ]
            };

            var first = ApplyInTransaction(projectDocument, spec);
            Assert.That(first.Table, Is.Not.Null);
            var schedule = (ViewSchedule)projectDocument.GetElement(first.Table!.ScheduleId.ToElementId());

            Assert.Multiple(() => {
                Assert.That(schedule.Definition.IsKeySchedule, Is.True);
                Assert.That(first.Table.Columns.Select(column => column.Heading),
                    Is.EqualTo(new[] { "Condition", "Source", "Value (°F)" }),
                    "Pool assignment groups Text columns before Number columns.");
                Assert.That(first.Table.Rows, Has.Count.EqualTo(2));
                Assert.That(first.Table.Rows.Select(row => row.Key),
                    Is.EquivalentTo(new[] { "cooling-db", "heating-db" }));
                Assert.That(first.Warnings, Is.Empty);
            });

            // Every cell parameter behind the table must be user-writable (IsReadOnly false) —
            // that is the whole point of the primitive.
            foreach (var row in first.Table.Rows) {
                var element = projectDocument.GetElement(row.ElementId.ToElementId());
                foreach (var column in first.Table.Columns) {
                    var parameter = element.LookupParameter(column.ParameterName);
                    Assert.That(parameter, Is.Not.Null, $"{row.Key}/{column.Heading}");
                    Assert.That(parameter!.IsReadOnly, Is.False, $"{row.Key}/{column.Heading}");
                }
            }

            // Upsert: change one value, add a row, prune the other. The surviving row keeps its
            // element identity — the stability contract parameter-links depends on.
            var survivorId = first.Table.Rows.Single(row => row.Key == "cooling-db").ElementId;
            var second = ApplyInTransaction(projectDocument, spec with {
                Rows = [
                    new DataTableRowSpec("cooling-db") { Values = ["Cooling Design DB", "95.0", "ASHRAE 2025"] },
                    new DataTableRowSpec("cooling-wb") { Values = ["Cooling Design WB", "78.2", "ASHRAE 2025"] }
                ],
                PruneMissingRows = true
            });

            Assert.Multiple(() => {
                Assert.That(second.Table!.ScheduleId, Is.EqualTo(first.Table.ScheduleId));
                Assert.That(second.Table.Rows.Select(row => row.Key),
                    Is.EquivalentTo(new[] { "cooling-db", "cooling-wb" }));
                Assert.That(second.Table.Rows.Single(row => row.Key == "cooling-db").ElementId,
                    Is.EqualTo(survivorId));
                Assert.That(second.Table.Rows.Single(row => row.Key == "cooling-db").Values,
                    Does.Contain("95"));
            });

            // Detail read sees exactly this one table.
            var detail = DataTableEngine.CollectAll(projectDocument, new DataTableDetailRequest());
            Assert.That(detail.Tables.Select(table => table.Name), Is.EqualTo(new[] { TableName }));

            // Placement on a sheet is idempotent.
            using (var transaction = new Transaction(projectDocument, "Place data table")) {
                _ = transaction.Start();
                var sheet = ViewSheet.Create(projectDocument, ElementId.InvalidElementId);
                sheet.SheetNumber = "M-001";
                var schedule2 = DataTableEngine.FindDataTableSchedule(projectDocument, TableName)!;
                var placed = DataTableEngine.Place(projectDocument, schedule2, new ScheduleSheetPlacementSpec("M-001"));
                var placedAgain = DataTableEngine.Place(projectDocument, schedule2, new ScheduleSheetPlacementSpec("M-001"));
                Assert.That(placedAgain.SheetId, Is.EqualTo(placed.SheetId));
                _ = transaction.Commit();
            }

            var placedDetail = DataTableEngine.CollectAll(projectDocument, new DataTableDetailRequest());
            Assert.That(placedDetail.Tables.Single().Placements.Single().SheetNumber, Is.EqualTo("M-001"));
        } finally {
            RevitFamilyFixtureHarness.CloseDocument(projectDocument);
        }
    }

    [Test]
    public void Data_table_apply_rejects_invalid_specs(UIApplication uiApplication) {
        var projectDocument = RevitFamilyFixtureHarness.CreateProjectDocument(uiApplication.Application);
        try {
            Assert.Multiple(() => {
                _ = Assert.Throws<ArgumentException>(() =>
                    ApplyInTransaction(projectDocument, new DataTableSpec("No Columns")));
                _ = Assert.Throws<ArgumentException>(() =>
                    ApplyInTransaction(projectDocument, new DataTableSpec("Dup Keys") {
                        Columns = [new DataTableColumnSpec("A")],
                        Rows = [new DataTableRowSpec("k"), new DataTableRowSpec("k")]
                    }));
                _ = Assert.Throws<ArgumentException>(() =>
                    ApplyInTransaction(projectDocument, new DataTableSpec("Pool Overflow") {
                        Columns = Enumerable.Range(0, 9)
                            .Select(i => new DataTableColumnSpec($"T{i}"))
                            .ToList()
                    }));
            });
        } finally {
            RevitFamilyFixtureHarness.CloseDocument(projectDocument);
        }
    }

    private static ScheduleApplyData ApplyInTransaction(Document document, DataTableSpec spec) {
        using var transaction = new Transaction(document, $"Apply data table '{spec.Name}'");
        _ = transaction.Start();
        try {
            var result = DataTableEngine.Apply(document, spec, []);
            _ = transaction.Commit();
            return result;
        } catch {
            _ = transaction.RollBack();
            throw;
        }
    }
}
