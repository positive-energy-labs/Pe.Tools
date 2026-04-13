using System.IO.Pipes;
using System.Text;
using System.Text.Json;
using System.Text.Json.Serialization;
using Microsoft.Extensions.Logging.Abstractions;
using Pe.Host;
using Pe.Host.Operations;
using Pe.Host.Services;
using Pe.Shared.HostContracts.Operations;
using Pe.Shared.HostContracts.Protocol;
using Pe.Shared.HostContracts.Scripting;

namespace Pe.Revit.Tests;

[TestFixture]
public sealed class HostScriptingV1Tests {
    private static readonly JsonSerializerOptions JsonOptions = CreateJsonOptions();

    [Test]
    public async Task Host_scripting_pipe_client_serializes_bootstrap_request_and_unwraps_payload() {
        var pipeName = CreatePipeName();
        var expected = new ScriptWorkspaceBootstrapData(
            "default",
            @"C:\workspace",
            @"C:\workspace\PeScripts.csproj",
            @"C:\workspace\src\SampleScript.cs",
            @"C:\workspace\README.md",
            "2025",
            "net8.0-windows",
            @"C:\runtime\Pe.Revit.Scripting.dll",
            [@"C:\workspace\PeScripts.csproj"]
        );

        var serverTask = Task.Run(() => ServeOnceAsync(
            pipeName,
            request => new ScriptingPipeResponse(true, string.Empty, Bootstrap: expected)
        ));

        var client = new HostScriptingPipeClientService(pipeName);
        var result = await client.BootstrapWorkspaceAsync(
            new ScriptWorkspaceBootstrapRequest("default", CreateSampleScript: false),
            CancellationToken.None
        );
        var capturedRequest = await serverTask;

        Assert.That(capturedRequest.Command, Is.EqualTo(ScriptingPipeCommand.BootstrapWorkspace));
        Assert.That(capturedRequest.WorkspaceKey, Is.EqualTo("default"));
        Assert.That(capturedRequest.CreateSampleScript, Is.False);
        Assert.That(result, Is.EqualTo(expected));
    }

    [Test]
    public async Task Host_scripting_pipe_client_serializes_execute_request_and_unwraps_payload() {
        var pipeName = CreatePipeName();
        var expected = new ExecuteRevitScriptData(
            ScriptExecutionStatus.Succeeded,
            "script output",
            [],
            "2025",
            "net8.0-windows",
            "SmokeScript",
            "exec-1"
        );

        var serverTask = Task.Run(() => ServeOnceAsync(
            pipeName,
            request => new ScriptingPipeResponse(true, string.Empty, Result: expected)
        ));

        var client = new HostScriptingPipeClientService(pipeName);
        var result = await client.ExecuteAsync(
            new ExecuteRevitScriptRequest(
                ScriptContent: "WriteLine(\"hi\");",
                SourceKind: ScriptExecutionSourceKind.InlineSnippet,
                WorkspaceKey: "default",
                ProjectContent: "<Project />",
                SourceName: "SmokeScript.cs"
            ),
            CancellationToken.None
        );
        var capturedRequest = await serverTask;

        Assert.That(capturedRequest.Command, Is.EqualTo(ScriptingPipeCommand.ExecuteScript));
        Assert.That(capturedRequest.SourceKind, Is.EqualTo(ScriptExecutionSourceKind.InlineSnippet));
        Assert.That(capturedRequest.ScriptContent, Is.EqualTo("WriteLine(\"hi\");"));
        Assert.That(capturedRequest.ProjectContent, Is.EqualTo("<Project />"));
        Assert.That(capturedRequest.SourceName, Is.EqualTo("SmokeScript.cs"));
        Assert.That(result, Is.EqualTo(expected));
    }

    [Test]
    public void Host_scripting_pipe_client_translates_pipe_timeout_to_actionable_message() {
        var client = new HostScriptingPipeClientService(CreatePipeName(), connectTimeoutMs: 50);

        var ex = Assert.ThrowsAsync<InvalidOperationException>(() => client.ExecuteAsync(
            new ExecuteRevitScriptRequest(
                ScriptContent: "WriteLine(\"hi\");",
                SourceKind: ScriptExecutionSourceKind.InlineSnippet
            ),
            CancellationToken.None
        ));

        Assert.That(ex, Is.Not.Null);
        Assert.That(ex!.Message, Does.Contain("Timed out waiting for Revit scripting pipe"));
        Assert.That(ex.Message, Does.Contain("connect exactly one Revit session to Pe.Host"));
    }

