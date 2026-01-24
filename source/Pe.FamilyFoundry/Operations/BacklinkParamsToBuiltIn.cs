using Pe.Extensions.FamDocument;
using Pe.Extensions.FamDocument.GetValue;
using Pe.Extensions.FamManager;
using Pe.Extensions.FamParameter;
using Pe.FamilyFoundry.OperationSettings;

namespace Pe.FamilyFoundry.Operations;

/// <summary>
///     Creates backlinks from built-in parameters to their mapped shared parameter targets.
///     Sets formulas like: Model = PE_G___Model, so the built-in derives from the shared param.
/// </summary>
public class BacklinkParamsToBuiltIn(MapParamsSettings settings)
    : DocOperation<MapParamsSettings>(settings) {
    public override string Description => "Create backlinks from built-in params to their mapped targets";

    public override OperationLog Execute(FamilyDocument doc,
        FamilyProcessingContext processingContext,
        OperationContext _) {
        var fm = doc.FamilyManager;

        // Find first built-in in CurrNames (priority order) and backlink it
        var data = this.Settings.MappingData
            .Select(m => (
                newParam: fm.FindParameter(m.NewName),
                currParams: m.CurrNames.Select(fm.FindParameter)
                    .Where(p => p != null && p.IsBuiltInParameter()).ToList()
            ))
            .Where(m => m.newParam is not null)
            .Where(m => m.currParams.Any())
            .ToList();

        var logs = new List<LogEntry>();
        foreach (var (newParam, currParams) in data) {
            foreach (var currParam in currParams) {
                if (newParam == null || currParam == null) break;
                var log = new LogEntry($"Backlink {newParam.Definition.Name} → {currParam.Definition.Name}");
                var successfulLink = doc.TrySetFormulaFast(currParam, newParam.Definition.Name, out var err);
                logs.Add(successfulLink
                    ? log.Success("Successfully backlinked")
                    : log.Error(err ?? "Failed to set formula"));
                break; // Only backlink first matching built-in per mapping
            }
        }

        return new OperationLog(this.Name, logs);
    }
}