using Pe.FamilyFoundry;
using Pe.Global.Services.Storage.Modules;

namespace Pe.Tools.Commands.FamilyFoundry.Modules;

/// <summary>
///     Settings module for FF Migrator.
/// </summary>
public class FFMigratorSettingsModule() : SettingsModuleBase<ProfileRemap>(CmdFFMigrator.AddinKey, "profiles");