    [Test]
    public async Task Host_scripting_pipe_client_translates_pipe_disconnect_to_actionable_message() {
        var pipeName = CreatePipeName();
        var serverTask = Task.Run(() => ServeOnceAsync(
            pipeName,
            request => null
        ));

        var client = new HostScriptingPipeClientService(pipeName);
        var ex = Assert.ThrowsAsync<InvalidOperationException>(() => client.ExecuteAsync(
            new ExecuteRevitScriptRequest(
                ScriptContent: "WriteLine(\"hi\");",
                SourceKind: ScriptExecutionSourceKind.InlineSnippet
            ),
            CancellationToken.None
        ));

        await serverTask;

        Assert.That(ex, Is.Not.Null);
        Assert.That(ex!.Message, Does.Contain("Could not communicate with Revit scripting pipe"));
    }

    [Test]
    public async Task Host_scripting_pipe_client_rejects_success_response_without_payload() {
        var pipeName = CreatePipeName();
        var serverTask = Task.Run(() => ServeOnceAsync(
            pipeName,
            request => new ScriptingPipeResponse(true, string.Empty)
        ));

        var client = new HostScriptingPipeClientService(pipeName);
        var ex = Assert.ThrowsAsync<InvalidOperationException>(() => client.ExecuteAsync(
            new ExecuteRevitScriptRequest(
                ScriptContent: "WriteLine(\"hi\");",
                SourceKind: ScriptExecutionSourceKind.InlineSnippet
            ),
            CancellationToken.None
        ));

        await serverTask;

        Assert.That(ex, Is.Not.Null);
        Assert.That(ex!.Message, Does.Contain("no execution result payload"));
    }

    [Test]
    public void Host_scripting_operation_requires_single_connected_session_when_none_are_connected() {
        var operation = GetBootstrapOperation();
        var context = CreateOperationContext(CreateBridgeSnapshot(0), new FakeScriptingPipeClientService());

        var ex = Assert.ThrowsAsync<InvalidOperationException>(() => operation.ExecuteAsync(
            new ScriptWorkspaceBootstrapRequest(),
            context,
            CancellationToken.None
        ));

        Assert.That(ex, Is.Not.Null);
        Assert.That(ex!.Message, Does.Contain("requires exactly one connected Revit session"));
    }

    [Test]
    public void Host_scripting_operation_requires_single_connected_session_when_multiple_are_connected() {
        var operation = GetBootstrapOperation();
        var context = CreateOperationContext(CreateBridgeSnapshot(2), new FakeScriptingPipeClientService());

        var ex = Assert.ThrowsAsync<InvalidOperationException>(() => operation.ExecuteAsync(
            new ScriptWorkspaceBootstrapRequest(),
            context,
            CancellationToken.None
        ));

        Assert.That(ex, Is.Not.Null);
        Assert.That(ex!.Message, Does.Contain("supports exactly one connected Revit session"));
    }

    [Test]
    public async Task Host_scripting_operation_invokes_proxy_when_single_session_is_connected() {
        var operation = GetBootstrapOperation();
        var proxy = new FakeScriptingPipeClientService();
        var context = CreateOperationContext(CreateBridgeSnapshot(1), proxy);

        var result = await operation.ExecuteAsync(
            new ScriptWorkspaceBootstrapRequest("default", CreateSampleScript: false),
            context,
            CancellationToken.None
        );

        Assert.That(proxy.BootstrapCallCount, Is.EqualTo(1));
        Assert.That(proxy.LastBootstrapRequest, Is.EqualTo(new ScriptWorkspaceBootstrapRequest("default", false)));
        Assert.That(result.ExecutionPath, Is.EqualTo("scripting-pipe"));
        Assert.That(result.Response, Is.TypeOf<ScriptWorkspaceBootstrapData>());
    }

    private static HostOperationContext CreateOperationContext(
        BridgeRuntimeSnapshot snapshot,
        IHostScriptingPipeClientService scriptingPipeClientService
    ) {
        var runtimeStateService = new HostSettingsRuntimeStateService(
            new HostSettingsModuleCatalog(),
            new FakeBridgeCapabilityService(snapshot)
        );

        return new HostOperationContext(
            null!,
            null!,
            scriptingPipeClientService,
            runtimeStateService,
            null!,
            NullLoggerFactory.Instance
        );
    }

