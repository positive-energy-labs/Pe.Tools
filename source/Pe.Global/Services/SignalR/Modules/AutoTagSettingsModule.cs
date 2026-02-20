using Pe.Global.Services.AutoTag.Core;

namespace Pe.Global.Services.SignalR.Modules;

/// <summary>
///     SignalR module for AutoTag settings.
/// </summary>
public class AutoTagSettingsModule : SettingsModuleBase<AutoTagSettings> {
    public AutoTagSettingsModule() : base("AutoTag", "autotag") { }
}
