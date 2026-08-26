using Pe.Shared.HostContracts.Operations;

namespace Pe.Revit.Tests;

[TestFixture]
public sealed class BridgeOpRequestDeserializationTests {
    private sealed record ProbeRequest(string ScriptContent, int TimeoutSeconds);

    private sealed record ProbeResponse(string Echo);

    [Op("revit.detail.deserialization-probe", Does = "Exercise strict request deserialization.")]
    private static ProbeResponse Handle(ProbeRequest request) => new(request.ScriptContent);

    private static Op Probe() {
        OpRegistry.RegisterFrom(typeof(BridgeOpRequestDeserializationTests).Assembly);
        return OpRegistry.TryGet("revit.detail.deserialization-probe", out var op)
            ? op
            : throw new InvalidOperationException("Probe op was not discovered.");
    }

    [Test]
    public void A_string_field_sent_as_an_object_is_a_400_naming_op_type_and_field() {
        var exception = Assert.ThrowsAsync<BridgeOperationException>(() => Probe().ExecuteAsync(
            """{"timeoutSeconds":60,"scriptContent":{"Ast":"a powershell script block"}}""",
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
            CancellationToken.None
        ))!;

        Assert.That(exception.StatusCode, Is.EqualTo(BridgeOperationExceptions.BadRequestStatusCode));
    }

    [Test]
    public void A_null_payload_is_a_400_naming_the_expected_type() {
        var exception = Assert.ThrowsAsync<BridgeOperationException>(() => Probe().ExecuteAsync(
            "null",
            CancellationToken.None
        ))!;

        Assert.That(exception.StatusCode, Is.EqualTo(BridgeOperationExceptions.BadRequestStatusCode));
        Assert.That(exception.Message, Does.Contain(nameof(ProbeRequest)));
    }

    [Test]
    public async Task A_valid_multiline_script_payload_deserializes_and_executes() {
        var response = await Probe().ExecuteAsync(
            """{"timeoutSeconds":60,"scriptContent":"using System;\nvar x = 1;\nConsole.WriteLine(x);"}""",
            CancellationToken.None
        );

        Assert.That(((ProbeResponse)response!).Echo, Does.Contain("\nvar x = 1;\n"));
    }
}
