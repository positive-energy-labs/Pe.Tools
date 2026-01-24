using Pe.Extensions.FamDocument;
using Pe.Extensions.FamManager;
using Pe.Extensions.FamParameter;
using Pe.FamilyFoundry.Operations;
using Pe.FamilyFoundry.OperationSettings;
using Pe.Global;

namespace Pe.FamilyFoundry.OperationGroups;

public class AddAndMapSharedParams(
    MapParamsSettings settings,
    IEnumerable<SharedParameterDefinition> sharedParams)
    : OperationGroup<MapParamsSettings>(
        "Map and add shared parameters (replace, add unmapped, and remap)",
        InitializeOperations(settings, sharedParams),
        settings.MappingData.Select(m => m.NewName)) {
    private static List<IOperation> InitializeOperations(
        MapParamsSettings settings,
        IEnumerable<SharedParameterDefinition> sharedParams
    ) {
        var sharedParameterDefinitions = sharedParams as SharedParameterDefinition[] ?? sharedParams.ToArray();
        var ops = new List<IOperation> {
            new PreProcessMappings(settings, sharedParameterDefinitions),
            new MapReplaceParams(settings, sharedParameterDefinitions),
            new AddUnmappedSharedParams(settings, sharedParameterDefinitions)
        };
        if (!settings.DisablePerTypeFallback) ops.Add(new MapParams(settings));
        ops.Add(new BacklinkParamsToBuiltIn(settings));

        return ops;
    }
}
 
public class PreProcessMappings(
    MapParamsSettings settings,
    IEnumerable<SharedParameterDefinition> sharedParams
) : DocOperation<MapParamsSettings>(settings) {
    public override string Description =>
        "Mark irrelevant mapping data as skipped and attempt to map CurrNames that are built-in parameters";

    public override OperationLog Execute(FamilyDocument doc,
        FamilyProcessingContext processingContext,
        OperationContext groupContext) {
        if (groupContext is null) {
            throw new InvalidOperationException(
                $"{this.Name} requires a GroupContext (must be used within an OperationGroup)");
        }

        var fm = doc.FamilyManager;
        var sharedParamsDict = sharedParams.ToDictionary(p => p.ExternalDefinition.Name);

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

            var sharedParamFound = sharedParamsDict.TryGetValue(mapping.NewName, out var sharedParam);

            if (fm.FindParameter(mapping.NewName) != null) {
                _ = filteredCurrNames.Count == 0
                    ? log.Skip("Target shared parameter already exists and no useful source parameter/s found")
                    : log.Defer("Target shared parameter already exists, awaiting possible coercion");
                continue;
            }

            if (!sharedParamFound) {
                _ = log.Skip("Target shared parameter not found");
                continue;
            }

            if (filteredCurrNames.Count == 0) {
                _ = log.Skip("Useful source parameter/s not found");
                continue;
            }

            // Try each CurrName in priority order until one succeeds
            var foundMatch = false;
            foreach (var currParam in filteredCurrNames.TakeWhile(_ => !foundMatch)) {
                try {
                    if (!currParam.IsBuiltInParameter()) continue;
                    if (this.TryMapBuiltInParameter(doc, currParam, sharedParam, out var builtInLogMsg)) {
                        foundMatch = true;
                        _ = log.Success(builtInLogMsg);
                    }
                } catch (Exception) {
                    _ = log.Defer($"{currParam} → {mapping.NewName}"); // allow retrying 
                }
            }
        }

        return new OperationLog(this.Name, groupContext.TakeSnapshot());
    }

    private bool TryMapBuiltInParameter(
        FamilyDocument doc,
        FamilyParameter builtInParam,
        SharedParameterDefinition sharedParam,
        out string logMessage) {
        logMessage = null;
        var builtInParamName = builtInParam.Definition.Name;
        try {
            // Add the shared parameter (returns existing if already present)
            var builtInDataType = builtInParam.Definition.GetDataType();
            var sharedDataType = sharedParam.ExternalDefinition.GetDataType();

            if (builtInDataType == sharedDataType) {
                var newParam = doc.AddSharedParameter(sharedParam);
                if (!doc.TrySetFormula(newParam, builtInParamName, out var errorMessage)) {
                    logMessage = $"Failed to set formula on parameter {newParam.Definition.Name}: {errorMessage}";
                    return false;
                }

                _ = doc.UnsetFormula(newParam);
                logMessage = $"Mapped built-in {builtInParamName} → {newParam.Definition.Name}";
            }
        } catch (Exception ex) {
            logMessage = $"Failed to map built-in {builtInParamName}: {ex.Message}";
            return false;
        }

        return true;
    }
}

public class AddUnmappedSharedParams(
    MapParamsSettings settings,
    IEnumerable<SharedParameterDefinition> sharedParams)
    : DocOperation<MapParamsSettings>(settings) {
    public override string Description =>
        "Add shared parameters that are not already processed by a previous operation";

    public override OperationLog Execute(
        FamilyDocument doc,
        FamilyProcessingContext processingContext,
        OperationContext groupContext
    ) {
        // Get already-handled params from GroupContext
        var existingParams = doc.FamilyManager.Parameters
            .OfType<FamilyParameter>()
            .Select(p => p.Definition.Name)
            .ToHashSet();
        var addParams = sharedParams
            .Where(p => !existingParams.Contains(p.ExternalDefinition.Name));

        var addSharedParams = new AddSharedParams(addParams) { Name = this.Name };
        return addSharedParams.Execute(doc, processingContext, groupContext);
    }
}