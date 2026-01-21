using Pe.Extensions.FamDocument;
using Pe.Extensions.FamManager;
using Pe.FamilyFoundry.OperationSettings;

namespace Pe.FamilyFoundry.Operations;

/// <summary>
///     Copies parameter values from source params to target params for the current family type.
///     Iterates through CurrNames in priority order, using the first match found.
/// </summary>
public class MapParams(MapParamsSettings settings)
    : TypeOperation<MapParamsSettings>(settings) {
    public override string Description => "Map an old parameter's value to a new parameter for each family type";

    public override OperationLog Execute(FamilyDocument doc,
        FamilyProcessingContext processingContext,
        OperationContext groupContext) {
        if (groupContext is null) {
            throw new InvalidOperationException(
                $"{this.Name} requires a GroupContext (must be used within an OperationGroup)");
        }

        var fm = doc.FamilyManager;

        var incomplete = groupContext.GetAllInComplete();
        if (incomplete.Count == 0) this.AbortOperation("All mappings were handled by prior operations");

        var data = incomplete.Select(e => {
            var mapping = this.Settings.MappingData.First(m => e.Key == m.NewName);
            return (mapping, e.Value);
        });

        foreach (var (mapping, log) in data) {
            var tgtParam = fm.FindParameter(mapping.NewName);
            if (tgtParam == null) continue;

            // Try each CurrName in priority order until one succeeds
            var prioritizedCurrParams = this.Settings.GetRankedCurrParams(
                mapping.CurrNames,
                fm,
                processingContext
            );

            var succeeded = false;
            Exception? lastException = null;
            var lastMappingDesc = string.Empty;

            foreach (var currParam in prioritizedCurrParams) {
                var mappingDesc = $"{currParam.Definition.Name} → {mapping.NewName}";
                lastMappingDesc = mappingDesc;
                try {
                    if (tgtParam.Formula != null) _ = doc.UnsetFormula(tgtParam);

                    _ = doc.SetValue(tgtParam, currParam, mapping.MappingStrategy);
                    // this should really be "success" but the rest of the family types wont process if it is
                    // TODO: make a new method for marking type ops success
                    _ = log.Defer(tgtParam != currParam
                        ? $"Coerced {mappingDesc} using {mapping.MappingStrategy}"
                        : $"Set {mappingDesc}");
                    succeeded = true;
                    break; // Success - skip remaining CurrNames
                } catch (Exception ex) {
                    // Don't mark as error yet - try remaining CurrParams first
                    lastException = ex;
                }
            }

            // Only mark as error if ALL CurrParams failed and entry is still incomplete
            if (!succeeded && lastException != null && !log.IsComplete) _ = log.Error(lastMappingDesc, lastException);
        }

        return new OperationLog(this.Name, groupContext.TakeSnapshot());
    }
}