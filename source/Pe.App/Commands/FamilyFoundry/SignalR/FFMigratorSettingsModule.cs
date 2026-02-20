using Pe.FamilyFoundry;
using Pe.Global.Services.SignalR.Modules;

namespace Pe.Tools.Commands.FamilyFoundry.SignalR;

/// <summary>
///     SignalR module for FF Migrator settings.
/// </summary>
public class FFMigratorSettingsModule : SettingsModuleBase<ProfileRemap> {
    public FFMigratorSettingsModule() : base("FFMigrator", "profiles") { }
}
