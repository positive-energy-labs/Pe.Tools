namespace Pe.Revit.SettingsRuntime.Context;

public interface IRevitContextAccessor : ISettingsDocumentContextAccessor {
    new Document? GetActiveDocument();
}