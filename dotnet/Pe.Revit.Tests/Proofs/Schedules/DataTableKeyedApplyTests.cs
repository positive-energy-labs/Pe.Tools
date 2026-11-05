using Pe.Revit.DocumentData.Schedules.DataTables;
using Pe.Shared.RevitData.Schedules;

namespace Pe.Revit.Tests;

/// <summary>
///     K3 native: the catalog plan resends every stored column at its slot and a touched row in full (catalog-work.ts
///     `deriveDataTable`). A heading edit keeps every column's pool parameter and values; a sparse row edit keeps the
///     other rows; the read reports each column's slot, the key the plan uses.
/// </summary>
[TestFixture]
public sealed class DataTableKeyedApplyTests {
    private const string TableName = "_PE_K3 Keyed";

    [Test]
    public void Resent_columns_keep_their_parameters_and_values_and_untouched_rows_survive(UIApplication uiApplication) {
        var document = RevitFamilyFixtureHarness.CreateProjectDocument(uiApplication.Application);
        try {
            DataTableHandle Apply(DataTableSpec spec) {
                using var t = new Transaction(document, "Apply keyed table");
                t.Start();
                var result = DataTableEngine.Apply(document, spec, []);
                Assert.That(t.Commit(), Is.EqualTo(TransactionStatus.Committed));
                return result.Table!;
            }
            var columns = new List<DataTableColumnSpec> {
                new("A"), new("B"), new("N") { Kind = DataTableColumnKind.Number }
            };
            var first = Apply(new DataTableSpec(TableName) {
                Columns = columns,
                Rows = [new DataTableRowSpec("r1") { Values = ["a1", "b1", "1"] }, new DataTableRowSpec("r2") { Values = ["a2", "b2", "2"] }]
            });
            Assert.That(first.Columns.Select(c => (c.Kind, c.Slot)), Is.EqualTo(new[] {
                (DataTableColumnKind.Text, 0), (DataTableColumnKind.Text, 1), (DataTableColumnKind.Number, 0)
            }), "the read reports each column's pool slot");

            // Heading edit on text:0, every column resent at its slot, no row sent.
            var renamed = Apply(new DataTableSpec(TableName) { Columns = [new("A2"), new("B"), new("N") { Kind = DataTableColumnKind.Number }] });
            Assert.Multiple(() => {
                Assert.That(renamed.Columns.Select(c => c.SharedParameterGuid), Is.EqualTo(first.Columns.Select(c => c.SharedParameterGuid)));
                Assert.That(renamed.Columns.Select(c => c.Heading), Is.EqualTo(new[] { "A2", "B", "N" }));
                Assert.That(renamed.Rows.Single(r => r.Key == "r1").Values, Is.EqualTo(first.Rows.Single(r => r.Key == "r1").Values));
                Assert.That(renamed.Rows.Single(r => r.Key == "r2").Values, Is.EqualTo(first.Rows.Single(r => r.Key == "r2").Values));
            });

            // Sparse cell r2/number:0 = 9: the plan resends r2 whole from the stored values; r1 is not sent.
            var sparse = Apply(new DataTableSpec(TableName) {
                Columns = [new("A2"), new("B"), new("N") { Kind = DataTableColumnKind.Number }],
                Rows = [new DataTableRowSpec("r2") { Values = ["a2", "b2", "9"] }]
            });
            Assert.Multiple(() => {
                Assert.That(sparse.Rows.Single(r => r.Key == "r1").Values, Is.EqualTo(first.Rows.Single(r => r.Key == "r1").Values), "an untouched row survives");
                Assert.That(sparse.Rows.Single(r => r.Key == "r2").Values[0], Is.EqualTo("a2"));
                Assert.That(sparse.Rows.Single(r => r.Key == "r2").ElementId, Is.EqualTo(first.Rows.Single(r => r.Key == "r2").ElementId), "upsert keeps row identity");
            });
        } finally {
            RevitFamilyFixtureHarness.CloseDocument(document);
        }
    }
}
