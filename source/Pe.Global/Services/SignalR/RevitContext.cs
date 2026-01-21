using Autodesk.Revit.UI;

namespace Pe.Global.Services.SignalR;

/// <summary>
///     Holds shared Revit application context for SignalR hubs.
///     Provides access to UIApplication and tracks document state.
/// </summary>
public class RevitContext {
    /// <summary>
    ///     Singleton instance for global access (used by schema providers).
    /// </summary>
    public static RevitContext? Current { get; private set; }

    private readonly UIApplication _uiApp;

    public RevitContext(UIApplication uiApp) {
        this._uiApp = uiApp;
        Current = this;
    }

    /// <summary>
    ///     The Revit UIApplication instance.
    /// </summary>
    public UIApplication UIApplication => this._uiApp;

    /// <summary>
    ///     The currently active document, or null if none.
    /// </summary>
    public Autodesk.Revit.DB.Document? Document => this._uiApp.ActiveUIDocument?.Document;

    /// <summary>
    ///     The active UIDocument, or null if none.
    /// </summary>
    public UIDocument? ActiveUIDocument => this._uiApp.ActiveUIDocument;
}
