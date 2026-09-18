using Pe.Shared.HostContracts.Operations;

namespace Pe.Revit.Tests;

[TestFixture]
public sealed class BridgeOpRequestDeserializationTests {
    private sealed record ProbeRequest(string ScriptContent, int TimeoutSeconds);

    private sealed record ProbeResponse(string Echo);

    [Op("revit.detail.deserialization-probe", Does = "Exercise strict request deserialization.")]
    private static ProbeResponse Handle(ProbeRequest request) => new(request.ScriptContent);

    [Op("revit.detail.schedule-source-probe", Does = "Bind the real schedule.apply request.")]
    private static ProbeResponse HandleSchedule(ScheduleSpecApplyRequest request) => new(request.Source.Root.Id);

    [Op("revit.detail.family-source-probe", Does = "Bind the real family.apply request.")]
    private static ProbeResponse HandleFamily(FamilyApplyRequest request) => new(request.Source.Root.Id);

    private static Op Probe(string key = "revit.detail.deserialization-probe") {
        OpRegistry.RegisterFrom(typeof(BridgeOpRequestDeserializationTests).Assembly);
        return OpRegistry.TryGet(key, out var op)
            ? op
            : throw new InvalidOperationException("Probe op was not discovered.");
    }

    [Test]
    public void A_string_field_sent_as_an_object_is_a_400_naming_op_type_and_field() {
        var exception = Assert.ThrowsAsync<BridgeOperationException>(() => Probe().ExecuteAsync(
            """{"timeoutSeconds":60,"scriptContent":{"Ast":"a powershell script block"}}""",
            null,
            CancellationToken.None
        ))!;

        Assert.That(exception.StatusCode, Is.EqualTo(BridgeOperationExceptions.BadRequestStatusCode));
        Assert.That(exception.Message, Does.Contain("revit.detail.deserialization-probe"));
        Assert.That(exception.Message, Does.Contain(nameof(ProbeRequest)));
        Assert.That(exception.Message, Does.Contain("scriptContent"));
    }

    [Test]
    public void Malformed_json_is_a_400_not_a_500() {
        var exception = Assert.ThrowsAsync<BridgeOperationException>(() => Probe().ExecuteAsync(
            "{\"scriptContent\": \"unterminated",
            null,
            CancellationToken.None
        ))!;

        Assert.That(exception.StatusCode, Is.EqualTo(BridgeOperationExceptions.BadRequestStatusCode));
    }

    [Test]
    public void A_null_payload_is_a_400_naming_the_expected_type() {
        var exception = Assert.ThrowsAsync<BridgeOperationException>(() => Probe().ExecuteAsync(
            "null",
            null,
            CancellationToken.None
        ))!;

        Assert.That(exception.StatusCode, Is.EqualTo(BridgeOperationExceptions.BadRequestStatusCode));
        Assert.That(exception.Message, Does.Contain(nameof(ProbeRequest)));
    }

    [Test]
    public async Task A_valid_multiline_script_payload_deserializes_and_executes() {
        var response = await Probe().ExecuteAsync(
            """{"timeoutSeconds":60,"scriptContent":"using System;\nvar x = 1;\nConsole.WriteLine(x);"}""",
            null,
            CancellationToken.None
        );

        Assert.That(((ProbeResponse)response!).Echo, Does.Contain("\nvar x = 1;\n"));
    }

    // The pre-composition shape `{pod, path, sha256}` must not bind to a source whose root is null.
    [TestCase("revit.detail.schedule-source-probe", """{"specJson":"{}","source":{"pod":"office","path":"settings/a.json","sha256":"abc"}}""")]
    [TestCase("revit.detail.family-source-probe", """{"specJson":"{}","expectedPlanHashes":{},"source":{"pod":"office","path":"settings/a.json","sha256":"abc"}}""")]
    [TestCase("revit.detail.schedule-source-probe", """{"specJson":"{}","source":{"root":{"id":"office","path":"settings/a.json","sha256":"abc","origin":"SavedMember"},"dependencies":[]}}""")]
    public void An_apply_source_without_captured_bytes_is_a_400_before_any_handler(string key, string payload) {
        var exception = Assert.ThrowsAsync<BridgeOperationException>(() => Probe(key).ExecuteAsync(payload, null, CancellationToken.None))!;

        Assert.That(exception.StatusCode, Is.EqualTo(BridgeOperationExceptions.BadRequestStatusCode));
        Assert.That(exception.Message, Does.Contain("Required property"));
    }

    [Test]
    public async Task A_captured_source_binds() {
        var response = await Probe("revit.detail.schedule-source-probe").ExecuteAsync(
            """{"specJson":"{}","source":{"root":{"id":"office","path":"settings/a.json","sha256":"abc","bytesBase64":"e30=","origin":"SavedMember"},"dependencies":[]}}""",
            null,
            CancellationToken.None);

        Assert.That(((ProbeResponse)response!).Echo, Is.EqualTo("office"));
    }
}
