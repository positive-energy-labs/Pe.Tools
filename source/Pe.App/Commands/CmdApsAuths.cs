using Autodesk.Revit.Attributes;
using Autodesk.Revit.UI;
using Pe.Global.Services.Aps;
using Pe.Global.Services.Storage;
using Pe.Global.Revit.Ui;
using Serilog.Events;
using System.Diagnostics;

namespace Pe.Tools.Commands;

[Transaction(TransactionMode.Manual)]
public class CmdApsAuthNormal : IExternalCommand {
    public Result Execute(
        ExternalCommandData commandData,
        ref string message,
        ElementSet elements) {
        try {
            var auth = new Aps(new ApsAuthNormal());
            var token = auth.GetToken();
            new Ballogger().AddDebug(LogEventLevel.Information, new StackFrame(), token).Show();
            return Result.Succeeded;
        } catch (Exception ex) {
            new Ballogger().Add(LogEventLevel.Error, null, ex.Message).Show();
            return Result.Failed;
        }
    }
}

[Transaction(TransactionMode.Manual)]
public class CmdApsAuthPKCE : IExternalCommand {
    public Result Execute(
        ExternalCommandData commandData,
        ref string message,
        ElementSet elements) {
        try {
            var aps = new Aps(new ApsAuthPkce());
            var token = aps.GetToken();
            new Ballogger().AddDebug(LogEventLevel.Information, new StackFrame(), token).Show();
            return Result.Succeeded;
        } catch (Exception ex) {
            new Ballogger().Add(LogEventLevel.Error, null, ex.Message).Show();
            return Result.Failed;
        }
    }
}

public class ApsAuthNormal : Aps.IOAuthTokenProvider {
    public string GetClientId() => Storage.GlobalDir().SettingsJson().Read().ApsWebClientId1;
    public string GetClientSecret() => Storage.GlobalDir().SettingsJson().Read().ApsWebClientSecret1;
}

public class ApsAuthPkce : Aps.IOAuthTokenProvider {
    public string GetClientId() => Storage.GlobalDir().SettingsJson().Read().ApsDesktopClientId1;
    public string GetClientSecret() => null;
}