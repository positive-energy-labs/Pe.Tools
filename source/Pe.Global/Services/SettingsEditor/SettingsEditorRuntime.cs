using Autodesk.Revit.UI;
using Pe.Global.Services.Storage.Modules;

namespace Pe.Global.Services.SettingsEditor;

/// <summary>
///     Compile-time selected host for the external settings editor runtime.
/// </summary>
public static partial class SettingsEditorRuntime {
    public static void Start(
        UIApplication uiApp,
        Action<SettingsModuleRegistry>? configureModules = null
    ) => StartCore(uiApp, configureModules);

    public static void Stop() => StopCore();

    static partial void StartCore(
        UIApplication uiApp,
        Action<SettingsModuleRegistry>? configureModules
    );

    static partial void StopCore();
}
