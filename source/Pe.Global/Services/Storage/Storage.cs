using Pe.Global.Services.Storage.Core;

namespace Pe.Global.Services.Storage;

public class Storage(string addinName) {
    private static readonly string BasePath = Path.Combine(
        Environment.GetFolderPath(Environment.SpecialFolder.MyDocuments), "Pe.App");

    private readonly string _addinPath = Path.Combine(BasePath, addinName);

    /// <summary>
    ///     Manager for the `Global\` storage dir. Handles global settings, state, and logging.
    /// </summary>
    /// <remarks>
    ///     Use this manager to store global add-in data that should be persisted between Revit sessions.
    ///     All global data is stored in the `Global\` directory without nesting.
    /// </remarks>
    public static GlobalManager GlobalDir() => new(BasePath);

    /// <summary>
    ///     Manager for the `settings\` storage dir. Handles granular read-only to JSON and CSV.
    /// </summary>
    /// <remarks>
    ///     Use this manager to store add-in settings that should be persisted between Revit sessions.
    ///     Data here should be updated but never completely overwritten (unless via an import).
    ///     The default file path is `{addinName}/settings/settings.json`
    /// </remarks>
    public SettingsManager SettingsDir() => new(this._addinPath);

    /// <summary>
    ///     Manager for the `state\` storage dir. Handles granular read/write to CSV, and full (non-granular) read/write to
    ///     JSON.
    /// </summary>
    /// <remarks>
    ///     Use this manager to store add-in state that should be persisted between Revit sessions.
    ///     Data here is meant to be frequently granularly updated but never overwritten (unless via an import).
    ///     The default file path is `{addinName}/state/state.json`
    /// </remarks>
    public StateManager StateDir() => new(this._addinPath);

    /// <summary>
    ///     Manager for the `output\` storage dir. Handles full (non-granular) writes to any file type.
    /// </summary>
    /// <remarks>
    ///     Use this manager to save add-in output for the user.
    ///     Data here should be written once to and then opened by the user.
    ///     There is NO DEFAULT FILE PATH for output files.
    /// </remarks>
    public OutputManager OutputDir() => new(this._addinPath);
}