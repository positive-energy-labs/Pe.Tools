using Autodesk.Revit.Attributes;
using Autodesk.Revit.UI;
using Pe.Revit.Global.Services.Aps;
using Pe.Revit.Global.Ui;
using Serilog.Events;
using System.Diagnostics;

namespace Pe.App.Commands;

[Transaction(TransactionMode.Manual)]
public class CmdApsAuth : IExternalCommand {
    public Result Execute(
        ExternalCommandData commandData,
        ref string message,
        ElementSet elements
    ) {
        try {
            new Ballogger()
                .AddDebug(LogEventLevel.Information, new StackFrame(), ApsAuthActions.LoginParameterServiceStatusDetail())
                .Show();
            return Result.Succeeded;
        } catch (Exception ex) {
            new Ballogger().Add(LogEventLevel.Error, null, ex.Message).Show();
            return Result.Failed;
        }
    }
}
