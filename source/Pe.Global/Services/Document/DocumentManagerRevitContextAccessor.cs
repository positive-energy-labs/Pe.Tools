using Pe.StorageRuntime.Revit.Context;

namespace Pe.Global.Services.Document;

public sealed class DocumentManagerRevitContextAccessor : IRevitContextAccessor {
    public Autodesk.Revit.DB.Document? GetActiveDocument() => DocumentManager.GetActiveDocument();

    object? Pe.StorageRuntime.Context.ISettingsDocumentContextAccessor.GetActiveDocument() =>
        this.GetActiveDocument();
}
