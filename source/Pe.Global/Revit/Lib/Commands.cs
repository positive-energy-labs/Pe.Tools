using Pe.Global.Revit.Ui;
using Serilog.Events;

namespace Pe.Global.Revit.Lib;

/// <summary>
///     Immutable reference to either an internal PostableCommand or an external command id.
/// </summary>
public readonly record struct CommandRef {
    private readonly string _external;
    private readonly PostableCommand? _internal;
    private CommandRef(PostableCommand i) => this._internal = i;
    private CommandRef(string e) => this._external = e;

    public object Value => this._internal.HasValue ? this._internal.Value : this._external;

    public static implicit operator CommandRef(PostableCommand i) => new(i);
    public static implicit operator CommandRef(string e) => new(e);

    public Result<RevitCommandId> GetCommandId() {
        RevitCommandId id;
        if (this._internal.HasValue) {
            id = RevitCommandId.LookupPostableCommandId(this._internal.Value);
            return id is null
                ? new InvalidOperationException($"CommandId is null for internal command ({this._internal})")
                : id;
        }

        if (string.IsNullOrEmpty(this._external)) return new ArgumentNullException(nameof(this._external));
        id = RevitCommandId.LookupCommandId(this._external);
        return id is null
            ? new InvalidOperationException($"CommandId is null for external command ({this._external})")
            : id;
    }

    /// <summary>
    ///     Returns the RevitCommandId for this reference if the command is postable. Else it returns null
    ///     TODO: Implement more robust/nuanced postability checking. Need to figure this out!!!!!
    /// </summary>
    public Result<RevitCommandId> GetPostableCommandId(UIApplication uiApp) {
        var (id, idErr) = this.GetCommandId();
        return idErr is not null
            ? idErr
            : uiApp.CanPostCommand(id)
                ? id
                : null;
    }
}

/// <summary> Service for executing PostableCommand items in Revit </summary>
public class Commands {
    /// <summary> Executes the specified command. </summary>
    public static Result<bool> Execute(UIApplication uiApp, CommandRef command) {
        var (validId, validIdErr) = command.GetPostableCommandId(uiApp);
        if (validIdErr is not null) return validIdErr;
        if (validId is null)
            return new InvalidOperationException($"Command cannot be executed at this time ({command})");
        try {
            uiApp.PostCommand(validId);
            return true;
        } catch (Exception ex) {
            return new InvalidOperationException($"Command failed to execute ({command})", ex);
        }
    }

    /// <summary> Checks if a command is available for execution. </summary>
    public static bool IsAvailable(UIApplication uiApp, CommandRef command) {
        var (validId, validIdErr) = command.GetPostableCommandId(uiApp);
        if (validIdErr is not null)
            new Ballogger().AddDebug(LogEventLevel.Error, new StackFrame(), validIdErr, true).Show();
        return validId is not null && validIdErr is null;
    }

    /// <summary> Returns a human-readable availability status. </summary>
    public static string GetStatus(UIApplication uiApp, CommandRef command) {
        var (validId, validIdErr) = command.GetPostableCommandId(uiApp);
        if (validIdErr is not null)
            new Ballogger().AddDebug(LogEventLevel.Error, new StackFrame(), validIdErr, true).Show();
        return validIdErr is not null
            ? "Availability Unknown"
            : validId is not null
                ? "Available"
                : "Unavailable";
    }
}