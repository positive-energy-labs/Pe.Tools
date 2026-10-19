using Autodesk.Revit.DB;
using Autodesk.Revit.UI;
using NUnit.Framework;
using Pe.Revit.Global.Services.Document;
using Pe.Revit.Loader.Documents;

namespace Pe.Revit.Tests.Proofs;

[TestFixture]
public class OpenDocumentIdentityTests {
    [Test]
    public void Open_identity_survives_saveas_but_not_close_and_reopen(UIApplication uiapp) {
        using var tracker = new DocumentTracker(uiapp);
        Document? document = uiapp.Application.NewProjectDocument(UnitSystem.Imperial);
        var path = Path.Combine(Path.GetTempPath(), $"pe-open-id-{Guid.NewGuid():N}.rvt");
        try {
            var tracked = tracker.Open.Single(item => item.Matches(document));
            var id = tracked.OpenId;
            // SDK beta.202: the bridge authority mints; this payload tracker carries the same id.
            Assert.That(PeDocumentIdentity.TryGetOpenId(document, out var authority), Is.True);
            Assert.That(authority, Is.EqualTo(id));
            Assert.That(tracker.FindOpenId(id), Is.SameAs(tracked));
            Assert.That(tracker.Find(document)!.OpenId, Is.EqualTo(id));
            document.SaveAs(path);
            Assert.That(tracker.Find(document)!.OpenId, Is.EqualTo(id));
            document.Close(false);
            document = null;
            // The retained id is history; current membership and dispatch reject it.
            Assert.That(tracker.FindOpenId(id), Is.Null);
            document = uiapp.Application.OpenDocumentFile(path);
            Assert.That(tracker.Find(document)!.OpenId, Is.Not.EqualTo(id));
            Assert.That(tracker.FindOpenId(id), Is.Null);
        } finally {
            document?.Close(false);
            if (File.Exists(path)) File.Delete(path);
        }
    }
}
