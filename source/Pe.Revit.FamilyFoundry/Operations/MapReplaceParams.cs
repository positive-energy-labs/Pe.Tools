using Pe.Revit.Extensions.FamDocument;
using Pe.Revit.Extensions.FamParameter;
using Pe.Revit.Extensions.FamParameter.Formula;
using Pe.Revit.Global;
using BCS = Pe.Revit.Extensions.FamDocument.SetValue.BuiltInCoercionStrategy;

namespace Pe.Revit.FamilyFoundry.Operations;

public class MapReplaceParams : DocOperation<MapParamsSettings> {
    private readonly IReadOnlyDictionary<string, SharedParameterMappingTarget> _targetsByName;

    private readonly List<ForgeTypeId> IgnoreCoercionDataTypes = new() {
        SpecTypeId.Number, SpecTypeId.String.Text, SpecTypeId.Length
    };

    public MapReplaceParams(
        MapParamsSettings settings,
        IReadOnlyDictionary<string, SharedParameterMappingTarget> targetsByName
    ) : base(settings) => this._targetsByName = targetsByName;

    public override string Description => "Replace a family's existing parameters with APS shared parameters";

    public override OperationLog Execute(FamilyDocument doc,
        FamilyProcessingContext processingContext,
        OperationContext groupContext) {
        if (groupContext is null) {
            throw new InvalidOperationException(
                $"{this.Name} requires a GroupContext (must be used within an OperationGroup)");
        }

        var fm = doc.FamilyManager;

        foreach (var (mapping, log) in this.Settings.GetIncompleteMappings(groupContext)) {
            var filteredCurrNames = this.Settings.GetRankedCurrParams(
                mapping.CurrNames,
                fm,
                processingContext
            );

            if (!this._targetsByName.TryGetValue(mapping.NewName, out var target)) continue;

            // Try each CurrName in priority order until one succeeds
            var foundMatch = false;
            foreach (var currParam in filteredCurrNames.TakeWhile(_ => !foundMatch)) {
                try {
                    var currParamName = currParam.Definition.Name;
                    if (currParam.IsBuiltInParameter()) {
                        _ = log
                            .WithParameterEvent(
                                ParameterEventOutcome.BuiltInSourceSkipped,
                                ParameterEventReason.BuiltInParameter,
                                sourceParameter: currParamName,
                                targetParameter: target.Name,
                                mappingKey: mapping.NewName,
                                dataType: target.Definition.DataTypeId,
                                isInstance: target.IsInstance)
                            .Defer($"Skipped built-in source candidate {currParamName} → {target.Name}");
                        continue;
                    }

                    if (!target.HasSameDataType(currParam.Definition.GetDataType())) {
                        // Log a message to show user that their priority is respected.
                        _ = log
                            .WithParameterEvent(
                                ParameterEventOutcome.DirectReplaceBlocked,
                                ParameterEventReason.DataTypeMismatch,
                                sourceParameter: currParamName,
                                targetParameter: target.Name,
                                mappingKey: mapping.NewName,
                                dataType: target.Definition.DataTypeId,
                                isInstance: target.IsInstance,
                                details: new Dictionary<string, string> {
                                    ["SourceDataType"] = currParam.Definition.GetDataType().TypeId,
                                    ["TargetDataType"] = target.Definition.DataTypeId ?? string.Empty
                                })
                            .Defer($"{target.Name} cannot replace {currParamName} due to datatype mismatch");
                        break;
                    }

                    var replaced = fm.ReplaceParameter(
                        currParam,
                        target.ExternalDefinition,
                        target.GroupTypeId,
                        target.IsInstance
                    );
                    if (replaced == null) continue;
                    foundMatch = true;
                    var replaceDetails = doc.DescribeSetValue(replaced, replaced, mapping.MappingStrategy)
                        .ToDictionary(detail => detail.Key, detail => detail.Value, StringComparer.Ordinal);
                    replaceDetails["SourceParameterBeforeReplace"] = currParamName;
                    this.LogAndUnwrap(doc, log, mapping.MappingStrategy, currParamName, replaced, target, mapping.NewName, replaceDetails);
                } catch {
                    // Not terminated as error because we must allow retrying later
                    _ = log
                        .WithParameterEvent(
                            ParameterEventOutcome.ReplaceDeferred,
                            ParameterEventReason.Exception,
                            sourceParameter: currParam.Definition.Name,
                            targetParameter: mapping.NewName,
                            mappingKey: mapping.NewName,
                            dataType: target.Definition.DataTypeId,
                            isInstance: target.IsInstance)
                        .Defer($"Failed to map {currParam.Definition.Name} → {mapping.NewName}");
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
        FamilyParameter replaced,
        SharedParameterMappingTarget target,
        string mappingKey,
        IReadOnlyDictionary<string, string> replaceDetails
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
            ? log.WithParameterEvent(
                    ParameterEventOutcome.DirectReplaceAwaitingCoercion,
                    sourceParameter: currParamName,
                    targetParameter: replaced.Definition.Name,
                    mappingKey: mappingKey,
                    dataType: target.Definition.DataTypeId,
                    isInstance: target.IsInstance,
                    details: replaceDetails)
                .Defer($"{msgBase}, awaiting coercion")
            : log.WithParameterEvent(
                    ParameterEventOutcome.DirectReplaceSucceeded,
                    sourceParameter: currParamName,
                    targetParameter: replaced.Definition.Name,
                    mappingKey: mappingKey,
                    dataType: target.Definition.DataTypeId,
                    isInstance: target.IsInstance,
                    details: replaceDetails)
                .Success($"{msgBase}");
        _ = doc.UnsetFormula(replaced);
    }
}
