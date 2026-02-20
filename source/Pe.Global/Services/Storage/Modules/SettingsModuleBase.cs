using Pe.Global.Services.Storage.Core;

namespace Pe.Global.Services.Storage.Modules;

/// <summary>
///     Base class for settings modules with type-safe settings type.
///     Provides default implementation of module settings access patterns.
/// </summary>
public abstract class SettingsModuleBase<TSettings> : ISettingsModule<TSettings> where TSettings : class {
    protected SettingsModuleBase(string moduleKey, string defaultSubDirectory) {
        this.ModuleKey = moduleKey;
        this.DefaultSubDirectory = defaultSubDirectory;
    }

    public string ModuleKey { get; }
    public string DefaultSubDirectory { get; }
    public string SettingsTypeName => typeof(TSettings).Name;
    public Type SettingsType => typeof(TSettings);

    public virtual SettingsManager SettingsRoot() => new Storage(this.ModuleKey).SettingsDir();

    public virtual SettingsManager SettingsDir(string? subDirectory = null) {
        var root = this.SettingsRoot();
        var targetSubDirectory = string.IsNullOrWhiteSpace(subDirectory)
            ? this.DefaultSubDirectory
            : subDirectory;
        return string.IsNullOrWhiteSpace(targetSubDirectory)
            ? root
            : root.SubDir(targetSubDirectory);
    }
}
