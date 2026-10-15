using Autodesk.Revit.Attributes;
using Autodesk.Revit.UI;
using Pe.App.Host;
using Serilog;

namespace Pe.App.Commands.PeTools;

/// <summary>Thin browser entrypoint. Product routes own target selection; a ribbon click does not resume Work.</summary>
public abstract class ProductLaunchCommand : IExternalCommand {
    protected abstract string Route { get; }

    public Result Execute(ExternalCommandData commandData, ref string message, ElementSet elements) {
        try {
            var connection = HostBridgeConnector.EnsureConnected();
            if (!connection.Success) {
                message = connection.RuntimeActionResult.Message;
                return Result.Failed;
            }

            // The broker session id is private to HostRuntime. Never replace an exact target with a path or SDK selector.
            if (!PeToolsBrowser.TryLaunchRoute(this.Route)) {
                message = "Could not open Pe.Tools in your browser. Use Connection / Setup to inspect the host connection.";
                return Result.Failed;
            }

            Log.Information("Opened Pe.Tools product route {Route}; the product owns target selection", this.Route);
            return Result.Succeeded;
        } catch (Exception ex) {
            Log.Error(ex, "Pe.Tools product launch failed for {Route}", this.Route);
            message = ex.Message;
            return Result.Failed;
        }
    }
}

[Transaction(TransactionMode.Manual)]
public sealed class CmdPeToolsHome : ProductLaunchCommand {
    protected override string Route => "/";
}

[Transaction(TransactionMode.Manual)]
public sealed class CmdPea : ProductLaunchCommand {
    protected override string Route => "/pea";
}

[Transaction(TransactionMode.Manual)]
public sealed class CmdFamilyEditor : ProductLaunchCommand {
    protected override string Route => "/family";
}

[Transaction(TransactionMode.Manual)]
public sealed class CmdFamilyAudit : ProductLaunchCommand {
    protected override string Route => "/families";
}

[Transaction(TransactionMode.Manual)]
public sealed class CmdSchedulesWeb : ProductLaunchCommand {
    protected override string Route => "/schedules";
}

[Transaction(TransactionMode.Manual)]
public sealed class CmdTakeoffsWeb : ProductLaunchCommand {
    protected override string Route => "/takeoffs";
}

[Transaction(TransactionMode.Manual)]
public sealed class CmdPodsWeb : ProductLaunchCommand {
    protected override string Route => "/pods";
}
