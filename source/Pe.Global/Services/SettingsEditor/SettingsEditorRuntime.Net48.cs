using Autodesk.Revit.UI;
using Pe.Global.Services.Storage.Modules;

namespace Pe.Global.Services.SettingsEditor;

public static partial class SettingsEditorRuntime {
    static partial void StartCore(
        UIApplication uiApp,
        Action<SettingsModuleRegistry>? configureModules
    ) { }

    static partial void StopCore() { }
}
