namespace Pe.Shared.StorageRuntime.Context;

public interface IRevitContextAccessor : ISettingsDocumentContextAccessor {
    new Document? GetActiveDocument();
}