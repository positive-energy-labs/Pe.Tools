using Pe.Shared.StorageRuntime.Context;

namespace Pe.Revit.Global.Services.Document;

public sealed class DocumentManagerRevitContextAccessor : ISettingsDocumentContextAccessor {
    public object? GetActiveDocument() => DocumentManager.GetActiveDocument();
}
