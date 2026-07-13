using Pe.Revit.DocumentData.ParameterLinks;
using Pe.Shared.RevitData;
using Serilog;
using RevitDocument = Autodesk.Revit.DB.Document;

namespace Pe.Revit.Global.Services.ParameterLinks;

internal sealed class ParameterLinksUpdater : IUpdater {
    private static readonly Guid ProductUpdaterGuid = new("c5faec49-1498-4cec-95b8-c4eba02b20ff");
    private readonly Func<RevitDocument, ParameterLinkProfile?> _resolveProfile;
    private readonly UpdaterId _updaterId;

    public ParameterLinksUpdater(
        AddInId addInId,
        Func<RevitDocument, ParameterLinkProfile?> resolveProfile,
        Guid? updaterGuid = null
    ) {
        this._resolveProfile = resolveProfile;
        this._updaterId = new UpdaterId(addInId, updaterGuid ?? ProductUpdaterGuid);
    }

    public void Execute(UpdaterData data) {
        try {
            var document = data.GetDocument();
            var profile = this._resolveProfile(document);
            if (profile == null)
                return;
            var (evaluation, applied) = ParameterLinksEngine.Reconcile(document, profile);
            if (applied > 0)
                Log.Information("Parameter Links: updater applied {Count} write(s) in '{Title}'", applied,
                    document.Title);
            foreach (var issue in evaluation.Issues.Where(issue => issue.Severity == ParameterLinkIssueSeverity.Error))
                Log.Warning("Parameter Links: updater {Code}: {Message}", issue.Code, issue.Message);
        } catch (Exception ex) {
            Log.Error(ex, "Parameter Links: updater execution failed");
        }
    }

    public UpdaterId GetUpdaterId() => this._updaterId;
    public ChangePriority GetChangePriority() => ChangePriority.MEPSystems;
    public string GetUpdaterName() => "Pe.Tools Parameter Links";
    public string GetAdditionalInformation() => "Keeps configured Revit parameters synchronized.";
}
