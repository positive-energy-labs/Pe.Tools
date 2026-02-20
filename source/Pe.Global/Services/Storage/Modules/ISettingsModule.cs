using Pe.Global.Services.Storage.Core;

namespace Pe.Global.Services.Storage.Modules;

/// <summary>
///     Non-generic contract for a settings module.
///     Settings modules provide organized access to settings files and directories
///     within a module-specific root (e.g., "FFManager", "AutoTag").
/// </summary>
public interface ISettingsModule {
    /// <summary>
    ///     Unique key identifying this module (e.g., "FFManager", "AutoTag").
    ///     Used as the root directory name for this module's settings.
    /// </summary>
    string ModuleKey { get; }

    /// <summary>
    ///     Default settings subdirectory used by this module (e.g., "profiles", "autotag").
    ///     This is the typical subdirectory where the module's settings files live.
    /// </summary>
    string DefaultSubDirectory { get; }

    /// <summary>
    ///     Name of the settings type managed by this module.
    /// </summary>
    string SettingsTypeName { get; }

    /// <summary>
    ///     Type of the settings managed by this module.
    /// </summary>
    Type SettingsType { get; }

    /// <summary>
    ///     Returns a SettingsManager for the module's root directory.
    /// </summary>
    SettingsManager SettingsRoot();

    /// <summary>
    ///     Returns a SettingsManager for a subdirectory within the module's root.
    ///     If subDirectory is null or empty, uses DefaultSubDirectory.
    /// </summary>
    SettingsManager SettingsDir(string? subDirectory = null);
}

/// <summary>
///     Generic module contract for type-safe settings modules.
/// </summary>
public interface ISettingsModule<TSettings> : ISettingsModule where TSettings : class;
