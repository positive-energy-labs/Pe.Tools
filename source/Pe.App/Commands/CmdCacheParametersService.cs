using Autodesk.Revit.Attributes;
using Autodesk.Revit.UI;
using Pe.Revit.Global.Services.Aps;
using Serilog;

namespace Pe.App.Commands;

[Transaction(TransactionMode.Manual)]
public class CmdCacheParametersService : IExternalCommand {
    public Result Execute(
        ExternalCommandData commandData,
        ref string message,
        ElementSet elements) {
        try {
            _ = ParametersServiceCache.RefreshAsync().GetAwaiter().GetResult();
            return Result.Succeeded;
        } catch (Exception ex) {
            Log.Error(ex, "[APS Cache] Failed to cache the parameters service payload.");
            message = ex.Message;
            return Result.Failed;
        }
    }
}
