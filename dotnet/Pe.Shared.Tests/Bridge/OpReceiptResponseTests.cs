using Newtonsoft.Json.Linq;
using Pe.Shared.HostContracts.Bridge;

namespace Pe.Bridge.Tests;

/// <summary>
///     The receipt response file's bytes are a contract with the TS host. The TS twin
///     (agent-contracts <c>receipt-response.test.ts</c>) parses the same fixture.
/// </summary>
public class OpReceiptResponseTests {
    private static readonly ViewRef View = new("doc-a", "view-uid-1", 4001);

    private static readonly Dictionary<string, OpReceiptResponse> Cases = new() {
        ["ok-none"] = OpReceiptResponse.Ok(new JRaw("""{"views":[{"id":12}]}"""), new Touched.None()),
        ["ok-evidence-rolledBack"] = OpReceiptResponse.Ok(new JRaw("""{"count":3}"""), new Touched.RolledBack(),
            new JRaw("""{"documentKey":"doc-a","revision":41,"frame":"host-internal-ft"}""")),
        ["ok-evidence-no-revision"] = OpReceiptResponse.Ok(null, new Touched.None(), new JRaw("""{"documentKey":"doc-a"}""")),
        ["ok-evidence-null-revision"] = OpReceiptResponse.Ok(null, new Touched.None(),
            new JRaw("""{"documentKey":"doc-a","revision":null}""")),
        ["ok-restored"] = OpReceiptResponse.Ok(new JRaw("""{"path":"capture.png"}"""), new Touched.Restored([View])),
        ["ok-restoreFailed"] = OpReceiptResponse.Ok(new JRaw("""{"path":"capture.png"}"""), new Touched.RestoreFailed([
            new ViewLeft(View,
                [ViewLeftover.Crop, ViewLeftover.ScopeBox, ViewLeftover.AnnotationCrop, ViewLeftover.SheetFilter])
        ])),
        ["ok-wrote"] = OpReceiptResponse.Ok(new JRaw("""{"created":[9001]}"""), new Touched.Wrote(["PE place duct"], 1, 2, 0)),
        ["failed-unauthorized"] = OpReceiptResponse.Failed("A read committed a transaction.", 500,
            new Touched.Unauthorized(["Rogue commit"], 0, 5, 1)),
        ["cancelled-unknown"] = OpReceiptResponse.Failed("Revit task ended with 'cancelled' (CancelledMidEffect).", 499,
            new Touched.Unknown(TouchedUnknownReason.CancelledMidEffect), "CancelledMidEffect"),
        ["failed-lost-response"] = OpReceiptResponse.Failed("socket lost", 503, new Touched.Unknown(TouchedUnknownReason.LostResponse)),
        ["failed-process-exit"] = OpReceiptResponse.Failed("process ended", 503, new Touched.Unknown(TouchedUnknownReason.ProcessExit)),
        ["ok-unknown-overlapped"] = OpReceiptResponse.Ok(new JRaw("""{"count":3}"""), new Touched.Unknown(TouchedUnknownReason.Overlapped)),
        ["failed-posted-command"] = OpReceiptResponse.Failed("refused", 423, new Touched.Unknown(TouchedUnknownReason.PostedCommand)),
    };

    private static JObject Fixture() => JObject.Parse(File.ReadAllText(
        Path.Combine(AppContext.BaseDirectory, "receipt-response.fixture.json")));

    private static readonly Newtonsoft.Json.JsonSerializer Camel = Newtonsoft.Json.JsonSerializer.Create(new() {
        ContractResolver = new Newtonsoft.Json.Serialization.CamelCasePropertyNamesContractResolver()
    });

    // The only way from a fixture row to a response is a factory: a payload key is Ok, an error is Failed.
    private static OpReceiptResponse Build(JObject row) {
        var extra = row.Properties().Select(p => p.Name).Except(["payload", "touched", "evidence", "error", "statusCode", "outcome"]).ToList();
        if (extra.Count != 0) throw new FormatException($"Unknown field {extra[0]}");
        var touched = row["touched"]!.ToObject<Touched>(Camel)!;
        JRaw? Raw(string name) => row[name] is { } token ? new JRaw(token.ToString(Newtonsoft.Json.Formatting.None)) : null;
        if (row.ContainsKey("payload")) return OpReceiptResponse.Ok(Raw("payload"), touched, Raw("evidence"));
        return OpReceiptResponse.Failed(
            row.Value<string>("error") ?? throw new FormatException("Neither payload nor error"),
            row.Value<int?>("statusCode") ?? throw new FormatException("A failure states its status code"),
            touched, row.Value<string>("outcome"));
    }

