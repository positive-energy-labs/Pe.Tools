using Pe.Revit.Extensions.FamDocument;
using Pe.Revit.Extensions.FamManager;

namespace Pe.Revit.FamilyFoundry.Operations;

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

        foreach (var (mapping, log) in this.Settings.GetIncompleteMappings(groupContext)) {
            var tgtParam = fm.FindParameter(mapping.NewName);
            if (tgtParam == null) {
                _ = log
                    .WithParameterEvent(
                        ParameterEventOutcome.TargetMissing,
                        ParameterEventReason.TargetParameterMissing,
                        targetParameter: mapping.NewName,
                        mappingKey: mapping.NewName)
                    .Defer($"Target parameter '{mapping.NewName}' not found");
                continue;
            }

            // Try each CurrName in priority order until one succeeds
            var prioritizedCurrParams = this.Settings.GetRankedCurrParams(
                mapping.CurrNames,
                fm,
                processingContext
            );

            var succeeded = false;
            Exception? lastException = null;
            IReadOnlyDictionary<string, string>? lastSetValueDetails = null;
            var lastMappingDesc = string.Empty;

            foreach (var currParam in prioritizedCurrParams) {
                var mappingDesc = $"{currParam.Definition.Name} → {mapping.NewName}";
                lastMappingDesc = mappingDesc;
                try {
                    // Empty string values are common for optional per-type data.
                    // Treat them as "no value for this type" so later types can still map.
                    var sourceValue = doc.GetValue(currParam);
                    var setValueDetails = doc.DescribeSetValue(tgtParam, currParam, mapping.MappingStrategy);
                    lastSetValueDetails = setValueDetails;
                    if (sourceValue is string str && string.IsNullOrWhiteSpace(str)) {
                        _ = log
                            .WithParameterEvent(
                                ParameterEventOutcome.EmptySourceValue,
                                ParameterEventReason.EmptySourceValue,
                                sourceParameter: currParam.Definition.Name,
                                targetParameter: mapping.NewName,
                                mappingKey: mapping.NewName,
                                details: setValueDetails)
                            .Defer($"Skipped empty source value for {mappingDesc}");
                        continue;
                    }

                    var hadFormula = tgtParam.Formula != null;
                    if (hadFormula) _ = doc.UnsetFormula(tgtParam);

                    _ = doc.SetValue(tgtParam, currParam, mapping.MappingStrategy);
                    // this should really be "success" but the rest of the family types wont process if it is
                    // TODO: make a new method for marking type ops success
                    _ = log
                        .WithParameterEvent(
                            ParameterEventOutcome.ValueMapped,
                            hadFormula
                                ? ParameterEventReason.FormulaPresent
                                : ParameterEventReason.NotApplicable,
                            sourceParameter: currParam.Definition.Name,
                            targetParameter: mapping.NewName,
                            mappingKey: mapping.NewName,
                            details: setValueDetails)
                        .Defer(tgtParam != currParam
                            ? $"Coerced {mappingDesc} using {mapping.MappingStrategy}"
                            : $"Set {mappingDesc}");
                    succeeded = true;
                    break; // Success - skip remaining CurrNames
                } catch (Exception ex) {
                    // Don't mark as error yet - try remaining CurrParams first
                    lastException = ex;
                }
            }

            // Keep uncoercible real-family values visible without turning an optional mapping miss into a family failure.
            if (!succeeded && lastException != null && !log.IsComplete)
                _ = log
                    .WithParameterEvent(
                        ParameterEventOutcome.AllSourceCandidatesFailed,
                        ParameterEventReason.Exception,
                        targetParameter: mapping.NewName,
                        mappingKey: mapping.NewName,
                        details: lastSetValueDetails)
                    .Defer($"All source candidates failed for {lastMappingDesc}: {lastException.Message}");
        }

        return new OperationLog(this.Name, groupContext.TakeSnapshot());
    }
}
