using Pe.FamilyFoundry.Aggregators.Snapshots;
using Pe.FamilyFoundry.Operations;
using Pe.FamilyFoundry.OperationSettings;

namespace Pe.FamilyFoundry.OperationGroups;

/// <summary>
///     Operation group that optionally creates missing family types and parameters, then sets their values/formulas.
///     Execution order:
///     0. CreateFamilyTypes (if CreateMissingFamilyTypes=true) - creates missing family types from ValuesPerType keys
///     1. AddFamilyParams (if CreateFamParamIfMissing=true) - creates missing family params
///     2. SetParamValues - sets formulas (default) or global values based on SetAsFormula property
///     3. SetParamValuesPerType - handles explicit per-type values and failed global value fallbacks
/// </summary>
public class AddAndSetParams(AddAndSetParamsSettings settings, bool createMissingFamilyTypes = false)
    : OperationGroup<AddAndSetParamsSettings>(
        InitializeDescription(),
        InitializeOperations(settings, createMissingFamilyTypes),
        settings.Parameters.Select(p => p.Name)) {
    public static string InitializeDescription() =>
        $"Set a parameter within the family to a value or formula. " +
        $"By default, values are set as formulas (even simple numbers/text). Use <{nameof(ParamSettingModel.SetAsFormula)}>=false to set as values instead. " +
        $"If <{nameof(AddAndSetParamsSettings.OverrideExistingValues)}> is true, then existing parameter values will be overwritten. " +
        $"If <{nameof(AddAndSetParamsSettings.CreateFamParamIfMissing)}> is true, then a family parameter will be created " +
        $"with <{nameof(ParamDefinitionBase.Name)}>. The default values of the parameter are:" +
        $"\n\t<{nameof(ParamDefinitionBase.PropertiesGroup)}>: <{new ParamDefinitionBase { Name = "" }.PropertiesGroup.ToLabel()}>" +
        $"\n\t<{nameof(ParamDefinitionBase.DataType)}>: <{new ParamDefinitionBase { Name = "" }.DataType.ToLabel()}>>" +
        $"\n\t<{nameof(ParamDefinitionBase.IsInstance)}>: <{GetDesignation(new ParamDefinitionBase { Name = "" }.IsInstance)}>";

    private static string GetDesignation(bool isInstance) => isInstance ? "Instance" : "Type";

    private static List<IOperation> InitializeOperations(
        AddAndSetParamsSettings settings,
        bool createMissingFamilyTypes
    ) {
        var ops = new List<IOperation>();

        // 0. Optionally create missing family types first (before anything else)
        if (createMissingFamilyTypes)
            ops.Add(new CreateFamilyTypes(settings));

        // 1. Optionally create missing params
        if (settings.CreateFamParamIfMissing)
            ops.Add(new AddFamilyParams(settings));

        // 2. Set global/formula values (with per-type fallback tracking via OperationContext)
        if (settings.Parameters.Any(p => !string.IsNullOrEmpty(p.ValueOrFormula))) {
            ops.Add(new SetParamValues(settings));
            // 3. Set explicit per-type values AND handle fallbacks from SetParamValues failures
            if (createMissingFamilyTypes || !settings.DisablePerTypeFallback) ops.Add(new SetParamValuesPerType(settings));
        }

        return ops;
    }
}