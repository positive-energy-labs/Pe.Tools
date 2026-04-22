namespace Pe.Revit.SettingsRuntime.Context;

public interface ISettingsDocumentContextAccessor {
    object? GetActiveDocument();
}