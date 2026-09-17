using Autodesk.Revit.UI;
using Pe.Revit.Operations;
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

public sealed class ScriptingBridgeMessageHandler : IExternalEventHandler, IDisposable {
    private const int AdmissionWaitSeconds = 30;
    private const int DefaultTimeoutSeconds = 600;
    private const int MaxTimeoutSeconds = 3600;

    private readonly ScriptWorkspaceBootstrapService _bootstrapService;
    private readonly ScriptPodPreparationService _pods = new();
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
        this._podArchiveService = new ScriptPodArchiveService(this._bootstrapService, projectGenerator, this._pods);
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

    [Op("scripting.workspace.bootstrap", Does = "Create or update a C# Revit scripting pod workspace: pod.json, PeScripts.csproj, docs, and a sample entrypoint script.", Title = "Bootstrap Script Workspace", Finds = ["script", "workspace", "pod", "bootstrap", "files"], Intent = OpIntent.Mutate, Cost = OpCost.Mutation, Tier = OpTier.Expert)]
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

    [Op("scripting.execute", Does = "Execute trusted in-process C# in connected Revit: scriptContent for an inline snippet (Execute-body statements or a full PeScriptContainer class), or sourcePath for a pod entrypoint declared in the workspace's pod.json — exactly one of the two. sourceBundle may supply captured Pod manifest, project presence and source bytes with sourcePath; references resolve from the original workspace key. The supplied document is the script target; UI document and selection are available only when it is active. permissionMode defaults to ReadOnly, which discards supplied-document changes via a rollback guard; pass WriteTransaction for one host-owned transaction, or NoTransaction when the script or called library must own transaction boundaries (including APIs such as Document.SaveAs that reject an open transaction).", Title = "Execute Revit Script", Finds = ["script", "execute", "csharp", "revit", "pod"], Intent = OpIntent.Mutate, Cost = OpCost.Mutation, Tier = OpTier.Expert)]
    public async Task<ExecuteRevitScriptData> ExecuteAsync(
        ExecuteRevitScriptRequest request,
        RevitDocument target,
        CancellationToken cancellationToken
    ) {
        var executionId = Guid.NewGuid().ToString("N");
        var timeoutSeconds = NormalizeTimeoutSeconds(request.TimeoutSeconds);
        using var timeoutSource = new CancellationTokenSource();
        // The request's own token is the cancel path: op.cancel <requestId> fires it.
        using var linkedSource = CancellationTokenSource.CreateLinkedTokenSource(
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
                    this._runningExecution = new RunningExecution(executionId, DateTimeOffset.UtcNow);
                // The timeout clock starts when the script actually starts, not while it waits in line.
                timeoutSource.CancelAfter(TimeSpan.FromSeconds(timeoutSeconds));
                var stopwatch = Stopwatch.StartNew();
                try {
                    var result = this._executionService.Execute(
                        target.Value,
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

    [Op("pod.member.compose", Does = "Compose one JSON member ($include, $preset) from the saved file or the supplied draft content. @local/ resolves inside the pod; @<id>/ resolves to the installed pod with that manifest id. Returns composed JSON, this member's diagnostics only, and consumed fragments with SHA-256.", Title = "Compose Pod Member", Finds = ["pod", "member", "compose", "include", "preset", "settings"])]
    public Task<PodMemberComposeData> ComposePodMemberAsync(PodMemberComposeRequest request, CancellationToken cancellationToken) {
        var result = this._pods.Compose(request.Pod, request.Path, request.Content);
        return Task.FromResult(new PodMemberComposeData(
            result.Composed,
            result.Diagnostics.ToList(),
            result.Dependencies.Select(dependency => new PodDependencyData(dependency.PodId, dependency.Path, dependency.Sha256)).ToList()
        ));
    }

    [Op("pod.export", Does = "Export an installed pod as a .zip archive. Every consumed foreign fragment is vendored under settings/_vendor/<id>/ and its reference rewritten to @local/_vendor/<id>/..., so the archive composes from its own bytes.", Title = "Export Pod", Finds = ["pod", "export", "publish", "zip", "archive", "vendor"], Intent = OpIntent.Mutate, Cost = OpCost.Mutation)]
    public Task<PodExportData> ExportPodAsync(PodExportRequest request, CancellationToken cancellationToken) => this.EnqueueAsync(
        "export pod",
        () => this._podArchiveService.Export(request, RevitRuntimeTargetFramework.Resolve(this.RequireUiApplication().Application.VersionNumber ?? "unknown")),
        cancellationToken
    );

    [Op("pod.import", Does = "Import a pod .zip archive into a new folder under Documents/Pe.Tools/Pods (default: the manifest id). Bytes are extracted unchanged and imported.json records the archive SHA-256, locator, and date.", Title = "Import Pod", Finds = ["pod", "import", "install", "zip", "archive"], Intent = OpIntent.Mutate, Cost = OpCost.Mutation)]
    public Task<PodImportData> ImportPodAsync(PodImportRequest request, CancellationToken cancellationToken) => this.EnqueueAsync(
        "import pod",
        () => {
            var revitVersion = this.RequireUiApplication().Application.VersionNumber ?? "unknown";
            return this._podArchiveService.Import(
                request,
                revitVersion,
                RevitRuntimeTargetFramework.Resolve(revitVersion),
                RevitRuntimeTargetFramework.GetRuntimeAssemblyPath()
            );
        },
        cancellationToken
    );

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
                : $"Revit scripting is busy: execution '{running.ExecutionId}' has been running for {runningSeconds}s; waited {AdmissionWaitSeconds}s for it to finish. Cancel it with op.cancel on that execution's requestId, or retry.";
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

    /// <summary>Busy-message diagnostics only; cancellation lives in the bridge pump's in-flight table.</summary>
    private sealed record RunningExecution(
        string ExecutionId,
        DateTimeOffset StartedUtc
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
