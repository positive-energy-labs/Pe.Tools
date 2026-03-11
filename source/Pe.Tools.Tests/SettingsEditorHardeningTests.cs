using Pe.Global.Services.Host;
using Pe.Host.Contracts;
using Pe.Global.Services.Storage.Core;
using Newtonsoft.Json;
using Newtonsoft.Json.Converters;
using Newtonsoft.Json.Serialization;

namespace Pe.Tools.Tests;

public sealed class SettingsEditorHardeningTests : RevitTestBase
{
    [Test]
    public async Task EnvelopeCode_includes_NoDocument_for_machine_readable_precondition_failures()
    {
        var names = Enum.GetNames(typeof(EnvelopeCode));

        await Assert.That(names).Contains(nameof(EnvelopeCode.NoDocument));
    }

    [Test]
    public async Task Hub_requests_do_not_expose_subdirectory()
    {
        await Assert.That(typeof(SettingsCatalogRequest).GetProperties())
            .DoesNotContain(property => string.Equals(property.Name, "SubDirectory", StringComparison.OrdinalIgnoreCase));
        await Assert.That(typeof(ValidateSettingsRequest).GetProperties())
            .DoesNotContain(property => string.Equals(property.Name, "SubDirectory", StringComparison.OrdinalIgnoreCase));
    }

    [Test]
    public async Task ParameterCatalogRequest_uses_context_values()
    {
        var properties = typeof(ParameterCatalogRequest).GetProperties()
            .Select(property => property.Name)
            .ToList();

        await Assert.That(properties).Contains(nameof(ParameterCatalogRequest.ContextValues));
        await Assert.That(properties).DoesNotContain("SiblingValues");
    }

    [Test]
    public async Task Hub_method_names_include_host_status()
    {
        var methods = typeof(HubMethodNames).GetFields()
            .Where(field => field.IsLiteral)
            .Select(field => field.GetRawConstantValue()?.ToString())
            .Where(value => !string.IsNullOrWhiteSpace(value))
            .ToList();

        await Assert.That(methods).Contains(nameof(HubMethodNames.GetHostStatusEnvelope));
    }

    [Test]
    public async Task Json_serializes_contracts_as_camel_case_and_omits_nulls()
    {
        var payload = new HostStatusEnvelopeResponse(
            Ok: true,
            Code: EnvelopeCode.Ok,
            Message: "ready",
            Issues: [],
            Data: new HostStatusData(
                HostIsRunning: true,
                BridgeIsConnected: true,
                HasActiveDocument: true,
                ActiveDocumentTitle: "Test Model",
                RevitVersion: "2025",
                RuntimeFramework: ".NET 8.0",
                HostContractVersion: HostProtocol.ContractVersion,
                HostTransport: HostProtocol.Transport,
                ServerVersion: null,
                BridgeContractVersion: BridgeProtocol.ContractVersion,
                BridgeTransport: BridgeProtocol.Transport,
                AvailableModules: [
                    new SettingsModuleDescriptor(
                        ModuleKey: "FFMigrator",
                        DefaultSubDirectory: "profiles",
                        SettingsTypeName: "ProfileRemap",
                        SettingsTypeFullName: "Pe.Tools.Commands.FamilyFoundry.ProfileRemap"
                    )
                ],
                DisconnectReason: null
            )
        );

        var json = JsonConvert.SerializeObject(payload, CreateSerializerSettings());

        await Assert.That(json).Contains("\"hostContractVersion\":2");
        await Assert.That(json).Contains("\"availableModules\"");
        await Assert.That(json).Contains("\"moduleKey\":\"FFMigrator\"");
        await Assert.That(json).DoesNotContain("serverVersion");
    }

    [Test]
    public async Task DocumentInvalidationEvent_exposes_machine_readable_reason_and_flags()
    {
        var payload = new DocumentInvalidationEvent(
            Reason: DocumentInvalidationReason.Changed,
            DocumentTitle: "Test Model",
            HasActiveDocument: true,
            InvalidateFieldOptions: true,
            InvalidateCatalogs: true,
            InvalidateSchema: false
        );

        await Assert.That(payload.Reason).IsEqualTo(DocumentInvalidationReason.Changed);
        await Assert.That(payload.InvalidateFieldOptions).IsTrue();
        await Assert.That(payload.InvalidateCatalogs).IsTrue();
        await Assert.That(payload.InvalidateSchema).IsFalse();
    }

    [Test]
    public async Task BridgeProtocol_exposes_named_pipe_defaults()
    {
        await Assert.That(BridgeProtocol.Transport).IsEqualTo("named-pipes");
        await Assert.That(BridgeProtocol.DefaultPipeName).IsEqualTo("Pe.Host.Bridge");
    }

    [Test]
    public async Task Contracts_assembly_does_not_include_runtime_helpers()
    {
        var contractsAssembly = typeof(BridgeProtocol).Assembly;

        await Assert.That(contractsAssembly.GetType("Pe.Host.Contracts.HostEnvironment")).IsNull();
        await Assert.That(contractsAssembly.GetType("Pe.Host.Contracts.Json")).IsNull();
    }

