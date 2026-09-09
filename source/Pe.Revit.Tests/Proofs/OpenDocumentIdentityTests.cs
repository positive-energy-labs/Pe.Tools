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
            var id = tracked.OpenId();
            Assert.That(tracker.Find(document)!.OpenId(), Is.EqualTo(id));
            document.SaveAs(path);
            Assert.That(tracker.Find(document)!.OpenId(), Is.EqualTo(id));
            document.Close(false);
            document = null;
            Assert.That(() => tracked.OpenId(), Throws.TypeOf<ObjectDisposedException>());
            document = uiapp.Application.OpenDocumentFile(path);
            Assert.That(tracker.Find(document)!.OpenId(), Is.Not.EqualTo(id));
        } finally {
            document?.Close(false);
            if (File.Exists(path)) File.Delete(path);
        }
    }
}
