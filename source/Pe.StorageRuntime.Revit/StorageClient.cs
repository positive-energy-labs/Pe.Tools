using Pe.StorageRuntime.Revit.Core;

namespace Pe.StorageRuntime.Revit;

public class StorageClient(string addinName) {
    private readonly string _addinPath = Path.Combine(BasePath, addinName);
    public static string BasePath => SettingsStorageLocations.GetDefaultBasePath();

    public static GlobalManager GlobalDir() => new(BasePath);

    public StateManager StateDir() => new(this._addinPath);

    public OutputManager OutputDir() => new(this._addinPath);

    public static string AddinKey<TAddin>() => typeof(TAddin).Name;

    public static string AddinKey(Type addinType) => addinType.Name;
}
