using Pe.StorageRuntime.Context;

namespace Pe.StorageRuntime.Revit.Context;

public interface IRevitContextAccessor : ISettingsDocumentContextAccessor {
    new Autodesk.Revit.DB.Document? GetActiveDocument();
}
