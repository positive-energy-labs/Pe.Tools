using System.ComponentModel.DataAnnotations;

namespace Pe.Shared.StorageRuntime;

public sealed class ApsCredentialSettings {
    [Required]
    public string ApsWebClientId1 { get; set; } = "";

    [Required]
    public string ApsWebClientSecret1 { get; set; } = "";
}
