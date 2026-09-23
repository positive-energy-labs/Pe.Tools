using Newtonsoft.Json;
using Newtonsoft.Json.Converters;
using System.ComponentModel;
using System.ComponentModel.DataAnnotations;

namespace Pe.Shared.StorageRuntime.FamilyFoundry;

public interface IOperationSettings {
    bool Enabled { get; init; }
}

public class PurgeParamsBase {
    [Description(
        "Whether to delete parameters that have no value for every family type, regardless of whether they are used in the family. This is rare but possible. This setting is useful for properties like url variations where there are often multiple url parameters with no value.")]
    public bool DirectDeleteEmptyParameters { get; init; } = true;

    [Description("Whether to consider zero value as \"empty\" when deleting empty parameters.")]
    public bool ConsiderZeroValueAsEmpty { get; init; } = true;

    [Description("Whether to consider empty string as \"empty\" when deleting empty parameters.")]
    public bool ConsiderEmptyStringAsEmpty { get; init; } = true;

    [Description(
        "Exclude parameters from the deletion list. Parameters matching any exclude filter (Equaling, Containing, or StartingWith) will be protected from deletion.")]
    [Required]
    public ExcludeSharedParameter ExcludeNames { get; init; } = new();
}

public class PurgeParamsSettings : PurgeParamsBase, IOperationSettings {
    public bool Enabled { get; init; } = true;
}

[JsonConverter(typeof(StringEnumConverter))]
public enum ParamTypeSortOrder { None, SharedParamsFirst, FamilyParamsFirst }

[JsonConverter(typeof(StringEnumConverter))]
public enum ParamValueSortOrder { None, FormulasFirst, ValuesFirst }

[JsonConverter(typeof(StringEnumConverter))]
public enum ParamNameSortOrder { None, Ascending, Descending }

public class SortParamsSettings : IOperationSettings {
    [Description(
        "Sort shared parameters first or family parameters first. Takes first priority. Options are None, SharedParamsFirst, or FamilyParamsFirst")]
    public ParamTypeSortOrder ParamTypeSortOrder { get; init; } = ParamTypeSortOrder.SharedParamsFirst;

    [Description(
        "Sort parameters with formulas first or values first. Takes second priority. Options are None, FormulasFirst, or ValuesFirst")]
    public ParamValueSortOrder ParamValueSortOrder { get; init; } = ParamValueSortOrder.None;

    [Description("Sort parameters alphabetically. Takes third priority. Options are None, Ascending, or Descending")]
    public ParamNameSortOrder ParamNameSortOrder { get; init; } = ParamNameSortOrder.Ascending;

    public bool Enabled { get; init; } = true;
}


public class CleanFamilyDocumentSettings : IOperationSettings {
    [Description("Whether to purge nested families from the family")]
    public bool EnablePurgeNestedFamilies { get; init; } = true;

    [Description("Whether to purge reference planes from the family")]
    public bool EnablePurgeReferencePlanes { get; init; } = true;

    [Description("Whether to purge model lines from the family")]
    public bool EnablePurgeModelLines { get; init; } = true;

    [Description("Whether to purge unused parameters from the family")]
    public bool EnablePurgeParams { get; init; } = true;

    public PurgeParamsBase PurgeParamsSettings { get; init; } = new();
    public bool Enabled { get; init; } = true;
}
