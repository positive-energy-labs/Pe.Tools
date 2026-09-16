using System.Text;
using Newtonsoft.Json.Linq;
using Pe.App.Pods;
using Pe.Revit.FamilyFoundry.Reconcile;
using Pe.Revit.Scripting.Pods;
using Pe.Shared.RevitData.Families;
using Pe.Shared.Scripting.Pods;

namespace Pe.Revit.Tests;

[TestFixture]
public sealed class PortablePodConsumerTests {
    [Test]
    public void Batch_members_come_from_the_same_snapshot_and_missing_members_do_not_fall_back() {
        var manifest = PodManifestValidator.ValidateJson("""{"schemaVersion":2,"id":"sample","name":"Sample","version":"1"}""").Manifest!;
        var files = new Dictionary<string, PreparedPodFile> {
            ["settings/batch.batch.json"] = new("settings/batch.batch.json", Encoding.UTF8.GetBytes("{}"), "file-a"),
            ["settings/one.schedule.json"] = new("settings/one.schedule.json", Encoding.UTF8.GetBytes("{}"), "file-b")
        };
        var composed = new Dictionary<string, PodComposedDocument> {
            ["composed/batch.batch.json"] = new("composed/batch.batch.json", "{}", []),
            ["composed/one.schedule.json"] = new("composed/one.schedule.json", "{\"Name\":\"Original\"}", [])
        };
        var snapshot = new PreparedPod(manifest, "snapshot", files, composed, [], []) { ReleaseHash = "verified-release" };
        var batch = PreparedPodSettingsCatalog.Project(snapshot, Path.GetTempPath(), [".batch.json"]).Single();
        var member = batch.Member("settings/one.schedule.json");
        Assert.That(member.Snapshot, Is.SameAs(snapshot));
        Assert.That(member.ReleaseHash, Is.EqualTo("verified-release"));
        Assert.That(member.ComposedContent, Does.Contain("Original"));
        Assert.Throws<InvalidDataException>(() => batch.Member("settings/missing.schedule.json"));
    }

    [Test]
    public void Pod_shared_parameters_cannot_use_embedded_definitions_without_declared_APS_authority() {
        using var source = new FamilySharedParameterSource(null!, requireDeclaration: true);
        var authored = JObject.Parse("""{"parameters":{"Test":{"shared":true,"sharedGuid":"f7cb211b-b1b9-4c7b-9f72-63cc60f9797f","sharedSpecId":"autodesk.spec.aec:string.text-2.0.0"}}}""");
        var model = new FamilyModel { Parameters = authored["parameters"]!.ToObject<Dictionary<string, FamilyModelParameter>>()! };
        var error = Assert.Throws<InvalidOperationException>(() => source.Resolve(model, authored));
        Assert.That(error!.Message, Does.Contain("require an aps.parameters declaration"));
    }
}
