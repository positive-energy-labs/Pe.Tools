using Autodesk.Revit.UI.Events;
using Autodesk.Revit.UI;

namespace Pe.Revit.Extensions.ProjDocument;

public static class RevitUiSession {
    public static UIApplication CurrentUIApplication => new RibbonItemEventArgs().Application;
}
