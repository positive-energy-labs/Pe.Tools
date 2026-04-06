using Pe.StorageRuntime.Context;

namespace Pe.Global.Services.Document;

public sealed class DocumentManagerRevitContextAccessor : ISettingsDocumentContextAccessor {
    public object? GetActiveDocument() => DocumentManager.GetActiveDocument();
}
