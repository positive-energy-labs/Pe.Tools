using Pe.Global.Services.SignalR.Modules;
using Pe.Tools.Commands.FamilyFoundry;

namespace Pe.Tools.Commands.FamilyFoundry.SignalR;

/// <summary>
///     SignalR module for FF Manager settings.
/// </summary>
public class FFManagerSettingsModule : SettingsModuleBase<ProfileFamilyManager> {
    public FFManagerSettingsModule() : base("FFManager", "profiles") { }
}
