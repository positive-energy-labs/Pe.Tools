using Autodesk.Internal.InfoCenter;
using Autodesk.Windows;
using Pe.Global.Services.Storage;
using Serilog.Events;
using System.Windows;

namespace Pe.Global.Revit.Ui;

/// <summary>Message collector for accumulating messages, then showing all at once</summary>
public class Ballogger {
    private const string FmtNormal = "{0}: {1}";
    private const string FmtMethod = "{0} ({1}): {2}";
    private const string FmtErrorTrace = "{0} ({1}): {2}\n{3}";
    private const string StrNoMethod = "No Method Found";
    private readonly List<string> _messages = [];

    /// <summary>Clear all accumulated messages</summary>
    public void Clear() => this._messages.Clear();

    /// <summary>Add a normal message (with the method's name)</summary>
    public Ballogger Add(LogEventLevel log, StackFrame? sf, string message) {
        if (string.IsNullOrWhiteSpace(message)) return this;
        if (sf is null)
            this._messages.Add(string.Format(FmtNormal, log, message.Trim()));
        else {
            var method = sf.GetMethod()?.Name ?? StrNoMethod;
            this._messages.Add(string.Format(FmtMethod, log, method, message.Trim()));
        }

        return this;
    }


    /// <summary>Add an error message (with an optional stack trace)</summary>
    public Ballogger Add(LogEventLevel log, StackFrame sf, Exception ex, bool trace = false) {
        var method = sf.GetMethod()?.Name ?? StrNoMethod;
        var exDemystified = ex.ToStringDemystified();
        this._messages.Add(trace
            ? string.Format(FmtMethod, log, method, exDemystified)
            : string.Format(FmtMethod, log, method, ex.Message));
        return this;
    }


    /// <summary>Add a DEBUG build message</summary>
    public Ballogger AddDebug(LogEventLevel log, StackFrame sf, string message) {
        var method = sf.GetMethod()?.Name ?? StrNoMethod;
        var prefix = "DEBUG " + log;
        if (!string.IsNullOrWhiteSpace(message))
            this._messages.Add(string.Format(FmtMethod, prefix, method, message.Trim()));
        return this;
    }

    /// <summary>Add a DEBUG build error message (with an optional stack trace)</summary>
    public Ballogger AddDebug(LogEventLevel log, StackFrame sf, Exception ex, bool trace = false) {
        var method = sf.GetMethod()?.Name ?? StrNoMethod;
        var prefix = "DEBUG " + log;
        this._messages.Add(trace
            ? string.Format(FmtMethod, prefix, method, ex.ToStringDemystified())
            : string.Format(FmtMethod, prefix, method, ex.Message));
        return this;
    }

    /// <summary>Show multi-message balloon with a click-to-copy handler</summary>
    /// <param name="title">Optional title for the balloon</param>
    public void Show(
        string? title = null
    ) {
        var combinedMessage = new StringBuilder();
        if (this._messages.Count == 0) _ = this.Add(LogEventLevel.Warning, null, "No messages to display");

        foreach (var message in this._messages) {
            Storage.GlobalDir().LogTxt(message);
#if RELEASE
            if (message.StartsWith("DEBUG")) continue;
#endif
            _ = combinedMessage.AppendLine("\u2588 " + message);
        }

        ShowSingle(() => Clipboard.SetText(combinedMessage.ToString().Trim()), "Click to copy",
            combinedMessage.ToString(), title);
        this.Clear();
    }

    /// <summary>Show multi-message balloon with a custom click handler</summary>
    /// <param name="clickHandler">Custom action to perform on click</param>
    /// <param name="clickDescription">Click action description. (i.e. "Click to ...")</param>
    /// <param name="title">Optional title for the balloon</param>
    public void Show(
        Action clickHandler,
        string clickDescription,
        string? title = null
    ) {
        var combinedMessage = new StringBuilder();
        _ = combinedMessage.AppendLine(new string('-', 35));
        if (this._messages.Count == 0) _ = this.Add(LogEventLevel.Warning, null, "No messages to display");

        foreach (var message in this._messages) {
            Storage.GlobalDir().LogTxt(message);
#if RELEASE
            if (message.StartsWith("DEBUG")) continue;
#endif
            _ = combinedMessage.AppendLine("\u2588 " + message);
        }

        ShowSingle(clickHandler, clickDescription, combinedMessage.ToString(), title);
        this.Clear();
    }

    /// <summary>Show single-message balloon with a custom click handler</summary>
    /// <param name="clickHandler">Custom action to perform on click</param>
    /// <param name="clickDescription">Click action description. (i.e. "Click to ...")</param>
    /// <param name="text">Text to display</param>
    /// <param name="title">Optional title for the balloon</param>
    private static void ShowSingle(
        Action clickHandler,
        string clickDescription,
        string text,
        string? title = null
    ) {
        if (text == null)
            return;
        if (title == null)
            title = Assembly.GetExecutingAssembly().GetName().Name;
#pragma warning disable CA1416 // Validate platform compatibility
        var ri = new ResultItem {
            Title = text.Trim(),
            Category = title + (clickDescription != "" ? " (" + clickDescription + ")" : null)
        };
        ri.ResultClicked += (_, _) => clickHandler();

        ComponentManager.InfoCenterPaletteManager.ShowBalloon(ri);
#pragma warning restore CA1416 // Validate platform compatibility
    }
}