    [Test]
    public async Task HostStatusEnvelopeResponse_serializes_machine_readable_state()
    {
        var payload = new HostStatusEnvelopeResponse(
            Ok: true,
            Code: EnvelopeCode.Ok,
            Message: "connected",
            Issues: [],
            Data: new HostStatusData(
                HostIsRunning: true,
                BridgeIsConnected: true,
                HasActiveDocument: true,
                ActiveDocumentTitle: "Active Model",
                RevitVersion: "2025",
                RuntimeFramework: ".NET 8.0",
                HostContractVersion: HostProtocol.ContractVersion,
                HostTransport: HostProtocol.Transport,
                ServerVersion: "1.2.3",
                BridgeContractVersion: BridgeProtocol.ContractVersion,
                BridgeTransport: BridgeProtocol.Transport,
                AvailableModules: [
                    new SettingsModuleDescriptor("FFMigrator", "profiles", "ProfileRemap", "Pe.Tools.ProfileRemap")
                ],
                DisconnectReason: null
            )
        );

        var json = JsonConvert.SerializeObject(payload, CreateSerializerSettings());

        await Assert.That(json).Contains("\"hostIsRunning\":true");
        await Assert.That(json).Contains("\"bridgeIsConnected\":true");
        await Assert.That(json).Contains("\"activeDocumentTitle\":\"Active Model\"");
        await Assert.That(json).Contains("\"bridgeTransport\":\"named-pipes\"");
    }

    [Test]
    public async Task BridgeFrame_serializes_kind_and_payload_as_camel_case()
    {
        var frame = new BridgeFrame(
            Kind: BridgeFrameKind.Handshake,
            Handshake: new BridgeHandshake(
                ContractVersion: BridgeProtocol.ContractVersion,
                Transport: BridgeProtocol.Transport,
                RevitVersion: "2025",
                RuntimeFramework: ".NET 8.0",
                HasActiveDocument: true,
                ActiveDocumentTitle: "Test Model",
                AvailableModules: []
            )
        );

        var json = JsonConvert.SerializeObject(frame, CreateSerializerSettings());

        await Assert.That(json).Contains("\"kind\":\"Handshake\"");
        await Assert.That(json).Contains("\"handshake\"");
        await Assert.That(json).Contains("\"activeDocumentTitle\":\"Test Model\"");
    }

    [Test]
    public async Task ResolveSafeSubDirectoryPath_rejects_traversal_segments()
    {
        var root = Path.Combine(Path.GetTempPath(), "pe-tools-settings-hardening");
        _ = Directory.CreateDirectory(root);

        _ = await Assert.That(() => SettingsPathing.ResolveSafeSubDirectoryPath(root, "../sibling", "subdirectory"))
            .Throws<ArgumentException>();
    }

    [Test]
    public async Task ThrottleGate_coalesces_inflight_and_caches()
    {
        var gate = new ThrottleGate();
        var key = "conn:examples:FFMigrator:FamilyName";
        var invoked = 0;
        var release = new TaskCompletionSource<bool>(TaskCreationOptions.RunContinuationsAsynchronously);

        async Task<string> Factory()
        {
            _ = Interlocked.Increment(ref invoked);
            _ = await release.Task;
            return "ok";
        }

        var firstTask = gate.ExecuteAsync(key, TimeSpan.FromMilliseconds(250), Factory);
        var secondTask = gate.ExecuteAsync(key, TimeSpan.FromMilliseconds(250), Factory);
        release.SetResult(true);

        var first = await firstTask;
        var second = await secondTask;

        await Assert.That(Volatile.Read(ref invoked)).IsEqualTo(1);
        await Assert.That(first.Result).IsEqualTo("ok");
        await Assert.That(second.Result).IsEqualTo("ok");
        await Assert.That(new[] { ThrottleDecision.Executed, ThrottleDecision.Coalesced }).Contains(first.Decision);
        await Assert.That(new[] { ThrottleDecision.Executed, ThrottleDecision.Coalesced }).Contains(second.Decision);

        var cached = await gate.ExecuteAsync(
            key,
            TimeSpan.FromMilliseconds(250),
            () => Task.FromResult("should-not-run")
        );

        await Assert.That(cached.Decision).IsEqualTo(ThrottleDecision.CacheHit);
        await Assert.That(cached.Result).IsEqualTo("ok");
    }

    [Test]
    public async Task Host_services_no_longer_include_TaskQueue_wrapper()
    {
        await Assert.That(typeof(RequestService).Assembly.GetType("Pe.Global.Services.Host.TaskQueue")).IsNull();
    }

    private static JsonSerializerSettings CreateSerializerSettings()
    {
        var settings = new JsonSerializerSettings {
            NullValueHandling = NullValueHandling.Ignore,
            ContractResolver = new CamelCasePropertyNamesContractResolver()
        };
        settings.Converters.Add(new StringEnumConverter());
        return settings;
    }

}
