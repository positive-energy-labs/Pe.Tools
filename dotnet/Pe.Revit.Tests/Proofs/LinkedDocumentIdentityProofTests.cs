using System.IO;
using Pe.Revit.Extensions.ProjDocument;

namespace Pe.Revit.Tests;

/// <summary>Loaded workshared links keep their file identity across placements and host reopen.</summary>
public sealed class LinkedDocumentIdentityProofTests {
    [Test]
    public void WorksharedLinkUsesItsResolvedPathAcrossPlacementsAndReopen(UIApplication uiApplication) {
        var directory = Path.Combine(Path.GetTempPath(), "pe-link-identity-" + Guid.NewGuid().ToString("N"));
        Directory.CreateDirectory(directory);
        var sourcePath = Path.Combine(directory, "source.rvt");
        var hostPath = Path.Combine(directory, "host.rvt");
        Document? source = null, host = null;
        try {
            source = RevitFamilyFixtureHarness.CreateProjectDocument(uiApplication.Application);
            source.EnableWorksharing("Shared Levels and Grids", "Workset1");
            using (var options = new SaveAsOptions()) {
                using var worksharing = new WorksharingSaveAsOptions { SaveAsCentral = true };
                options.SetWorksharingOptions(worksharing);
                source.SaveAs(sourcePath, options);
            }
            source.Close(false);
            source = null;
            host = RevitFamilyFixtureHarness.CreateProjectDocument(uiApplication.Application);
            long firstId, secondId;
            using (var transaction = new Transaction(host, "Place one workshared source twice")) {
                transaction.Start();
                using var options = new RevitLinkOptions(false);
                using var path = ModelPathUtils.ConvertUserVisiblePathToModelPath(sourcePath);
                var loaded = RevitLinkType.Create(host, path, options);
                var first = RevitLinkInstance.Create(host, loaded.ElementId);
                var second = RevitLinkInstance.Create(host, loaded.ElementId);
                ElementTransformUtils.MoveElement(host, second.Id, new XYZ(10, 0, 0));
                firstId = first.Id.Value();
                secondId = second.Id.Value();
                transaction.Commit();
            }
            string ReadKey(long id) {
                var linked = ((RevitLinkInstance)host.GetElement(id.ToElementId())).GetLinkDocument()!;
                Assert.That(linked.IsWorkshared, Is.True);
                Assert.That(linked.PathName, Is.EqualTo(sourcePath));
                Assert.That(linked.GetDocumentPath(), Is.EqualTo(sourcePath),
                    "An empty central model path must not hide the loaded document's valid PathName.");
                Assert.That(linked.IsModified, Is.False);
                return linked.GetDocumentKey();
            }
            var key = ReadKey(firstId);
            Assert.That(key, Is.EqualTo("project:path:" + sourcePath));
            Assert.That(ReadKey(secondId), Is.EqualTo(key), "The document key identifies the source; instance ids identify its placements.");
            host.SaveAs(hostPath);
            host.Close(false);
            host = null;
            host = uiApplication.Application.OpenDocumentFile(hostPath);
            Assert.That(ReadKey(firstId), Is.EqualTo(key));
            Assert.That(ReadKey(secondId), Is.EqualTo(key));
            Assert.That(host.IsModified, Is.False);
        } finally {
            host?.Close(false);
            source?.Close(false);
            if (Directory.Exists(directory)) Directory.Delete(directory, true);
        }
    }
}
