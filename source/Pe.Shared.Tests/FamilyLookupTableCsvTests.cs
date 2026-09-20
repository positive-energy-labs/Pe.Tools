using Pe.Shared.RevitData.Families;

namespace Pe.Shared.Tests;

/// <summary>An authored size table and Revit's export of the same table are one table; a different table is not.</summary>
public sealed class FamilyLookupTableCsvTests {
    private const string Header = ",Key##length##feet,Out##number##general,Label##other##";
    // Exact spelling Revit exported at exec-guid PRE 593aa0c: CRLF rows, six-decimal numbers.
    private const string Captured = Header + "\r\nr1,1.000000,10.000000,one\r\nr2,2.000000,20.000000,two\r\n";

    [Test]
    public void Line_endings_do_not_change_the_table() =>
        Assert.That(FamilyLookupTableCsv.Same(Header + "\nr1,1.000000,10.000000,one\nr2,2.000000,20.000000,two\n", Captured), Is.True);

    [Test]
    public void Number_spelling_does_not_change_the_table() =>
        Assert.That(FamilyLookupTableCsv.Same(Header + "\r\nr1,1,10,one\r\nr2,2,20.0,two\r\n", Captured), Is.True);

    [Test]
    public void Authored_corpus_spelling_matches_the_capture() =>
        Assert.That(FamilyLookupTableCsv.Same(Header + "\nr1,1,10,one\nr2,2,20,two\n", Captured), Is.True);

    [TestCase(Header + "\r\nr1,1.000000,10.000001,one\r\nr2,2.000000,20.000000,two\r\n", TestName = "Value_change_is_a_change")]
    [TestCase(Header + "\r\nr1,1.000000,10.000000,One\r\nr2,2.000000,20.000000,two\r\n", TestName = "Text_cell_is_compared_as_text")]
    [TestCase(Header + "\r\nr2,2.000000,20.000000,two\r\nr1,1.000000,10.000000,one\r\n", TestName = "Row_order_is_a_change")]
    [TestCase(Header + "\r\nr1,1.000000,10.000000,one\r\n", TestName = "Missing_row_is_a_change")]
    [TestCase(Header + "\r\nr9,1.000000,10.000000,one\r\nr2,2.000000,20.000000,two\r\n", TestName = "Row_name_change_is_a_change")]
    [TestCase(",Key##length##inches,Out##number##general,Label##other##\r\nr1,1.000000,10.000000,one\r\nr2,2.000000,20.000000,two\r\n", TestName = "Unit_change_is_a_change")]
    [TestCase(",Key##length##feet,Result##number##general,Label##other##\r\nr1,1.000000,10.000000,one\r\nr2,2.000000,20.000000,two\r\n", TestName = "Header_name_change_is_a_change")]
    [TestCase(",Key##length##feet,Out##number##general,Label##number##general\r\nr1,1.000000,10.000000,one\r\nr2,2.000000,20.000000,two\r\n", TestName = "Column_type_change_is_a_change")]
    public void Different_table_is_a_change(string authored) =>
        Assert.That(FamilyLookupTableCsv.Same(authored, Captured), Is.False);

    [Test]
    public void Text_columns_do_not_compare_numerically() {
        const string text = ",Code##other##";
        Assert.That(FamilyLookupTableCsv.Same(text + "\nr1,1\n", text + "\r\nr1,1.000000\r\n"), Is.False);
    }
}
