using Pe.App.Analytics;
using Newtonsoft.Json.Linq;
using System.Reflection;
using System.Text.RegularExpressions;

namespace Pe.Revit.Tests;

/// <summary>Exercises the linked portable producer. No Revit payload or API is loaded.</summary>
[TestFixture]
public sealed class ReceiptEnvelopeTests {
    private readonly string _root = FindRoot();

    [Test]
    public void Mirrored_event_ids_belong_to_the_TS_registry() {
        var ts = File.ReadAllText(Path.Combine(this._root, "ts/packages/agent-contracts/src/receipts.ts"));
        var registry = Regex.Match(ts, @"receiptUsageEventSchema = z.enum\(\[([\s\S]*?)\]\)").Groups[1].Value;
        var ids = Regex.Matches(registry, "\"([^\"]+)\"").Select(match => match.Groups[1].Value).ToArray();
        Assert.That(ids, Is.Not.Empty);
        foreach (var field in typeof(ReceiptEventIds).GetFields(BindingFlags.Static | BindingFlags.NonPublic))
            Assert.That(ids, Does.Contain((string)field.GetRawConstantValue()!), field.Name);
    }

    [Test]
    public void Portable_boot_vector_retains_native_UUID_and_carries_no_reserved_identity() {
        var requestId = "10000000-0000-4000-8000-000000000004";
        var envelope = Produce(new JObject {
            ["kind"] = "usage", ["event"] = "app_boot", ["counters"] = new JObject { ["revitVersion"] = "2025" },
        }, requestId);
        Assert.That(envelope.Properties().Select(value => value.Name),
            Is.EquivalentTo(new[] { "schema", "id", "at", "join", "body", "emitter" }));
        Assert.That((string?)envelope["join"]?["requestId"], Is.EqualTo(requestId));
        Assert.That(Guid.TryParse((string?)envelope["id"], out _), Is.True);
        Assert.That(DateTimeOffset.TryParse((string?)envelope["at"], out _), Is.True);
        Assert.That((string?)envelope["at"], Does.EndWith("Z"), "TS z.iso.datetime requires the UTC Z spelling");
        Assert.That(envelope["emitter"]!.Children<JProperty>().Select(value => value.Name),
            Is.EquivalentTo(new[] { "version", "build", "commit" }));
    }

    [Test]
    public void Script_click_has_closed_labels_and_no_execution_success() {
        var body = ReceiptEventIds.Palette(ReceiptPaletteTab.Scripts, null, ReceiptPaletteMode.ReadOnly);
        Assert.That(body["counters"], Is.EqualTo(JObject.Parse("""
            { "palette":"do", "tab":"scripts", "itemKind":"script", "mode":"read-only" }
            """)));
    }

    [Test]
    public void Posted_command_is_not_execution_success() {
        var body = ReceiptEventIds.Palette(ReceiptPaletteTab.Commands, true, null);
        Assert.That((string?)body["counters"]?["outcome"], Is.EqualTo("incomplete"));
    }

    [Test]
    public void Overflow_is_bounded_and_retry_keeps_the_drop_receipt_identity() {
        var buffer = new NativeReceiptBuffer();
        var facts = Enumerable.Range(0, 66).Select(_ => Produce(new JObject {
            ["kind"] = "diagnostic", ["code"] = "native.failed",
        })).ToArray();
        foreach (var fact in facts) buffer.Enqueue(fact);
        var dropped = buffer.Peek()!;
        Assert.That(dropped["body"]?["event"]?.Value<string>(), Is.EqualTo("telemetry_dropped"));
        Assert.That(dropped["body"]?["counters"]?["count"]?.Value<long>(), Is.EqualTo(2));
        Assert.That(buffer.Peek(), Is.SameAs(dropped));
        buffer.Delivered(dropped);
        Assert.That(buffer.Peek(), Is.SameAs(facts[2]));
        var delivered = 0;
        while (buffer.Peek() is JObject fact) { buffer.Delivered(fact); delivered++; }
        Assert.That(delivered, Is.EqualTo(64));
    }

    [Test]
    public void Native_automatic_sender_has_no_vendor_identity_title_or_free_text() {
        var source = File.ReadAllText(Path.Combine(this._root, "dotnet/Pe.App/Analytics/PostHogAnalytics.cs"));
        foreach (var forbidden in new[] { "HttpClient", "api_key", "posthog.com", "Environment.MachineName", "Environment.UserName", "doc_title", "exception.Message", "exception.ToString", "RenderMessage" })
            Assert.That(source, Does.Not.Contain(forbidden), forbidden);
        var app = File.ReadAllText(Path.Combine(this._root, "dotnet/Pe.App/AppCore.cs"));
        Assert.That(app, Does.Not.Contain("CurrentDocumentTitle"));
        var palette = File.ReadAllText(Path.Combine(this._root, "dotnet/Pe.App/Commands/Palette/CmdPltCommands.cs"));
        Assert.That(palette, Does.Not.Contain("CaptureAction("));
    }

    private static JObject Produce(JObject body, string? requestId = null) => ReceiptEventIds.Producer(body, new JObject {
        ["version"] = "0.7.22", ["build"] = "0.7.22.1", ["commit"] = "0123456789abcdef0123456789abcdef01234567",
    }, requestId);

    private static string FindRoot() {
        foreach (var start in new[] { TestContext.CurrentContext.TestDirectory, Environment.CurrentDirectory })
            for (var directory = new DirectoryInfo(start); directory != null; directory = directory.Parent)
                if (File.Exists(Path.Combine(directory.FullName, "ts/packages/agent-contracts/src/receipts.ts"))) return directory.FullName;
        throw new DirectoryNotFoundException("The receipt registry checkout was not found.");
    }
}
