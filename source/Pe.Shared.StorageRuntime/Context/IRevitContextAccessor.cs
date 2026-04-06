using Pe.Shared.StorageRuntime.Context;

namespace Pe.Shared.StorageRuntime.Revit.Context;

public interface IRevitContextAccessor : ISettingsDocumentContextAccessor {
    new Autodesk.Revit.DB.Document? GetActiveDocument();
}
