using Pe.Revit.Extensions.FamDocument;
using Pe.Revit.Extensions.FamManager;
using Pe.Revit.Extensions.FamParameter;
using Pe.Revit.FamilyFoundry.Operations;
using Pe.Revit.Global;

namespace Pe.Revit.FamilyFoundry.OperationGroups;

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
        var sharedParameterTargets = SharedParameterMappingTargets.ByName(sharedParams);
        var ops = settings.Enabled
            ? new List<IOperation> {
                new PreProcessMappings(settings, sharedParameterTargets),
                new MapReplaceParams(settings, sharedParameterTargets),
                new AddUnmappedSharedParams(settings, sharedParameterTargets)
            }
            : [];
        if (!settings.DisablePerTypeFallback) ops.Add(new MapParams(settings));
        ops.Add(new BacklinkParamsToBuiltIn(settings));

        return ops;
    }
}

public class PreProcessMappings(
    MapParamsSettings settings,
    IReadOnlyDictionary<string, SharedParameterMappingTarget> targetsByName
) : DocOperation<MapParamsSettings>(settings) {
    public override string Description =>
        "Mark irrelevant mapping data as skipped and attempt to map CurrNames that are built-in parameters";

    public override OperationLog Execute(
        FamilyDocument doc,
        FamilyProcessingContext processingContext,
        OperationContext groupContext
    ) {
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

            if (!targetsByName.TryGetValue(mapping.NewName, out var target)) {
                _ = log
                    .WithParameterEvent(
                        ParameterEventOutcome.TargetMissingFromSharedSet,
                        ParameterEventReason.TargetNotInFilteredSharedSet,
                        targetParameter: mapping.NewName,
                        mappingKey: mapping.NewName)
                    .Skip($"Mapping data 'NewName' ({mapping.NewName}) does not match a shared parameter from the filtered set");
                continue;
            }

            if (fm.FindParameter(mapping.NewName) != null) {
                _ = filteredCurrNames.Count == 0
                    ? log.WithParameterEvent(
                            ParameterEventOutcome.TargetAlreadyExists,
                            ParameterEventReason.SourceParameterMissing,
                            targetParameter: mapping.NewName,
                            mappingKey: mapping.NewName,
                            dataType: target.Definition.DataTypeId,
                            isInstance: target.IsInstance)
                        .Skip("Target shared parameter already exists and no useful source parameter/s found")
                    : log.WithParameterEvent(
                            ParameterEventOutcome.TargetAlreadyExists,
                            ParameterEventReason.TargetAlreadyPresent,
                            targetParameter: mapping.NewName,
                            mappingKey: mapping.NewName,
                            dataType: target.Definition.DataTypeId,
                            isInstance: target.IsInstance)
                        .Defer("Target shared parameter already exists, awaiting possible coercion");
                continue;
            }

            if (filteredCurrNames.Count == 0) {
                _ = log
                    .WithParameterEvent(
                        ParameterEventOutcome.SourceMissing,
                        ParameterEventReason.SourceParameterMissing,
                        targetParameter: mapping.NewName,
                        mappingKey: mapping.NewName,
                        dataType: target.Definition.DataTypeId,
                        isInstance: target.IsInstance)
                    .Skip("Useful source parameter/s do not exist");
                continue;
            }

            // Try each CurrName in priority order until one succeeds
            var foundMatch = false;
            foreach (var currParam in filteredCurrNames.TakeWhile(_ => !foundMatch)) {
                try {
                    if (!currParam.IsBuiltInParameter()) continue;
                    foundMatch = TryMapBuiltInParameter(doc, currParam, target);
                    if (foundMatch)
                        _ = log
                            .WithParameterEvent(
                                ParameterEventOutcome.BuiltInMappingSucceeded,
                                ParameterEventReason.BuiltInParameter,
                                sourceParameter: currParam.Definition.Name,
                                targetParameter: target.Name,
                                mappingKey: mapping.NewName,
                                dataType: target.Definition.DataTypeId,
                                isInstance: target.IsInstance)
                            .Success($"Mapped built-in {currParam.Definition.Name} → {target.Name}");
                } catch {
                    _ = log
                        .WithParameterEvent(
                            ParameterEventOutcome.ReplaceDeferred,
                            ParameterEventReason.Exception,
                            sourceParameter: currParam.Definition.Name,
                            targetParameter: mapping.NewName,
                            mappingKey: mapping.NewName,
                            dataType: target.Definition.DataTypeId,
                            isInstance: target.IsInstance)
                        .Defer($"{currParam} → {mapping.NewName}"); // allow retrying
                }
            }
        }

        return new OperationLog(this.Name, groupContext.TakeSnapshot());
    }

    private static bool TryMapBuiltInParameter(
        FamilyDocument doc,
        FamilyParameter builtInParam,
        SharedParameterMappingTarget target
    ) {
        try {
            var builtInParamName = builtInParam.Definition.Name;
            var builtInDataType = builtInParam.Definition.GetDataType();

            if (target.HasSameDataType(builtInDataType)) {
                var newParam = doc.AddSharedParameter(target.SharedParameter);
                if (!doc.TrySetFormula(newParam, builtInParamName, out _)) return false;
                _ = doc.UnsetFormula(newParam);
            }
        } catch {
            return false;
        }

        return true;
    }
}

public class AddUnmappedSharedParams(
    MapParamsSettings settings,
    IReadOnlyDictionary<string, SharedParameterMappingTarget> targetsByName)
    : DocOperation<MapParamsSettings>(settings) {
    public override string Description =>
        "Add shared parameters that are not already processed by a previous operation";

    public override OperationLog Execute(
        FamilyDocument doc,
        FamilyProcessingContext processingContext,
        OperationContext groupContext
    ) {
        var existingParams = doc.FamilyManager.Parameters
            .OfType<FamilyParameter>()
            .Select(p => p.Definition.Name)
            .ToHashSet(StringComparer.Ordinal);
        var mappingsByNewName = this.Settings.GetMappingsByNewName();
        var addTargets = targetsByName.Values
            .Where(target => !existingParams.Contains(target.Name))
            .Where(target => ShouldAddTarget(target.Name, doc.FamilyManager, mappingsByNewName));

        var addSharedParams = new AddSharedParams(addTargets) { Name = this.Name };
        return addSharedParams.Execute(doc, processingContext, groupContext);
    }

    private static bool ShouldAddTarget(
        string targetName,
        FamilyManager familyManager,
        IReadOnlyDictionary<string, MappingData> mappingsByNewName
    ) {
        if (!mappingsByNewName.TryGetValue(targetName, out var mapping))
            return true;

        if (!mapping.OnlyAddIfSourceExists)
            return true;

        return mapping.CurrNames
            .Where(name => !string.IsNullOrWhiteSpace(name))
            .Select(familyManager.FindParameter)
            .Any(parameter => parameter != null);
    }
}
