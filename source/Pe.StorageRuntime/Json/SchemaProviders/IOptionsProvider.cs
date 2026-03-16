namespace Pe.StorageRuntime.Revit.Core.Json.SchemaProviders;

public interface IOptionsProvider {
    IEnumerable<string> GetExamples(SettingsProviderContext context);
}
