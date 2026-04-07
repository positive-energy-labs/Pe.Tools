using Pe.Revit.FamilyFoundry;
using Pe.Revit.FamilyFoundry.OperationSettings;
using System.ComponentModel;
using System.ComponentModel.DataAnnotations;

namespace Pe.Shared.SettingsCatalog.Manifests.FamilyFoundry;

public class FFManagerSettings : BaseProfileSettings {
    [Description("Settings for explicit family parameter definitions.")]
    [Required]
    public AddFamilyParamsSettings AddFamilyParams { get; init; } = new();

    [Description("Settings for authored family lookup tables imported into Revit size tables.")]
    [Required]
    public SetLookupTablesSettings SetLookupTables { get; init; } = new();

    [Description("Settings for setting values/formulas on already-known parameters.")]
    [Required]
    public SetKnownParamsSettings SetKnownParams { get; init; } = new();

    [Description("Semantic solid authoring and serialization settings.")]
    [Required]
    public AuthoredParamDrivenSolidsSettings ParamDrivenSolids { get; init; } = new();
}
