using Pe.Revit.SettingsRuntime.Context;

namespace Pe.Revit.Global.Services.Document;

public sealed class DocumentManagerRevitContextAccessor : ISettingsDocumentContextAccessor {
    public object? GetActiveDocument() => RevitUiSession.CurrentUIApplication.GetActiveDocument();
}