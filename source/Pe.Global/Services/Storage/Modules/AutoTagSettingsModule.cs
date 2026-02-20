using Pe.Global.Services.AutoTag.Core;

namespace Pe.Global.Services.Storage.Modules;

/// <summary>
///     Settings module for AutoTag.
/// </summary>
public class AutoTagSettingsModule : SettingsModuleBase<AutoTagSettings> {
    public AutoTagSettingsModule() : base("AutoTag", "autotag") { }
}
