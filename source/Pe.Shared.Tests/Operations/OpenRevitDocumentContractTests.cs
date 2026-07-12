using Newtonsoft.Json.Linq;
using Pe.Shared.HostContracts.Operations;
using Pe.Shared.RevitData;

namespace Pe.Revit.Tests;

/// <summary>
///     Wire-level contract coverage for the worksharing-detach open options: the transport
///     JSON round-trips through the same BridgeOp deserialization path Revit uses, and the
///     /ops schemas advertise the new fields.
/// </summary>
[TestFixture]
public sealed class OpenRevitDocumentContractTests {
    private static Task<OpenRevitDocumentRequest> DeserializeThroughBridgeOp(string payloadJson) {
        var captured = new TaskCompletionSource<OpenRevitDocumentRequest>();
        var op = BridgeOp.Create<OpenRevitDocumentRequest, OpenRevitDocumentData>(
            "revit.apply.document.open",
            "Probe",
            null,
            (request, _, _) => {
                captured.SetResult(request);
                return Task.FromResult<OpenRevitDocumentData>(null!);
            }
        );
        _ = op.ExecuteAsync(payloadJson, null!, CancellationToken.None);
        return captured.Task;
    }

    [Test]
    public async Task Detach_defaults_to_DoNotDetach_when_omitted() {
        var request = await DeserializeThroughBridgeOp("""{ "path": "C:/Models/Project.rvt" }""");

        Assert.That(request.Detach, Is.EqualTo(WorksharingDetachOption.DoNotDetach));
        Assert.That(request.RequestsDetach(), Is.False);
    }

    [Test]
    public async Task Detach_deserializes_from_the_enum_string_name() {
        var preserve = await DeserializeThroughBridgeOp(
            """{ "path": "C:/Models/Project.rvt", "detach": "DetachAndPreserveWorksets" }"""
        );
        Assert.That(preserve.Detach, Is.EqualTo(WorksharingDetachOption.DetachAndPreserveWorksets));
        Assert.That(preserve.RequestsDetach(), Is.True);

        var discard = await DeserializeThroughBridgeOp(
            """{ "path": "C:/Models/Project.rvt", "detach": "DetachAndDiscardWorksets" }"""
        );
        Assert.That(discard.Detach, Is.EqualTo(WorksharingDetachOption.DetachAndDiscardWorksets));
    }

    [Test]
    public void Request_schema_advertises_detach_options_as_strings() {
        var schemaJson = BridgeOpSchemaGenerator.GetRequestSchemaJson(typeof(OpenRevitDocumentRequest));
        var schema = JObject.Parse(schemaJson);

        Assert.That(schema.SelectToken("$.properties.detach"), Is.Not.Null);
        Assert.That(schemaJson, Does.Contain("DoNotDetach"));
        Assert.That(schemaJson, Does.Contain("DetachAndPreserveWorksets"));
        Assert.That(schemaJson, Does.Contain("DetachAndDiscardWorksets"));
    }

    [Test]
    public void Response_schema_marks_isDetached_required() {
        var schema = JObject.Parse(BridgeOpSchemaGenerator.GetResponseSchemaJson(typeof(OpenRevitDocumentData)));

        Assert.That(schema.SelectToken("$.properties.isDetached"), Is.Not.Null);
        var required = schema["required"]!.Select(token => (string)token!).ToArray();
        Assert.That(required, Does.Contain("isDetached"));
    }
}
