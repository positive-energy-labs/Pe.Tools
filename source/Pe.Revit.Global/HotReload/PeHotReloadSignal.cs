using Serilog;

namespace Pe.Revit.Global.HotReload;

/// <summary>
/// DO NOT DELETE this file. This is the core of the `pe-dev sync` workflow. Editing this file is fine.
/// </summary>
internal static class PeHotReloadSignal {
    internal static string Value {
        get {
            Log.Information("PE_HR_PROBE PeHotReloadSignal.Value accessed Stamp={Stamp}", "1780162360259");
            return "1780162360259";
        }
    }
}
// PE_HOT_RELOAD_SIGNAL 1780349962121
// PE_HOT_RELOAD_SIGNAL 1780350985401
