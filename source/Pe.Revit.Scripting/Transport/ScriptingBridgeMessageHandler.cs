using Autodesk.Revit.UI;
using Pe.Revit.Scripting.Bootstrap;
using Pe.Revit.Scripting.Execution;
using Pe.Revit.Scripting.Pods;
using Pe.Revit.Scripting.References;
using Pe.Shared.HostContracts.Operations;
using Pe.Shared.HostContracts.Scripting;
using Pe.Shared.Scripting.Diagnostics;
using Pe.Shared.Scripting.Execution;
using Serilog;
using System.Diagnostics;

namespace Pe.Revit.Scripting.Transport;

public sealed class ScriptingBridgeMessageHandler : IExternalEventHandler, IScriptingBridgeService, IDisposable {
    private const int AdmissionWaitSeconds = 30;
    private const int DefaultTimeoutSeconds = 600;
    private const int MaxTimeoutSeconds = 3600;

    private readonly ScriptWorkspaceBootstrapService _bootstrapService;
    private readonly ScriptPodArchiveService _podArchiveService;
    private readonly RevitScriptExecutionService _executionService;
    private readonly ExternalEvent _externalEvent;
    private readonly SemaphoreSlim _executionSlot = new(1, 1);
    private readonly object _sync = new();
    private readonly Func<UIApplication?> _uiApplicationAccessor;
    private bool _disposed;
    private PendingRequest? _pendingRequest;
    private RunningExecution? _runningExecution;

