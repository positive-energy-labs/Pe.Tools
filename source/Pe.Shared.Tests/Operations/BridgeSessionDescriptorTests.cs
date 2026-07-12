using Newtonsoft.Json;
using Newtonsoft.Json.Serialization;
using Pe.Shared.HostContracts.Bridge;

namespace Pe.Revit.Tests;

[TestFixture]
public sealed class BridgeSessionDescriptorTests {
    [Test]
    public void Parses_sdk_session_descriptor_fields() {
        var descriptor = BridgeSessionDescriptor.TryParse("""
            {
              "schemaVersion": 1,
              "product": "Pe.Tools",
              "assembly": "Pe.App",
              "entryType": "Pe.App.Application",
              "configuration": "Debug",
              "revitVersion": "2025",
              "lane": "Dev",
              "path": "C:/repo/.artifacts/build/Pe.App/net8.0-windows",
              "buildStamp": "abc123",
              "builtAtUtc": "2026-07-12T00:00:00Z"
            }
            """);

        Assert.That(descriptor, Is.Not.Null);
        Assert.That(descriptor!.Assembly, Is.EqualTo("Pe.App"));
        Assert.That(descriptor.Lane, Is.EqualTo("dev"), "lane is reported normalized-lowercase");
        Assert.That(descriptor.BuildStamp, Is.EqualTo("abc123"));
        Assert.That(descriptor.SandboxId, Is.Null);
        Assert.That(descriptor.PayloadPath, Is.EqualTo("C:/repo/.artifacts/build/Pe.App/net8.0-windows"));
    }

    [Test]
    public void Parses_installed_runtime_descriptor_runtime_lane_spelling() {
        var descriptor = BridgeSessionDescriptor.TryParse("""
            {
              "schemaVersion": 1,
              "productName": "Pe.Tools",
              "runtimeLane": "Installed",
              "configuration": "Release"
            }
            """);

        Assert.That(descriptor, Is.Not.Null);
        Assert.That(descriptor!.Lane, Is.EqualTo("installed"));
        Assert.That(descriptor.BuildStamp, Is.Null);
    }

    [Test]
    public void Rejects_non_json_text() {
        Assert.That(BridgeSessionDescriptor.TryParse("not json"), Is.Null);
        Assert.That(BridgeSessionDescriptor.TryParse(""), Is.Null);
        Assert.That(BridgeSessionDescriptor.TryParse(null), Is.Null);
    }

    [Test]
    public void Descriptor_payload_directory_gate_matches_slash_and_case_insensitively() {
        var descriptor = BridgeSessionDescriptor.TryParse("""
            { "lane": "dev", "path": "C:/repo/bin/Payload/" }
            """)!;

        Assert.That(descriptor.DescribesPayloadDirectory(@"c:\repo\bin\payload"), Is.True);
        Assert.That(descriptor.DescribesPayloadDirectory(@"C:\other\payload"), Is.False);
        Assert.That(descriptor.DescribesPayloadDirectory(null), Is.False);
    }

    [Test]
    public void Registration_request_serializes_optional_identity_fields_camel_cased_and_omits_nulls() {
        var settings = new JsonSerializerSettings {
            NullValueHandling = NullValueHandling.Ignore,
            ContractResolver = new DefaultContractResolver {
                NamingStrategy = new CamelCaseNamingStrategy()
            }
        };

        var withIdentity = new BridgeRegistrationRequest(
            BridgeProtocol.ContractVersion,
            4242,
            State: null!,
            ProcessStartUtcUnixMs: 1752000000000,
            SessionDescriptorPath: @"C:\x\session.json",
            Lane: "dev",
            SandboxId: null,
            BuildStamp: "abc123"
        );
        var json = JsonConvert.SerializeObject(withIdentity, settings);
        Assert.That(json, Does.Contain("\"processStartUtcUnixMs\":1752000000000"));
        Assert.That(json, Does.Contain("\"lane\":\"dev\""));
        Assert.That(json, Does.Contain("\"buildStamp\":\"abc123\""));
        Assert.That(json, Does.Not.Contain("sandboxId"), "null optionals are omitted on the wire");

        // The pre-identity wire shape still deserializes: absent optionals default to null —
        // this is exactly why ContractVersion stays at 19.
        var legacy = JsonConvert.DeserializeObject<BridgeRegistrationRequest>(
            "{\"contractVersion\":19,\"processId\":7}",
            settings
        );
        Assert.That(legacy!.ProcessStartUtcUnixMs, Is.Null);
        Assert.That(legacy.Lane, Is.Null);

        // The ack now carries the broker-assigned session id; older acks without it still decode.
        var ack = JsonConvert.DeserializeObject<BridgeRegistrationAck>(
            "{\"accepted\":true,\"sessionId\":\"session-abc\"}",
            settings
        );
        Assert.That(ack!.SessionId, Is.EqualTo("session-abc"));
        var legacyAck = JsonConvert.DeserializeObject<BridgeRegistrationAck>("{\"accepted\":true}", settings);
        Assert.That(legacyAck!.SessionId, Is.Null);
    }
}
