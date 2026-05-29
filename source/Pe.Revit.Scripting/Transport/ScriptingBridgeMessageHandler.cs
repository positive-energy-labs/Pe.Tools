using Autodesk.Revit.UI;
using Pe.Revit.Scripting.Bootstrap;
using Pe.Revit.Scripting.Execution;
using Pe.Revit.Scripting.References;
using Pe.Shared.HostContracts.Scripting;
using Pe.Shared.Scripting.Execution;
using Serilog;

namespace Pe.Revit.Scripting.Transport;

public sealed class ScriptingBridgeMessageHandler : IExternalEventHandler, IDisposable {
    private readonly ScriptWorkspaceBootstrapService _bootstrapService;
    private readonly RevitScriptExecutionService _executionService;
    private readonly ExternalEvent _externalEvent;
    private readonly object _sync = new();
    private readonly Func<UIApplication?> _uiApplicationAccessor;
    private bool _disposed;
    private PendingRequest? _pendingRequest;

    public ScriptingBridgeMessageHandler(
        Func<UIApplication?> uiApplicationAccessor,
        Action<string>? notificationSink = null
    ) {
        this._uiApplicationAccessor = uiApplicationAccessor;
        this._bootstrapService = CreateBootstrapService();
        this._executionService = CreateExecutionService(uiApplicationAccessor, notificationSink);
        this._externalEvent = ExternalEvent.Create(this);
    }

    public void Dispose() {
        if (this._disposed)
            return;

        this._disposed = true;
        lock (this._sync) {
            _ = this._pendingRequest?.Cancel();
            this._pendingRequest = null;
        }

        this._externalEvent.Dispose();
    }

    public string GetName() => "Pe.Tools Revit Scripting Bridge";

    public void Execute(UIApplication app) {
        PendingRequest? pendingRequest;
        lock (this._sync) {
            pendingRequest = this._pendingRequest;
            this._pendingRequest = null;
        }

        if (pendingRequest == null)
            return;

        pendingRequest.Execute(this);
    }

    public Task<ScriptWorkspaceBootstrapData> BootstrapWorkspaceAsync(
        ScriptWorkspaceBootstrapRequest request,
        CancellationToken cancellationToken
    ) => this.EnqueueAsync(
        "bootstrap workspace",
        () => {
            var uiApplication = this.RequireUiApplication();
            var revitVersion = uiApplication.Application.VersionNumber ?? "unknown";
            var targetFramework = RevitRuntimeTargetFramework.Resolve(revitVersion);
            var runtimeAssemblyPath = RevitRuntimeTargetFramework.GetRuntimeAssemblyPath();
            return this._bootstrapService.Bootstrap(
                NormalizeWorkspaceKey(request.WorkspaceKey),
                request.CreateSampleScript,
                revitVersion,
                targetFramework,
                runtimeAssemblyPath
            );
        },
        cancellationToken
    );

    public Task<ExecuteRevitScriptData> ExecuteAsync(
        ExecuteRevitScriptRequest request,
        CancellationToken cancellationToken
    ) => this.EnqueueAsync(
        "execute script",
        () => this._executionService.Execute(
            request with { WorkspaceKey = NormalizeWorkspaceKey(request.WorkspaceKey) },
            Guid.NewGuid().ToString("N")
        ),
        cancellationToken
    );

    private Task<T> EnqueueAsync<T>(
        string operationName,
        Func<T> action,
        CancellationToken cancellationToken
    ) {
        if (this._disposed)
            throw new ObjectDisposedException(nameof(ScriptingBridgeMessageHandler));
        cancellationToken.ThrowIfCancellationRequested();

        var completion = new TaskCompletionSource<T>(TaskCreationOptions.RunContinuationsAsynchronously);
        lock (this._sync) {
            if (this._pendingRequest != null)
                throw new InvalidOperationException("A Revit scripting request is already pending.");

            this._pendingRequest = PendingRequest.Create(operationName, action, completion);
        }

        try {
            var raiseResult = this._externalEvent.Raise();
            if (raiseResult != ExternalEventRequest.Accepted) {
                this.ClearPendingRequest();
                throw new InvalidOperationException($"Revit rejected the scripting request: {raiseResult}.");
            }

            return completion.Task;
        } catch {
            this.ClearPendingRequest();
            throw;
        }
    }

    private UIApplication RequireUiApplication() =>
        this._uiApplicationAccessor()
        ?? throw new InvalidOperationException("No active UIApplication is available.");

    private void ClearPendingRequest() {
        lock (this._sync)
            this._pendingRequest = null;
    }

    private static string NormalizeWorkspaceKey(string workspaceKey) =>
        string.IsNullOrWhiteSpace(workspaceKey) ? "default" : workspaceKey;

    private static ScriptWorkspaceBootstrapService CreateBootstrapService() {
        var csProjReader = new CsProjReader();
        var projectGenerator = new ScriptProjectGenerator(csProjReader);
        return new ScriptWorkspaceBootstrapService(projectGenerator);
    }

    private static RevitScriptExecutionService CreateExecutionService(
        Func<UIApplication?> uiApplicationAccessor,
        Action<string>? notificationSink
    ) {
        var csProjReader = new CsProjReader();
        var projectGenerator = new ScriptProjectGenerator(csProjReader);
        return new RevitScriptExecutionService(
            projectGenerator,
            new ScriptReferenceResolver(csProjReader),
            new ScriptAssemblyLoadService(),
            new ScriptCompilationService(ScriptFileTemplates.DefaultUsings),
            uiApplicationAccessor,
            notificationSink
        );
    }

    private sealed class PendingRequest(
        Action<ScriptingBridgeMessageHandler> execute,
        Action cancel
    ) {
        private readonly Action<ScriptingBridgeMessageHandler> _execute = execute;
        private readonly Action _cancel = cancel;

        public static PendingRequest Create<T>(
            string operationName,
            Func<T> action,
            TaskCompletionSource<T> completion
        ) => new(
            handler => {
                try {
                    _ = completion.TrySetResult(action());
                } catch (Exception ex) {
                    Log.Error(ex, "Revit scripting request failed: Operation={Operation}", operationName);
                    _ = completion.TrySetException(ex);
                }
            },
            () => _ = completion.TrySetCanceled()
        );

        public void Execute(ScriptingBridgeMessageHandler handler) => this._execute(handler);
        public bool Cancel() {
            this._cancel();
            return true;
        }
    }
}
