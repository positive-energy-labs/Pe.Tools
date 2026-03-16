namespace Pe.StorageRuntime.Revit.Core.Json.SchemaProviders;

public interface IDependentOptionsProvider : IOptionsProvider {
    IReadOnlyList<string> DependsOn { get; }
}
