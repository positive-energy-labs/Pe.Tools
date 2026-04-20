using Autodesk.Revit.UI.Events;

namespace Pe.Revit.Global.Revit.Documents;

public static class RevitUiSession {
    public static UIApplication CurrentUIApplication => new RibbonItemEventArgs().Application;
}