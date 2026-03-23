using Pe.FamilyFoundry;
using Pe.FamilyFoundry.OperationSettings;
using System.ComponentModel;
using System.ComponentModel.DataAnnotations;

namespace Pe.SettingsCatalog.Revit.FamilyFoundry;

public class ProfileFamilyManager : BaseProfileSettings {
    [Description("Settings for making reference planes and dimensions")]
    [Required]
    public MakeRefPlaneAndDimsSettings MakeRefPlaneAndDims { get; init; } = new();

    [Description("Settings for setting parameter values and adding family parameters.")]
    [Required]
    public AddAndSetParamsSettings AddAndSetParams { get; init; } = new();

    [Description("Settings for creating constrained extrusions from canonical reference-plane specs.")]
    [Required]
    public MakeConstrainedExtrusionsSettings MakeConstrainedExtrusions { get; init; } = new();
}
