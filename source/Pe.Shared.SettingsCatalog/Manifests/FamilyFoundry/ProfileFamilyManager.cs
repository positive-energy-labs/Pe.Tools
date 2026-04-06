using Pe.Revit.FamilyFoundry;
using Pe.Revit.FamilyFoundry.OperationSettings;
using System.ComponentModel;
using System.ComponentModel.DataAnnotations;

namespace Pe.SettingsCatalog.Manifests.FamilyFoundry;

public class ProfileFamilyManager : BaseProfileSettings {
    [Description("Settings for explicit family parameter definitions.")]
    [Required]
    public AddFamilyParamsSettings AddFamilyParams { get; init; } = new();

    [Description("Settings for setting values/formulas on already-known parameters.")]
    [Required]
    public SetKnownParamsSettings SetKnownParams { get; init; } = new();

    [Description("Semantic solid authoring and serialization settings.")]
    [Required]
    public AuthoredParamDrivenSolidsSettings ParamDrivenSolids { get; init; } = new();
}
