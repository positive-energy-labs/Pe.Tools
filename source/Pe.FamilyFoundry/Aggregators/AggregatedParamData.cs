using Pe.FamilyFoundry.Aggregators.Snapshots;
using Pe.Global.Services.Storage.Core.Json.SchemaProviders;

namespace Pe.FamilyFoundry.Aggregators;

/// <summary>
///     Aggregated parameter data across multiple families for CSV output.
/// </summary>
public class AggregatedParamData(ParamSnapshot param) {
    public readonly string DataType = SpecNamesProvider.GetLabelForForge(param.DataType);
    public readonly string DataTypeId = param.DataType.TypeId;
    public readonly bool HasValueForAllTypes = param.HasValueForAllTypes();
    public readonly bool IsBuiltIn = param.IsBuiltIn;
    public readonly bool IsInstance = param.IsInstance;
    public readonly bool IsProjectParameter = param.IsProjectParameter;
    public readonly string ParamName = param.Name;
    public readonly string? SharedGuid = param.SharedGuid.ToString();
    public readonly string StorageType = param.StorageType.ToString();
    public int FamilyCount => this.FamilyNames.Count;
    public int ScheduleCount => this.ScheduleNames.Count;
    public bool IsFamilyParameter => string.IsNullOrWhiteSpace(this.SharedGuid) && !this.IsBuiltIn;
    public HashSet<string> ScheduleCategories { get; set; } = [];
    public List<string> ScheduleNames { get; set; } = [];
    public HashSet<string> FamilyCategories { get; set; } = [];
    public List<string> FamilyNames { get; set; } = [];
}