    // Every `refused-` row is a shape the TS reader refuses. C# refuses each too: five in the contract
    // (Ok and the Touched constructors), three because no factory takes that shape. Mutant: drop the
    // Unauthorized throw in Ok and refused-success-unauthorized builds.
    [Test]
    public void No_refused_fixture_row_can_be_built_and_every_other_row_rebuilds_to_its_own_bytes() {
        foreach (var row in Fixture().Properties()) {
            if (row.Name.StartsWith("refused-"))
                Assert.That(() => Build((JObject)row.Value), Throws.Exception, row.Name);
            else
                Assert.That(JToken.DeepEquals(JToken.Parse(Build((JObject)row.Value).ToJson()), row.Value), Is.True, row.Name);
        }
    }

    [Test]
    public void Every_fixture_case_is_what_the_bridge_writes() {
        var fixture = Fixture();
        Assert.That(fixture.Properties().Select(row => row.Name).Where(name => !name.StartsWith("refused-")),
            Is.EquivalentTo(Cases.Keys));
        foreach (var (name, response) in Cases) {
            var written = JToken.Parse(response.ToJson());
            Assert.That(JToken.DeepEquals(written, fixture[name]), Is.True, $"{name}: {written}");
        }
    }

    // Mutant: drop the `?? new JRaw("null")` in Ok and the first assertion goes red (the key vanishes).
    [Test]
    public void A_response_is_a_success_with_its_payload_key_or_a_failure_with_its_status() {
        var empty = JObject.Parse(OpReceiptResponse.Ok(null, new Touched.None()).ToJson());
        Assert.Multiple(() => {
            Assert.That(empty.ContainsKey("payload"), Is.True, "refused-missing-payload cannot be written");
            Assert.That(empty.ContainsKey("error"), Is.False);
            Assert.That(() => OpReceiptResponse.Ok(null, new Touched.Unauthorized([], 0, 1, 0)), Throws.ArgumentException,
                "refused-success-unauthorized cannot be written");
            var failed = JObject.Parse(OpReceiptResponse.Failed("failed", 500, new Touched.None()).ToJson());
            Assert.That(failed.ContainsKey("payload"), Is.False);
            Assert.That(failed.Properties().Select(row => row.Name), Is.EquivalentTo(new[] { "touched", "error", "statusCode" }));
        });
    }

    // A bridge frame carries `touched` back into C# (BridgeTransportSession.ReadAsync). Mutant: remove
    // [JsonConverter(typeof(TouchedConverter))] and Newtonsoft cannot build the abstract record.
    [Test]
    public void Every_touched_the_fixture_names_reads_back_as_the_case_that_wrote_it() {
        var settings = new Newtonsoft.Json.JsonSerializerSettings {
            ContractResolver = new Newtonsoft.Json.Serialization.CamelCasePropertyNamesContractResolver(),
            NullValueHandling = Newtonsoft.Json.NullValueHandling.Ignore
        };
        foreach (var (name, response) in Cases) {
            var frame = new BridgeFrame(BridgeFrameKind.Response,
                Response: new BridgeResponse("r", true, null, null, null, null, null!, Touched: response.Touched));
            var wire = Newtonsoft.Json.JsonConvert.SerializeObject(frame, settings);
            var read = Newtonsoft.Json.JsonConvert.DeserializeObject<BridgeFrame>(wire, settings)!.Response!.Touched;
            Assert.That(read, Is.InstanceOf(response.Touched.GetType()), name);
            Assert.That(JToken.DeepEquals(JToken.FromObject(read!, Newtonsoft.Json.JsonSerializer.Create(settings)),
                Fixture()[name]!["touched"]), Is.True, $"{name}: {wire}");
        }
    }

    // Purger N4. Mutant: drop either `?? throw` in Failed and a null reaches the file as a missing key.
    [Test]
    public void A_factory_refuses_a_null_error_or_a_null_touched() => Assert.Multiple(() => {
        Assert.That(() => OpReceiptResponse.Failed(null!, 500, new Touched.None()), Throws.ArgumentNullException);
        Assert.That(() => OpReceiptResponse.Failed("failed", 500, null!), Throws.ArgumentNullException);
        Assert.That(() => OpReceiptResponse.Ok(null, null!), Throws.ArgumentNullException);
    });
}
