using Pe.Shared.HostContracts.Operations;
using Pe.Shared.RevitData.Schedules;

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

    [Op("revit.detail.schedule-cells-probe", Does = "Bind the real schedule.cells.apply request.")]
    private static ProbeResponse HandleCells(ScheduleCellApplyRequest request) =>
        new(string.Join(",", request.Edits.SelectMany(edit => edit.ExpectedBinding.Targets).Select(target => $"{target.ParameterId}:{target.HasValue}:{target.RawValue ?? "null"}")));

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

    private const string CellTarget = """{"elementId":7,"parameterId":-1001203,"parameterName":"Mark","storageType":"String","isReadOnly":false,"hasValue":true,"rawValue":"A"}""";

    private static string CellRequest(string target) =>
        $$$"""{"scheduleId":1,"scheduleUniqueId":"u","edits":[{"rowNumber":3,"columnNumber":0,"value":"B","expectedBinding":{"columnNumber":0,"targetElementIds":[7],"parameterName":"Mark","parameterId":-1001203,"storageType":"String","rawValue":"A","displayValue":"A","isTypeParameter":false,"isEditable":true,"targets":[{{{target}}}]}}]}""";

    // Old captures lack per-target evidence; a missing field must refuse, never default to 0/false/absent.
    [TestCase("parameterId")]
    [TestCase("hasValue")]
    [TestCase("rawValue")]
    [TestCase("elementId")]
    [TestCase("storageType")]
    [TestCase("isReadOnly")]
    public void A_reviewed_cell_target_missing_evidence_is_a_400(string field) {
        var target = Newtonsoft.Json.Linq.JObject.Parse(CellTarget);
        target.Remove(field);
        var exception = Assert.ThrowsAsync<BridgeOperationException>(() => Probe("revit.detail.schedule-cells-probe")
            .ExecuteAsync(CellRequest(target.ToString(Newtonsoft.Json.Formatting.None)), null, CancellationToken.None))!;

        Assert.That(exception.StatusCode, Is.EqualTo(BridgeOperationExceptions.BadRequestStatusCode));
        Assert.That(exception.Message, Does.Contain(field));
    }

    [Test]
    public void A_reviewed_cell_without_targets_is_a_400() {
        var exception = Assert.ThrowsAsync<BridgeOperationException>(() => Probe("revit.detail.schedule-cells-probe")
            .ExecuteAsync(CellRequest(CellTarget).Replace($",\"targets\":[{CellTarget}]", ""), null, CancellationToken.None))!;

        Assert.That(exception.Message, Does.Contain("targets"));
    }

    [Test]
    public async Task A_complete_reviewed_cell_binds_with_a_null_raw_value() {
        var response = await Probe("revit.detail.schedule-cells-probe").ExecuteAsync(
            CellRequest(CellTarget.Replace("\"rawValue\":\"A\"", "\"rawValue\":null").Replace("\"hasValue\":true", "\"hasValue\":false")),
            null, CancellationToken.None);

        Assert.That(((ProbeResponse)response!).Echo, Is.EqualTo("-1001203:False:null"));
    }

    // The bridge serializes responses with NullValueHandling.Ignore; a reading's unset target must still
    // carry `rawValue: null`, or the host would echo back evidence the apply edge refuses.
    [Test]
    public async Task An_unset_target_read_from_a_response_round_trips_into_a_reviewed_cell() {
        var response = Newtonsoft.Json.JsonConvert.SerializeObject(
            new ScheduleCellBindingTarget(7, -1001203, "Mark", Pe.Shared.RevitData.RequestedParameterStorageType.String, false, false, null),
            new Newtonsoft.Json.JsonSerializerSettings {
                NullValueHandling = Newtonsoft.Json.NullValueHandling.Ignore,
                ContractResolver = new Newtonsoft.Json.Serialization.DefaultContractResolver {
                    NamingStrategy = new Newtonsoft.Json.Serialization.CamelCaseNamingStrategy { ProcessDictionaryKeys = false, OverrideSpecifiedNames = false }
                },
                Converters = [new Newtonsoft.Json.Converters.StringEnumConverter()]
            });

        Assert.That(response, Does.Contain("\"rawValue\":null"));
        var bound = await Probe("revit.detail.schedule-cells-probe").ExecuteAsync(CellRequest(response), null, CancellationToken.None);
        Assert.That(((ProbeResponse)bound!).Echo, Is.EqualTo("-1001203:False:null"));
    }
}