    public ScriptingBridgeMessageHandler(
        Func<UIApplication?> uiApplicationAccessor,
        Action<string>? notificationSink = null
    ) {
        this._uiApplicationAccessor = uiApplicationAccessor;
        var csProjReader = new CsProjReader();
        var projectGenerator = new ScriptProjectGenerator(csProjReader);
        this._bootstrapService = new ScriptWorkspaceBootstrapService(projectGenerator);
        this._podArchiveService = new ScriptPodArchiveService(this._bootstrapService, projectGenerator);
        this._executionService = RevitScriptExecutionService.CreateDefault(uiApplicationAccessor, notificationSink);
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
                createSampleScript: true,
                revitVersion,
                targetFramework,
                runtimeAssemblyPath
            );
        },
        cancellationToken
    );

    public async Task<ExecuteRevitScriptData> ExecuteAsync(
        ExecuteRevitScriptRequest request,
        CancellationToken cancellationToken
    ) {
        var executionId = Guid.NewGuid().ToString("N");
        var timeoutSeconds = NormalizeTimeoutSeconds(request.TimeoutSeconds);
        using var cancelSource = new CancellationTokenSource();
        using var timeoutSource = new CancellationTokenSource();
        using var linkedSource = CancellationTokenSource.CreateLinkedTokenSource(
            cancelSource.Token,
            timeoutSource.Token,
            cancellationToken
        );
        var cancellation = new ScriptCancellationScope(
            linkedSource.Token,
            () => timeoutSource.IsCancellationRequested,
            timeoutSeconds
        );

        return await this.EnqueueAsync(
            "execute script",
            () => {
                lock (this._sync)
                    this._runningExecution = new RunningExecution(executionId, DateTimeOffset.UtcNow, cancelSource);
                // The timeout clock starts when the script actually starts, not while it waits in line.
                timeoutSource.CancelAfter(TimeSpan.FromSeconds(timeoutSeconds));
                var stopwatch = Stopwatch.StartNew();
                try {
                    var result = this._executionService.Execute(
                        request with { WorkspaceKey = NormalizeWorkspaceKey(request.WorkspaceKey) },
                        executionId,
                        cancellation
                    );
                    if (result.Status == ScriptExecutionStatus.Succeeded && stopwatch.Elapsed.TotalSeconds > timeoutSeconds)
                        result.Diagnostics.Add(ScriptDiagnosticFactory.Warning(
                            "cancel",
                            $"Execution ran {(int)stopwatch.Elapsed.TotalSeconds}s, past the {timeoutSeconds}s timeout, but the script never reached a cooperative checkpoint. Check ct or call ThrowIfCancelled() inside loops so it can be interrupted."
                        ));
                    return result;
                } finally {
                    lock (this._sync)
                        this._runningExecution = null;
                }
            },
            cancellationToken
        ).ConfigureAwait(false);
    }

    public Task<ScriptCancelData> CancelAsync(
        ScriptCancelRequest request,
        CancellationToken cancellationToken
    ) {
        // Never enqueued: the whole point is reaching a script that is hogging the execution slot.
        lock (this._sync) {
            var running = this._runningExecution;
            if (running == null)
                return Task.FromResult(new ScriptCancelData(false, null, "No script execution is currently running."));

            if (!string.IsNullOrWhiteSpace(request.ExecutionId)
                && !string.Equals(request.ExecutionId, running.ExecutionId, StringComparison.OrdinalIgnoreCase))
                return Task.FromResult(new ScriptCancelData(
                    false,
                    running.ExecutionId,
                    $"Execution '{request.ExecutionId}' is not running; the current execution is '{running.ExecutionId}'."
                ));

            running.CancelSource.Cancel();
            return Task.FromResult(new ScriptCancelData(
                true,
                running.ExecutionId,
                $"Cancellation signalled to execution '{running.ExecutionId}'. The script stops at its next cooperative checkpoint (ct / ThrowIfCancelled)."
            ));
        }
    }

    public Task<ScriptPodImportData> ImportPodAsync(
        ScriptPodImportRequest request,
        CancellationToken cancellationToken
    ) => this.EnqueueAsync(
        "import script pod",
        () => {
            var uiApplication = this.RequireUiApplication();
            var revitVersion = uiApplication.Application.VersionNumber ?? "unknown";
            var targetFramework = RevitRuntimeTargetFramework.Resolve(revitVersion);
            var runtimeAssemblyPath = RevitRuntimeTargetFramework.GetRuntimeAssemblyPath();
            return this._podArchiveService.Import(
                request,
                revitVersion,
                targetFramework,
                runtimeAssemblyPath
            );
        },
        cancellationToken
    );

    public Task<ScriptPodExportData> ExportPodAsync(
        ScriptPodExportRequest request,
        CancellationToken cancellationToken
    ) => this.EnqueueAsync(
        "export script pod",
        () => {
            var uiApplication = this.RequireUiApplication();
            var revitVersion = uiApplication.Application.VersionNumber ?? "unknown";
            var targetFramework = RevitRuntimeTargetFramework.Resolve(revitVersion);
            return this._podArchiveService.Export(request, targetFramework, revitVersion);
        },
        cancellationToken
    );

    public Task<ScriptPodListData> ListPodsAsync(
        ScriptPodListRequest request,
        CancellationToken cancellationToken
    ) =>
        // Pure disk IO — no Revit API access, so it never waits behind the execution slot.
        Task.FromResult(ScriptPodCatalogService.List());

    private async Task<T> EnqueueAsync<T>(
        string operationName,
        Func<T> action,
        CancellationToken cancellationToken
    ) {
        if (this._disposed)
            throw new ObjectDisposedException(nameof(ScriptingBridgeMessageHandler));

        if (!await this._executionSlot.WaitAsync(TimeSpan.FromSeconds(AdmissionWaitSeconds), cancellationToken).ConfigureAwait(false))
            throw new InvalidOperationException(this.DescribeBusy());

        try {
            if (this._disposed)
                throw new ObjectDisposedException(nameof(ScriptingBridgeMessageHandler));

            var completion = new TaskCompletionSource<T>(TaskCreationOptions.RunContinuationsAsynchronously);
            lock (this._sync)
                this._pendingRequest = PendingRequest.Create(operationName, action, completion);

            try {
                var raiseResult = this._externalEvent.Raise();
                if (raiseResult != ExternalEventRequest.Accepted) {
                    this.ClearPendingRequest();
                    throw new InvalidOperationException($"Revit rejected the scripting request: {raiseResult}.");
                }

                return await completion.Task.ConfigureAwait(false);
            } catch {
                this.ClearPendingRequest();
                throw;
            }
        } finally {
            _ = this._executionSlot.Release();
        }
    }

    private string DescribeBusy() {
        lock (this._sync) {
            var running = this._runningExecution;
            var runningSeconds = running == null
                ? (int?)null
                : (int)(DateTimeOffset.UtcNow - running.StartedUtc).TotalSeconds;
            return running == null
                ? $"Revit scripting is busy with another request; waited {AdmissionWaitSeconds}s for it to finish. Retry shortly."
                : $"Revit scripting is busy: execution '{running.ExecutionId}' has been running for {runningSeconds}s; waited {AdmissionWaitSeconds}s for it to finish. Cancel it with scripting.cancel or retry.";
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

    private static int NormalizeTimeoutSeconds(int timeoutSeconds) =>
        timeoutSeconds <= 0 ? DefaultTimeoutSeconds : Math.Min(timeoutSeconds, MaxTimeoutSeconds);

    private sealed record RunningExecution(
        string ExecutionId,
        DateTimeOffset StartedUtc,
        CancellationTokenSource CancelSource
    );

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
