using Pe.StorageRuntime.Modules;

namespace Pe.StorageRuntime.Revit.Modules;

public interface ISettingsModule : ISettingsModuleDescriptor {
    SharedModuleSettingsStorage SharedStorage();
}

public interface ISettingsModule<TSettings> : ISettingsModule where TSettings : class;
