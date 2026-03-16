using Pe.Extensions.FamDocument.SetValue;
using Pe.Extensions.FamManager;
using Pe.FamilyFoundry.Aggregators.Snapshots;
using Pe.StorageRuntime.Json;
using System.ComponentModel;
using System.ComponentModel.DataAnnotations;

namespace Pe.FamilyFoundry.OperationSettings;

public class MapParamsSettings : IOperationSettings {
    [Description("List of parameter remapping rules")]
    [Required]
    [Includable(IncludableFragmentRoot.MappingData)]
    public List<MappingData> MappingData { get; init; } = [];

    [Description("Disable per-type fallback to speed up processing. Do not use outside of testing")]
    public bool DisablePerTypeFallback { get; init; } = false;

    public bool Enabled { get; init; } = true;

    /// <summary>
    ///     Returns current parameters from <paramref name="currNames" /> ranked by data quality and user priority.
    ///     Filters to parameters in FamilyManager with snapshot data, deduplicates by value signature (keeping highest
    ///     priority), then ranks by number of types with values (most first), using user order as tiebreaker.
    /// </summary>
    /// <remarks>
    ///     In an attempt to keep user priority, this DOES NOT rank by matching datatype.
    ///     You must check datatype equality manually whereever that is a necessary condition.
    /// </remarks>
    /// <param name="currNames">Ordered list of candidate parameter names (priority order)</param>
    /// <param name="fm">FamilyManager instance for resolving parameters</param>
    /// <param name="processingContext">Optional context for snapshot data and value counts; may be null</param>
    /// <returns>FamilyParameters ranked by data quality (most populated types first) and user priority</returns>
    public List<FamilyParameter> GetRankedCurrParams(
        List<string> currNames,
        FamilyManager fm,
        FamilyProcessingContext? processingContext = null
    ) {
        // No context? Return params in user priority order
        if (processingContext == null) {
            return [
                .. currNames
                    .Select(fm.FindParameter)
                    .Where(p => p is not null)
                    .Where(p => {
                        try {
                            // Edge-case: param.Definition throws a null reference exception
                            if (p is null) return false;
                            return !string.IsNullOrWhiteSpace(p.Definition.Name);
                        } catch {
                            return false;
                        }
                    })
            ];
        }

        // 1. Filter to params that currently exist in fm AND have snapshots (for quality metrics)
        // 2. Group by value signature (all types, including empty)
        // 3. For each unique value set, take first by user priority
        var candidateSnapshots = currNames
            .Select(processingContext.FindParam)
            .Where(x => x != null)
            .Where(x => x.GetTypesWithValue().Count > 0);

        var paramSnapshots = candidateSnapshots.ToList();
        if (paramSnapshots.Count == 0) return [];

        var deduplicated = paramSnapshots
            .GroupBy(GetValueSignature)
            .Select(g => g.First());

        var enumerable = deduplicated.ToList();
        if (enumerable.Count == 0) return [];

        // 4. Order by quality (most types with values first). exclude 
        return [
            .. enumerable
                .Select(x => (n: x.Name, c: x.GetTypesWithValue().Count))
                .OrderByDescending(x => x.c)
                .ThenBy(x => currNames.IndexOf(x.n)) // preserve user priority as tiebreaker
                .Select(x => fm.FindParameter(x.n))
                .Where(p => {
                    try {
                        if (p is null) return false;
                        return !string.IsNullOrWhiteSpace(p.Definition.Name);
                    } catch {
                        return false;
                    }
                })
        ];
    }

    private static string GetValueSignature(ParamSnapshot snapshot) {
        if (!string.IsNullOrWhiteSpace(snapshot.Formula)) return $"FORMULA:{snapshot.Formula}";

        var sortedValues = snapshot.ValuesPerType
            .OrderBy(kv => kv.Key)
            .Select(kv => $"{kv.Key}:{kv.Value ?? "NULL"}");
        return string.Join("|", sortedValues);
    }
}

public class MappingData {
    [Description("Current parameter names to map from (ordered by priority)")]
    [Required]
    public List<string> CurrNames { get; set; } = [];

    [Description("New parameter name to map to")]
    [Required]
    public required string NewName { get; init; }

    [Description(
        "Coercion strategy to use for the remapping. CoerceByStorageType will be used when none is specified.")]
    public string MappingStrategy { get; init; } = nameof(BuiltInCoercionStrategy.CoerceByStorageType);
}
