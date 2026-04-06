using Pe.Shared.StorageRuntime.Context;

namespace Pe.Shared.StorageRuntime.Context;

public interface IRevitContextAccessor : ISettingsDocumentContextAccessor {
    new Autodesk.Revit.DB.Document? GetActiveDocument();
}
