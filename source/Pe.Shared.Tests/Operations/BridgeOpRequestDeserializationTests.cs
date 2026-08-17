using Pe.Shared.HostContracts.Operations;

namespace Pe.Revit.Tests;

/// <summary>
///     A payload that doesn't match the request type is a client error: BridgeOp must answer 400
///     naming the op, the expected type, and the offending field — never leak a raw Newtonsoft
///     parse failure as a 500. Field-observed: PowerShell clients sending a script block (an
///     object) where scriptContent (a string) is expected.
/// </summary>
[TestFixture]
public sealed class BridgeOpRequestDeserializationTests {
    private sealed record ProbeRequest(string ScriptContent, int TimeoutSeconds);

    private sealed record ProbeResponse(string Echo);

    private static BridgeOp Probe() => BridgeOp.Create<ProbeRequest, ProbeResponse>(
        "revit.detail.deserialization-probe",
        "Deserialization Probe",
        null,
        static (request, _, _) => Task.FromResult(new ProbeResponse(request.ScriptContent))
    );

    [Test]
    public void A_string_field_sent_as_an_object_is_a_400_naming_op_type_and_field() {
        var exception = Assert.ThrowsAsync<BridgeOperationException>(() => Probe().ExecuteAsync(
            """{"timeoutSeconds":60,"scriptContent":{"Ast":"a powershell script block"}}""",
            null!,
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
            """{"scriptContent": "unterminated""",
            null!,
            CancellationToken.None
        ))!;

        Assert.That(exception.StatusCode, Is.EqualTo(BridgeOperationExceptions.BadRequestStatusCode));
    }

    [Test]
    public void A_null_payload_is_a_400_naming_the_expected_type() {
        var exception = Assert.ThrowsAsync<BridgeOperationException>(() => Probe().ExecuteAsync(
            "null",
            null!,
            CancellationToken.None
        ))!;

        Assert.That(exception.StatusCode, Is.EqualTo(BridgeOperationExceptions.BadRequestStatusCode));
        Assert.That(exception.Message, Does.Contain(nameof(ProbeRequest)));
    }

    [Test]
    public async Task A_valid_multiline_script_payload_deserializes_and_executes() {
        var response = await Probe().ExecuteAsync(
            """{"timeoutSeconds":60,"scriptContent":"using System;\nvar x = 1;\nConsole.WriteLine(x);"}""",
            null!,
            CancellationToken.None
        );

        Assert.That(((ProbeResponse)response!).Echo, Does.Contain("\nvar x = 1;\n"));
    }
}
