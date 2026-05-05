using Pe.Shared.ApsAuth;
using Autodesk.Revit.Attributes;
using Autodesk.Revit.UI;
using Pe.App.SettingsEditor;
using Pe.Revit.Global.Services.Host;
using Pe.Revit.Global.Ui;
using Pe.Shared.HostContracts.Operations;
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
            var hostLaunchResult = SettingsEditorHostLauncher.EnsureRunning();
            if (!hostLaunchResult.Success)
                throw new InvalidOperationException(hostLaunchResult.Message);

            var status = Task.Run(async () =>
                    await new HostLocalOperationClient().ExecuteAsync<ApsTokenRequest, ApsPersistedTokenStatus>(
                        LoginApsOperationContract.Definition,
                        ApsTokenRequest.ForParameterService()
                    )
                )
                .GetAwaiter()
                .GetResult();

            var detail =
                $"Persisted auth: {(status.Exists ? "present" : "missing")}, flow={status.FlowKind}, scope={status.ScopeProfile}, expiresUtc={status.ExpiresAtUtc?.ToString("O") ?? "(unknown)"}";
            new Ballogger().AddDebug(LogEventLevel.Information, new StackFrame(), detail).Show();
            return Result.Succeeded;
        } catch (Exception ex) {
            new Ballogger().Add(LogEventLevel.Error, null, ex.Message).Show();
            return Result.Failed;
        }
    }
}
