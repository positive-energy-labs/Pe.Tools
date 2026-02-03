namespace Pe.Global.Services.SignalR;

/// <summary>
///     Holds shared Revit application context for SignalR hubs.
///     Provides access to UIApplication and tracks document state.
/// </summary>
public class RevitContext {
    public RevitContext(UIApplication uiApp) {
        this.UIApplication = uiApp;
        Current = this;
    }

    /// <summary>
    ///     Singleton instance for global access (used by schema providers).
    /// </summary>
    public static RevitContext? Current { get; private set; }

    /// <summary>
    ///     The Revit UIApplication instance.
    /// </summary>
    public UIApplication UIApplication { get; }

    /// <summary>
    ///     The currently active document, or null if none.
    /// </summary>
    public Autodesk.Revit.DB.Document? Document => this.UIApplication.ActiveUIDocument?.Document;

    /// <summary>
    ///     The active UIDocument, or null if none.
    /// </summary>
    public UIDocument? ActiveUIDocument => this.UIApplication.ActiveUIDocument;
}