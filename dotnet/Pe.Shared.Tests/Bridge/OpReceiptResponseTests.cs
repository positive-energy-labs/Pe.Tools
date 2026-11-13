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
        ["ok-none"] = new(new JRaw("""{"views":[{"id":12}]}"""), new Touched.None()),
        ["ok-evidence-rolledBack"] = new(new JRaw("""{"count":3}"""), new Touched.RolledBack(),
            new JRaw("""{"documentKey":"doc-a","revision":41,"frame":"host-internal-ft"}""")),
        ["ok-evidence-no-revision"] = new(new JRaw("null"), new Touched.None(), new JRaw("""{"documentKey":"doc-a"}""")),
        ["ok-restored"] = new(new JRaw("""{"path":"capture.png"}"""), new Touched.Restored([View])),
        ["ok-restoreFailed"] = new(new JRaw("""{"path":"capture.png"}"""), new Touched.RestoreFailed([
            new ViewLeft(View,
                [ViewLeftover.Crop, ViewLeftover.ScopeBox, ViewLeftover.AnnotationCrop, ViewLeftover.SheetFilter])
        ])),
        ["ok-wrote"] = new(new JRaw("""{"created":[9001]}"""), new Touched.Wrote(["PE place duct"], 1, 2, 0)),
        ["failed-unauthorized"] = new(null, new Touched.Unauthorized(["Rogue commit"], 0, 5, 1),
            Error: "A read committed a transaction.", StatusCode: 500),
        ["cancelled-unknown"] = new(null, new Touched.Unknown(TouchedUnknownReason.CancelledMidEffect),
            Error: "Revit task ended with 'cancelled' (CancelledMidEffect).", StatusCode: 499,
            Outcome: "CancelledMidEffect"),
        ["failed-posted-command"] = new(null, new Touched.Unknown(TouchedUnknownReason.PostedCommand),
            Error: "refused", StatusCode: 423),
    };

    [Test]
    public void Every_fixture_case_is_what_the_bridge_writes() {
        var fixture = JObject.Parse(File.ReadAllText(
            Path.Combine(AppContext.BaseDirectory, "receipt-response.fixture.json")));
        Assert.That(fixture.Properties().Select(row => row.Name), Is.EquivalentTo(Cases.Keys));
        foreach (var (name, response) in Cases) {
            var written = JToken.Parse(response.ToJson());
            Assert.That(JToken.DeepEquals(written, fixture[name]), Is.True, $"{name}: {written}");
        }
    }
}
