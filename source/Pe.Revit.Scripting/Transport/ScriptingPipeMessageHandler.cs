using Autodesk.Revit.UI;
using Pe.Revit.Scripting.Bootstrap;
using Pe.Revit.Scripting.Execution;
using Pe.Revit.Scripting.References;
using Pe.Shared.HostContracts.Scripting;
using Serilog;

namespace Pe.Revit.Scripting.Transport;

public sealed class ScriptingPipeMessageHandler : IExternalEventHandler, IDisposable {
    private readonly ScriptWorkspaceBootstrapService _bootstrapService;
    private readonly RevitScriptExecutionService _executionService;
    private readonly Func<UIApplication?> _uiApplicationAccessor;
    private readonly ExternalEvent _externalEvent;
    private readonly object _sync = new();
    private PendingRequest? _pendingRequest;
    private bool _disposed;

    public ScriptingPipeMessageHandler(
        Func<UIApplication?> uiApplicationAccessor,
        Action<string>? notificationSink = null
    ) {
        this._uiApplicationAccessor = uiApplicationAccessor;
        this._bootstrapService = CreateBootstrapService();
        this._executionService = CreateExecutionService(uiApplicationAccessor, notificationSink);
        this._externalEvent = ExternalEvent.Create(this);
    }

    public async Task<ScriptingPipeResponse> HandleAsync(
        ScriptingPipeRequest request,
        CancellationToken cancellationToken
    ) {
        ObjectDisposedException.ThrowIf(this._disposed, this);

        var completion = new TaskCompletionSource<ScriptingPipeResponse>(TaskCreationOptions.RunContinuationsAsynchronously);
        lock (this._sync) {
            if (this._pendingRequest != null)
                throw new InvalidOperationException("A Revit scripting request is already pending.");

            this._pendingRequest = new PendingRequest(request, completion);
        }

        try {
            var raiseResult = this._externalEvent.Raise();
            if (raiseResult != ExternalEventRequest.Accepted) {
                this.ClearPendingRequest(completion);
                return new ScriptingPipeResponse(false, $"Revit rejected the scripting request: {raiseResult}.");
            }

            using var registration = cancellationToken.Register(() => completion.TrySetCanceled(cancellationToken));
            return await completion.Task.ConfigureAwait(false);
        } catch {
            this.ClearPendingRequest(completion);
            throw;
        }
    }

    public void Execute(UIApplication app) {
        PendingRequest? pendingRequest;
        lock (this._sync) {
            pendingRequest = this._pendingRequest;
            this._pendingRequest = null;
        }

        if (pendingRequest == null)
            return;

        try {
            var response = pendingRequest.Request.Command switch {
                ScriptingPipeCommand.ExecuteScript => this.ExecuteScript(pendingRequest.Request),
                ScriptingPipeCommand.BootstrapWorkspace => this.BootstrapWorkspace(pendingRequest.Request),
                _ => new ScriptingPipeResponse(false, $"Unsupported scripting command '{pendingRequest.Request.Command}'.")
            };
            pendingRequest.Completion.TrySetResult(response);
        } catch (Exception ex) {
            Log.Error(ex, "Revit scripting pipe request failed: Command={Command}", pendingRequest.Request.Command);
            pendingRequest.Completion.TrySetResult(new ScriptingPipeResponse(false, ex.Message));
        }
    }

    public string GetName() => "Pe.Tools Revit Scripting Pipe";

    public void Dispose() {
        if (this._disposed)
            return;

        this._disposed = true;
        lock (this._sync) {
            this._pendingRequest?.Completion.TrySetCanceled();
            this._pendingRequest = null;
        }

        this._externalEvent.Dispose();
    }

    private ScriptingPipeResponse BootstrapWorkspace(ScriptingPipeRequest request) {
        var uiApplication = this.RequireUiApplication();
        var revitVersion = uiApplication.Application.VersionNumber ?? "unknown";
        var targetFramework = RevitRuntimeTargetFramework.Resolve(revitVersion);
        var runtimeAssemblyPath = RevitRuntimeTargetFramework.GetRuntimeAssemblyPath();
        var bootstrap = this._bootstrapService.Bootstrap(
            NormalizeWorkspaceKey(request.WorkspaceKey),
            createSampleScript: request.CreateSampleScript,
            revitVersion,
            targetFramework,
            runtimeAssemblyPath
        );

        return new ScriptingPipeResponse(true, string.Empty, Bootstrap: bootstrap);
    }

    private ScriptingPipeResponse ExecuteScript(ScriptingPipeRequest request) {
        var executionId = Guid.NewGuid().ToString("N");
        var result = this._executionService.Execute(
            new ExecuteRevitScriptRequest(
                ScriptContent: request.ScriptContent,
                SourceKind: request.SourceKind,
                SourcePath: request.SourcePath,
                WorkspaceKey: NormalizeWorkspaceKey(request.WorkspaceKey),
                ProjectContent: request.ProjectContent,
                SourceName: request.SourceName
            ),
            executionId
        );

        return new ScriptingPipeResponse(true, string.Empty, Result: result);
    }

    private UIApplication RequireUiApplication() =>
        this._uiApplicationAccessor()
        ?? throw new InvalidOperationException("No active UIApplication is available.");

    private void ClearPendingRequest(TaskCompletionSource<ScriptingPipeResponse> completion) {
        lock (this._sync) {
            if (ReferenceEquals(this._pendingRequest?.Completion, completion))
                this._pendingRequest = null;
        }
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
            new ScriptCompilationService(),
            uiApplicationAccessor,
            notificationSink
        );
    }

    private sealed record PendingRequest(
        ScriptingPipeRequest Request,
        TaskCompletionSource<ScriptingPipeResponse> Completion
    );
}
