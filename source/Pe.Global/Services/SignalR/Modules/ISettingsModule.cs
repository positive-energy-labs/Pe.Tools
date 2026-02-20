using Pe.Global.Services.Storage;
using Pe.Global.Services.Storage.Core;

namespace Pe.Global.Services.SignalR.Modules;

/// <summary>
///     Non-generic contract for a SignalR settings module.
/// </summary>
public interface ISettingsModule {
    string ModuleKey { get; }

    /// <summary>
    ///     Default settings subdirectory used by this module (for example "profiles" or "autotag").
    /// </summary>
    string DefaultSubDirectory { get; }

    string SettingsTypeName { get; }
    Type SettingsType { get; }

    SettingsManager SettingsRoot();

    SettingsManager SettingsDir(string? subDirectory = null);
}

/// <summary>
///     Generic module contract for type-safe settings modules.
/// </summary>
public interface ISettingsModule<TSettings> : ISettingsModule where TSettings : class;
