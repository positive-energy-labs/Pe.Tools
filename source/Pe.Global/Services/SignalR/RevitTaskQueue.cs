using Autodesk.Revit.UI;
using ricaun.Revit.UI.Tasks;

namespace Pe.Global.Services.SignalR;

/// <summary>
///     Queues tasks from SignalR hub threads to be executed on the Revit main thread.
///     Uses RevitTaskService to marshal calls safely.
/// </summary>
public class RevitTaskQueue {
    private readonly RevitContext _context;
    private readonly RevitTaskService _revitTaskService;

    public RevitTaskQueue(RevitContext context, RevitTaskService revitTaskService) {
        this._context = context;
        this._revitTaskService = revitTaskService;
    }

    /// <summary>
    ///     Enqueue an action to run on the Revit thread and await its result.
    /// </summary>
    public async Task<T> EnqueueAsync<T>(Func<UIApplication, T> action) {
        T? result = default;
        await this._revitTaskService.Run(async () => {
            result = action(this._context.UIApplication);
            await Task.CompletedTask;
        });

        return result!;
    }

    /// <summary>
    ///     Enqueue a void action to run on the Revit thread and await completion.
    /// </summary>
    public async Task EnqueueAsync(Action<UIApplication> action) {
        await this._revitTaskService.Run(async () => {
            action(this._context.UIApplication);
            await Task.CompletedTask;
        });
    }
}
