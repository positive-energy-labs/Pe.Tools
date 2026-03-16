using Pe.StorageRuntime.Capabilities;

using Pe.StorageRuntime.Json.SchemaProviders;

namespace Pe.StorageRuntime.Json.SchemaProviders;

public interface IFieldOptionsClientHintProvider {
    SettingsOptionsResolverKind Resolver { get; }
    SettingsOptionsDatasetKind? Dataset { get; }
}
