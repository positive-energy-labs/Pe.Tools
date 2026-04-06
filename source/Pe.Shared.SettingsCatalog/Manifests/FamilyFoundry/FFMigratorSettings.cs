using Pe.Revit.FamilyFoundry;
using Pe.Revit.FamilyFoundry.OperationGroups;
using Pe.Revit.FamilyFoundry.OperationSettings;
using Pe.Revit.FamilyFoundry.Operations;
using System.ComponentModel;
using System.ComponentModel.DataAnnotations;

namespace Pe.Shared.SettingsCatalog.Manifests.FamilyFoundry;

public class FFMigratorSettings : BaseProfileSettings {
    [Description("Settings for cleaning the family document")]
    [Required]
    public CleanFamilyDocumentSettings CleanFamilyDocument { get; init; } = new();

    [Description("Settings for parameter mapping (add/replace and remap)")]
    [Required]
    public MapParamsSettings AddAndMapSharedParams { get; init; } = new();

    [Description("Settings for explicit family parameter definitions.")]
    [Required]
    public AddFamilyParamsSettings AddFamilyParams { get; init; } = new();

    [Description("Settings for setting values/formulas on already-known parameters.")]
    [Required]
    public SetKnownParamsSettings SetKnownParams { get; init; } = new();

    [Description("Settings for hydrating electrical connectors")]
    [Required]
    public MakeElecConnectorSettings MakeElectricalConnector { get; init; } = new();

    [Description("Settings for sorting parameters within each property group.")]
    [Required]
    public SortParamsSettings SortParams { get; init; } = new();
}
