using Pe.Shared.RevitData;

namespace Pe.Revit.Tests;

[TestFixture]
public sealed class OpenRevitDocumentRequestTests {
    [Test]
    public void Classifies_local_cloud_and_empty_targets() {
        var local = new OpenRevitDocumentRequest(Path: "C:/Models/Project.rvt");
        var cloud = new OpenRevitDocumentRequest(
            CloudProjectGuid: "11111111-1111-1111-1111-111111111111",
            CloudModelGuid: "22222222-2222-2222-2222-222222222222");
        var cloudMissingModel = new OpenRevitDocumentRequest(
            CloudProjectGuid: "11111111-1111-1111-1111-111111111111");
        var empty = new OpenRevitDocumentRequest();

        Assert.Multiple(() => {
            Assert.That(local.HasLocalPath(), Is.True);
            Assert.That(local.HasCloudTarget(), Is.False);

            Assert.That(cloud.HasCloudTarget(), Is.True);
            Assert.That(cloud.HasLocalPath(), Is.False);

            // Both GUIDs are required for a cloud target; region alone or one GUID is not enough.
            Assert.That(cloudMissingModel.HasCloudTarget(), Is.False);

            Assert.That(empty.HasLocalPath(), Is.False);
            Assert.That(empty.HasCloudTarget(), Is.False);
        });
    }
}
