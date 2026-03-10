using Pe.Global.Services.SignalR;
using Pe.Global.Services.Storage.Core;
using Newtonsoft.Json;

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
    public async Task Hub_method_names_include_server_capabilities()
    {
        var methods = typeof(HubMethodNames).GetFields()
            .Where(field => field.IsLiteral)
            .Select(field => field.GetRawConstantValue()?.ToString())
            .Where(value => !string.IsNullOrWhiteSpace(value))
            .ToList();

        await Assert.That(methods).Contains(nameof(HubMethodNames.GetServerCapabilitiesEnvelope));
    }

    [Test]
    public async Task SettingsEditorJson_serializes_contracts_as_camel_case_and_omits_nulls()
    {
        var payload = new ServerCapabilitiesEnvelopeResponse(
            Ok: true,
            Code: EnvelopeCode.Ok,
            Message: "ready",
            Issues: [],
            Data: new ServerCapabilitiesData(
                ContractVersion: SettingsEditorProtocol.ContractVersion,
                Transport: SettingsEditorProtocol.Transport,
                ServerVersion: null,
                SupportsFragmentSchema: true,
                SupportsRichInvalidationPayload: true,
                SupportsFieldOptionDatasets: true,
                SupportedDatasets: [FieldOptionsDatasetKind.ParameterCatalog],
                AvailableModules: [
                    new SettingsModuleDescriptor(
                        ModuleKey: "FFMigrator",
                        DefaultSubDirectory: "profiles",
                        SettingsTypeName: "ProfileRemap",
                        SettingsTypeFullName: "Pe.Tools.Commands.FamilyFoundry.ProfileRemap"
                    )
                ]
            )
        );

        var json = JsonConvert.SerializeObject(payload, SettingsEditorJson.CreateSerializerSettings());

        await Assert.That(json).Contains("\"contractVersion\":2");
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
    public async Task ResolveSafeSubDirectoryPath_rejects_traversal_segments()
    {
        var root = Path.Combine(Path.GetTempPath(), "pe-tools-settings-hardening");
        _ = Directory.CreateDirectory(root);

        _ = await Assert.That(() => SettingsPathing.ResolveSafeSubDirectoryPath(root, "../sibling", "subdirectory"))
            .Throws<ArgumentException>();
    }

    [Test]
    public async Task EndpointThrottleGate_coalesces_inflight_and_caches()
    {
        var gate = new EndpointThrottleGate();
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
}
