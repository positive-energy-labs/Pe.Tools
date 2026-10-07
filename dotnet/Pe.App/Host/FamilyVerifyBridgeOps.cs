using Pe.Revit.Failures;
using Pe.Revit.FamilyFoundry.Verify;
using Pe.Shared.HostContracts.Operations;
using Pe.Shared.RevitData.Families;
using FamilyDocument = Pe.Revit.Operations.FamilyDocument;

namespace Pe.App.Host;

internal static class FamilyVerifyBridgeOps {
    [Op("family.look", Does = "Inspect every selected family type and Yes/No toggle off/on: geometry census in inches and geometry-only plan, X/Y elevations and isometric PNGs. Rolls back all family changes. Family editor images can draw invisible geometry; read the visibility census too.", Title = "Look at Family", Finds = ["family", "verify", "images", "geometry", "toggle"], Cost = OpCost.Expensive, Thread = OpThread.Revit)]
    private static FamilyLookData Look(FamilyLookRequest request, FamilyDocument document) =>
        WithoutDialogs(() => document.Value.LookFamily(request));

    [Op("family.loadTest", Does = "Load the open family into a disposable project, place each selected type, export plan/elevation/3D PNGs and inspect project warnings, resolved failures, nested name duplicates and exposed instance connectors. Closes the scratch project without saving and never saves the family.", Title = "Test Family Load", Finds = ["family", "verify", "load", "warnings", "duplicates", "connectors"], Cost = OpCost.Expensive, Thread = OpThread.Revit)]
    private static FamilyLoadTestData LoadTest(FamilyLoadTestRequest request, FamilyDocument document) =>
        WithoutDialogs(() => document.Value.LoadTestFamily(request));

    private static T WithoutDialogs<T>(Func<T> run) {
        var dialogs = new List<(bool IsError, string Message)>();
        try {
            var result = RevitDialogs.NoModal(dialogs, run);
            if (dialogs.Count != 0)
                throw BridgeOperationExceptions.Conflict("Family verification encountered a dialog.",
                    dialogs.Select(d => BridgeOperationExceptions.Issue("$", "DialogRefused", d.Message, null)).ToList());
            return result;
        } catch (Exception exception) when (dialogs.Count != 0) {
            throw BridgeOperationExceptions.Conflict(exception.Message,
                dialogs.Select(d => BridgeOperationExceptions.Issue("$", "DialogRefused", d.Message, null)).ToList());
        }
    }
}