    private static IHostOperation GetBootstrapOperation() {
        var registry = new HostOperationRegistry();
        var found = registry.TryGetByKey(GetScriptWorkspaceBootstrapOperationContract.Definition.Key, out var operation);
        Assert.That(found, Is.True);
        return operation!;
    }

    private static BridgeRuntimeSnapshot CreateBridgeSnapshot(int sessionCount) {
        var sessions = Enumerable.Range(1, sessionCount)
            .Select(index => new BridgeSessionSnapshot(
                $"session-{index}",
                "2025",
                1000 + index,
                HasActiveDocument: false,
                ActiveDocumentTitle: null,
                RuntimeFramework: "net8.0-windows",
                BridgeContractVersion: BridgeProtocol.ContractVersion,
                BridgeTransport: BridgeProtocol.Transport,
                AvailableModules: [],
                ConnectedAtUnixMs: DateTimeOffset.UtcNow.ToUnixTimeMilliseconds() + index
            ))
            .ToList();
        var defaultSession = sessions.FirstOrDefault();

        return new BridgeRuntimeSnapshot(
            BridgeIsConnected: sessions.Count != 0,
            PipeName: "Pe.Host",
            DefaultSessionId: defaultSession?.SessionId,
            DefaultSession: defaultSession,
            Sessions: sessions,
            DisconnectReason: sessions.Count == 0 ? "not connected" : null
        );
    }

    private static async Task<ScriptingPipeRequest> ServeOnceAsync(
        string pipeName,
        Func<ScriptingPipeRequest, ScriptingPipeResponse?> responseFactory
    ) {
        using var server = new NamedPipeServerStream(
            pipeName,
            PipeDirection.InOut,
            1,
            PipeTransmissionMode.Byte,
            PipeOptions.Asynchronous
        );
        await server.WaitForConnectionAsync();

        using var reader = new StreamReader(server, Encoding.UTF8, false, 4096, leaveOpen: true);
        using var writer = new StreamWriter(server, new UTF8Encoding(false), 4096, leaveOpen: true) {
            AutoFlush = true
        };

        var requestJson = await reader.ReadLineAsync();
        Assert.That(requestJson, Is.Not.Null.And.Not.Empty);

        var request = JsonSerializer.Deserialize<ScriptingPipeRequest>(requestJson!, JsonOptions);
        Assert.That(request, Is.Not.Null);

        var response = responseFactory(request!);
        if (response != null) {
            var responseJson = JsonSerializer.Serialize(response, JsonOptions);
            await writer.WriteLineAsync(responseJson);
        }

        return request!;
    }

    private static string CreatePipeName() => $"Pe.Host.Tests.{Guid.NewGuid():N}";

    private static JsonSerializerOptions CreateJsonOptions() {
        var options = new JsonSerializerOptions {
            PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
            DefaultIgnoreCondition = JsonIgnoreCondition.WhenWritingNull
        };
        options.Converters.Add(new JsonStringEnumConverter());
        return options;
    }

    private sealed class FakeBridgeCapabilityService(BridgeRuntimeSnapshot snapshot) : IHostBridgeCapabilityService {
        private readonly BridgeRuntimeSnapshot _snapshot = snapshot;

        public BridgeRuntimeSnapshot GetSnapshot() => this._snapshot;
    }

    private sealed class FakeScriptingPipeClientService : IHostScriptingPipeClientService {
        public int BootstrapCallCount { get; private set; }
        public ScriptWorkspaceBootstrapRequest? LastBootstrapRequest { get; private set; }

        public Task<ScriptWorkspaceBootstrapData> BootstrapWorkspaceAsync(
            ScriptWorkspaceBootstrapRequest request,
            CancellationToken cancellationToken
        ) {
            this.BootstrapCallCount++;
            this.LastBootstrapRequest = request;
            return Task.FromResult(new ScriptWorkspaceBootstrapData(
                request.WorkspaceKey,
                @"C:\workspace",
                @"C:\workspace\PeScripts.csproj",
                @"C:\workspace\src\SampleScript.cs",
                @"C:\workspace\README.md",
                "2025",
                "net8.0-windows",
                @"C:\runtime\Pe.Revit.Scripting.dll",
                []
            ));
        }

        public Task<ExecuteRevitScriptData> ExecuteAsync(
            ExecuteRevitScriptRequest request,
            CancellationToken cancellationToken
        ) => Task.FromResult(new ExecuteRevitScriptData(
            ScriptExecutionStatus.Succeeded,
            string.Empty,
            [],
            "2025",
            "net8.0-windows",
            "SmokeScript",
            "exec-1"
        ));
    }
}
