using Microsoft.AspNetCore.SignalR;
using Newtonsoft.Json;
using Pe.Global.Services.SignalR.Actions;
using System.Runtime.CompilerServices;
using System.Threading.Channels;

namespace Pe.Global.Services.SignalR.Hubs;

/// <summary>
///     SignalR hub for executing Revit actions.
/// </summary>
public class ActionsHub : Hub {
    private readonly RevitTaskQueue _taskQueue;
    private readonly SettingsTypeRegistry _typeRegistry;
    private readonly ActionRegistry _actionRegistry;

    public ActionsHub(RevitTaskQueue taskQueue, SettingsTypeRegistry typeRegistry, ActionRegistry actionRegistry) {
        this._taskQueue = taskQueue;
        this._typeRegistry = typeRegistry;
        this._actionRegistry = actionRegistry;
    }

    /// <summary>
    ///     Execute a Revit action with the provided settings.
    /// </summary>
    public async Task<ExecuteActionResponse> Execute(ExecuteActionRequest request) => await this._taskQueue.EnqueueAsync(uiApp => {
        try {
            // Resolve the handler
            var handler = this._actionRegistry.Resolve(request.ActionName);
            if (handler == null) {
                return new ExecuteActionResponse(false, $"Unknown action: {request.ActionName}", null);
            }

            // Deserialize settings
            var settingsType = this._typeRegistry.ResolveType(request.SettingsTypeName);
            var settings = JsonConvert.DeserializeObject(request.SettingsJson, settingsType);
            if (settings == null) {
                return new ExecuteActionResponse(false, "Failed to deserialize settings", null);
            }

            // Execute
            var result = request.PersistSettings ? handler.Execute(uiApp, settings) : handler.ExecuteWithoutPersist(uiApp, settings);
            return new ExecuteActionResponse(true, null, result);
        } catch (Exception ex) {
            return new ExecuteActionResponse(false, ex.Message, null);
        }
    });

    /// <summary>
    ///     Stream progress updates for long-running operations.
    /// </summary>
    public async IAsyncEnumerable<ProgressUpdate> ExecuteWithProgress(
        ExecuteActionRequest request,
        [EnumeratorCancellation] CancellationToken cancellationToken) {
        var channel = Channel.CreateUnbounded<ProgressUpdate>();

        // Start execution on Revit thread
        _ = this._taskQueue.EnqueueAsync(uiApp => {
            try {
                var handler = this._actionRegistry.Resolve(request.ActionName);
                if (handler == null) {
                    _ = channel.Writer.TryWrite(new ProgressUpdate(0, $"Unknown action: {request.ActionName}", null));
                    channel.Writer.Complete();
                    return;
                }

                var settingsType = this._typeRegistry.ResolveType(request.SettingsTypeName);
                var settings = JsonConvert.DeserializeObject(request.SettingsJson, settingsType);
                if (settings == null) {
                    _ = channel.Writer.TryWrite(new ProgressUpdate(0, "Failed to deserialize settings", null));
                    channel.Writer.Complete();
                    return;
                }

                if (handler.SupportsProgress) {
                    handler.ExecuteWithProgress(uiApp, settings, update => {
                        _ = channel.Writer.TryWrite(update);
                    });
                } else {
                    _ = channel.Writer.TryWrite(new ProgressUpdate(0, "Starting...", null));

                    _ = request.PersistSettings ? handler.Execute(uiApp, settings) : handler.ExecuteWithoutPersist(uiApp, settings);

                    _ = channel.Writer.TryWrite(new ProgressUpdate(100, "Complete", null));
                }

                channel.Writer.Complete();
            } catch (Exception ex) {
                _ = channel.Writer.TryWrite(new ProgressUpdate(0, $"Error: {ex.Message}", null));
                channel.Writer.Complete(ex);
            }
        });

        // Yield progress updates as they arrive
        await foreach (var update in channel.Reader.ReadAllAsync(cancellationToken)) {
            yield return update;
        }
    }

    /// <summary>
    ///     Get list of available actions for a settings type.
    /// </summary>
    public Task<List<string>> GetAvailableActions(string settingsTypeName) {
        var actions = this._actionRegistry.GetActionsForType(settingsTypeName)
            .Select(h => h.ActionName)
            .ToList();
        return Task.FromResult(actions);
    }
}
