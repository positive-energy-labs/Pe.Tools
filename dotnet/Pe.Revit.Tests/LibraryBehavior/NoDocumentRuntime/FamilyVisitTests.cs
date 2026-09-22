using Pe.Revit.Extensions.FamDocument;

namespace Pe.Revit.Tests.LibraryBehavior.NoDocumentRuntime;

[TestFixture]
public sealed class FamilyVisitTests {
    [Test]
    public void Load_failure_text_keeps_the_old_text_without_messages_and_lists_distinct_messages_in_order() {
        Assert.That(FamilyDocumentProcessFamily.LoadFailureText([]), Is.EqualTo("Family loading failed."));
        Assert.That(FamilyDocumentProcessFamily.LoadFailureText(["The Tap must be attached to duct.", "The connector is invalid.", "The Tap must be attached to duct."]),
            Is.EqualTo("Family loading failed: The Tap must be attached to duct.; The connector is invalid."));
    }
}
