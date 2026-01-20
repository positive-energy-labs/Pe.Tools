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
        // Sort parameters by dependency order (modifies the Parameters list in place)
        var sortedParams = SortByDependencies(settings.Parameters);
        settings.Parameters.Clear();
        settings.Parameters.AddRange(sortedParams);

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
        }

        // 3. Set explicit per-type values AND handle fallbacks from SetParamValues failures
        ops.Add(new SetParamValuesPerType(settings));

        return ops;
    }

    /// <summary>
    ///     Sorts parameters by dependency order using topological sort (Kahn's algorithm).
    ///     Parameters with no dependencies come first, followed by parameters that depend on them.
    /// </summary>
    private static List<ParamSettingModel> SortByDependencies(List<ParamSettingModel> parameters) {
        // IMPORTANT: Always return a NEW list to avoid the caller clearing the original
        // when they do Clear() + AddRange() with the returned list
        if (parameters.Count <= 1) return new List<ParamSettingModel>(parameters);

        // Build map of param name -> param for O(1) lookup
        var paramByName = parameters.ToDictionary(p => p.Name, StringComparer.Ordinal);
        var paramNames = new HashSet<string>(paramByName.Keys, StringComparer.Ordinal);

        // Build dependency graph: paramName -> set of param names it depends on
        var dependencies = new Dictionary<string, HashSet<string>>(StringComparer.Ordinal);
        var inDegree = new Dictionary<string, int>(StringComparer.Ordinal);

        foreach (var p in parameters) {
            var deps = ExtractReferencedParamNames(p.ValueOrFormula, paramNames);
            dependencies[p.Name] = deps;
            inDegree[p.Name] = deps.Count;
        }

        // Kahn's algorithm: start with nodes that have no dependencies
        var queue = new Queue<string>();
        foreach (var p in parameters.Where(p => inDegree[p.Name] == 0))
            queue.Enqueue(p.Name);

        var sorted = new List<ParamSettingModel>();
        var processed = new HashSet<string>(StringComparer.Ordinal);

        while (queue.Count > 0) {
            var paramName = queue.Dequeue();
            sorted.Add(paramByName[paramName]);
            _ = processed.Add(paramName);

            // For each parameter that depends on this one, decrement its in-degree
            foreach (var dependent in parameters.Where(p => dependencies[p.Name].Contains(paramName))) {
                inDegree[dependent.Name]--;
                if (inDegree[dependent.Name] == 0)
                    queue.Enqueue(dependent.Name);
            }
        }

        // Check for circular dependencies
        if (sorted.Count < parameters.Count) {
            var unprocessed = parameters.Where(p => !processed.Contains(p.Name)).Select(p => p.Name).ToList();
            throw new InvalidOperationException(
                $"Circular dependency detected among parameters: {string.Join(", ", unprocessed)}. " +
                $"Revit cannot resolve circular formula references.");
        }

        return sorted;
    }

    /// <summary>
    ///     Extracts parameter names referenced in a formula string.
    ///     Only returns names that exist in the provided set of valid parameter names.
    /// </summary>
    private static HashSet<string> ExtractReferencedParamNames(string formula, HashSet<string> validParamNames) {
        if (string.IsNullOrWhiteSpace(formula))
            return new HashSet<string>(StringComparer.Ordinal);

        var referenced = new HashSet<string>(StringComparer.Ordinal);

        // Check each valid param name to see if it's referenced in the formula
        foreach (var paramName in validParamNames) {
            if (IsParamReferencedInFormula(paramName, formula))
                _ = referenced.Add(paramName);
        }

        return referenced;
    }

    /// <summary>
    ///     Checks if a parameter name is referenced in a formula with proper boundary validation.
    ///     Adapted from FormulaReferences.IsReferencedIn but works with strings instead of FamilyParameter objects.
    /// </summary>
    private static bool IsParamReferencedInFormula(string paramName, string formula) {
        if (string.IsNullOrEmpty(paramName) || string.IsNullOrEmpty(formula)) return false;

        // Boundary chars - must match FormulaUtils.BoundaryChars
        var boundaryChars = new[] {
            '+', '-', '*', '/', '^', '=', '>', '<', ' ', '[', ']', '(', ')', ',', '\t', '\r', '\n'
        };

        var searchStart = 0;
        while (searchStart < formula.Length) {
            var leftIndex = formula.IndexOf(paramName, searchStart, StringComparison.Ordinal);
            if (leftIndex == -1) return false;

            var leftValid = leftIndex == 0 || boundaryChars.Contains(formula[leftIndex - 1]);
            var rightIndex = leftIndex + paramName.Length;
            var rightValid = rightIndex >= formula.Length || boundaryChars.Contains(formula[rightIndex]);

            if (leftValid && rightValid) return true;

            // Move past this false match
            searchStart = leftIndex + 1;
        }

        return false;
    }
}