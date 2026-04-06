using Pe.Revit.Extensions.FamDocument;
using Pe.Revit.Extensions.FamParameter;
using Pe.Revit.Extensions.FamParameter.Formula;
using Pe.FamilyFoundry.OperationSettings;
using Pe.Revit.Global;
using BCS = Pe.Revit.Extensions.FamDocument.SetValue.BuiltInCoercionStrategy;

namespace Pe.FamilyFoundry.Operations;

public class MapReplaceParams : DocOperation<MapParamsSettings> {
    private readonly Dictionary<string, SharedParameterDefinition> _sharedParamsDict;

    private readonly List<ForgeTypeId> IgnoreCoercionDataTypes = new() {
        SpecTypeId.Number, SpecTypeId.String.Text, SpecTypeId.Length
    };

    public MapReplaceParams(
        MapParamsSettings settings,
        IEnumerable<SharedParameterDefinition> sharedParams
    ) : base(settings) => this._sharedParamsDict = sharedParams.ToDictionary(p => p.ExternalDefinition.Name);

    public override string Description => "Replace a family's existing parameters with APS shared parameters";

    public override OperationLog Execute(FamilyDocument doc,
        FamilyProcessingContext processingContext,
        OperationContext groupContext) {
        if (groupContext is null) {
            throw new InvalidOperationException(
                $"{this.Name} requires a GroupContext (must be used within an OperationGroup)");
        }

        var fm = doc.FamilyManager;
        var data = groupContext.GetAllInComplete().Select(e => {
            var mapping = this.Settings.MappingData.First(m => e.Key == m.NewName);
            return (mapping, e.Value);
        });

        foreach (var (mapping, log) in data) {
            var filteredCurrNames = this.Settings.GetRankedCurrParams(
                mapping.CurrNames,
                fm,
                processingContext
            );

            _ = this._sharedParamsDict.TryGetValue(mapping.NewName, out var sharedParam);
            if (sharedParam == null) continue;

            // Try each CurrName in priority order until one succeeds
            var foundMatch = false;
            foreach (var currParam in filteredCurrNames.TakeWhile(_ => !foundMatch)) {
                try {
                    var currParamName = currParam.Definition.Name;
                    if (currParam.IsBuiltInParameter()) continue;
                    if (currParam.Definition.GetDataType() != sharedParam.ExternalDefinition.GetDataType()) {
                        // Log a message to show user that their priority is respected.
                        _ = log.Defer(
                            $"{sharedParam.ExternalDefinition.Name} cannot replace {currParamName} due to datatype mismatch");
                        break;
                    }

                    var replaced = fm.ReplaceParameter(
                        currParam,
                        sharedParam.ExternalDefinition,
                        sharedParam.GroupTypeId,
                        sharedParam.IsInstance
                    );
                    if (replaced == null) continue;
                    foundMatch = true;
                    this.LogAndUnwrap(doc, log, mapping.MappingStrategy, currParamName, replaced);
                } catch {
                    // Not terminated as error because we must allow retrying later
                    _ = log.Defer($"Failed to map {currParam.Definition.Name} → {mapping.NewName}");
                }
            }
        }

        return new OperationLog(this.Name, groupContext.TakeSnapshot());
    }

    /// <summary>
    ///     Logs the replaced parameter and attempts to unwrap it.
    /// </summary>
    private void LogAndUnwrap(
        FamilyDocument doc,
        LogEntry log,
        string mappingStrategy,
        string currParamName,
        FamilyParameter replaced
    ) {
        var parameters = doc.FamilyManager.Parameters;

        // Unwrap stuff for which we've already captured the value of. Allows more to be purged later.
        var referencedParam = parameters.TryGetSingleReference(replaced.Formula);
        if (referencedParam != null) _ = doc.UnsetFormula(referencedParam);

        // Defer only when the value is coercible, and the mapping strategy is not a simple one. 
        // A Tale Of Struggles: The actual contents of the formula are irrelevant for this decision 
        var msgBase = $"Replaced {currParamName} → {replaced.Definition.Name}";
        var coercibleDataType = this.IgnoreCoercionDataTypes.Contains(replaced.Definition.GetDataType());
        var coercionStrategySimple = mappingStrategy is nameof(BCS.Strict) or nameof(BCS.CoerceByStorageType);
        _ = coercibleDataType && !coercionStrategySimple
            ? log.Defer($"{msgBase}, awaiting coercion")
            : log.Success($"{msgBase}");
        _ = doc.UnsetFormula(replaced);
    }
}