using Newtonsoft.Json.Linq;
using Pe.Revit.Global.Services.Host;
using Pe.Revit.Parameters;
using Pe.Shared.RevitData.Serialization;

namespace Pe.Revit.Tests;

[TestFixture]
public class BridgeProjectHomeTests {
    [Test] public void Model_with_pointer_sends_project_home(UIApplication uiApplication) => Model(uiApplication, true);
    [Test] public void Model_without_pointer_sends_null_project_home(UIApplication uiApplication) => Model(uiApplication, false);

    private static void Model(UIApplication uiApplication, bool hasPointer) {
        var document = RevitFamilyFixtureHarness.CreateProjectDocument(uiApplication.Application);
        try {
            if (hasPointer) {
                using var transaction = new Transaction(document, "Test pointer");
                transaction.Start();
                OwnerBlobStore.Write(document, ProjectHomePointer.Owner, ProjectHomePointer.Create("Projects/Test").Pointer!.ToData());
                transaction.Commit();
            }
            AssertPointer(document, hasPointer ? "Projects/Test" : null);
        } finally { RevitFamilyFixtureHarness.CloseDocument(document); }
    }

    [Test]
    public void Family_snapshot_sends_null_project_home(UIApplication uiApplication) {
        var document = RevitFamilyFixtureHarness.CreateFamilyDocument(uiApplication.Application, BuiltInCategory.OST_GenericModel, "Pointer fixture");
        try { AssertPointer(document, null); }
        finally { RevitFamilyFixtureHarness.CloseDocument(document); }
    }

    private static void AssertPointer(Document document, string? expected) {
        var json = JObject.FromObject(BridgeAgent.CaptureDocument(document, "test-open", false),
            Newtonsoft.Json.JsonSerializer.Create(new Newtonsoft.Json.JsonSerializerSettings {
                ContractResolver = new Newtonsoft.Json.Serialization.CamelCasePropertyNamesContractResolver(),
                NullValueHandling = Newtonsoft.Json.NullValueHandling.Ignore
            }));
        Assert.That(json.ContainsKey("projectHome"), Is.True, "Wire must carry projectHome, including an explicit null");
        Assert.That(json.Value<string>("projectHome"), Is.EqualTo(expected));
    }
}
