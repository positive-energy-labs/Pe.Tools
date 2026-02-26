using Pe.Global.Services.Storage.Modules;
using Pe.Tools.Commands.FamilyFoundry;

namespace Pe.Tools.Commands.FamilyFoundry.Modules;

/// <summary>
///     Settings module for FF Manager.
/// </summary>
public class FFManagerSettingsModule : SettingsModuleBase<ProfileFamilyManager> {
    public FFManagerSettingsModule() : base(CmdFFManager.AddinKey, "profiles") { }
}
