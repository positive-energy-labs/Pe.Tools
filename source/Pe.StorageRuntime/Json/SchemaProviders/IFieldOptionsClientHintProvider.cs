using Pe.StorageRuntime.Capabilities;

namespace Pe.StorageRuntime.Revit.Core.Json.SchemaProviders;

public interface IFieldOptionsClientHintProvider {
    SettingsOptionsResolverKind Resolver { get; }
    SettingsOptionsDatasetKind? Dataset { get; }
}
