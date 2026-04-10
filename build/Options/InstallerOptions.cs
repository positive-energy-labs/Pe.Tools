using System.ComponentModel.DataAnnotations;

namespace Build.Options;

/// <summary>
///     MSI installer configuration.
/// </summary>
[Serializable]
public sealed record InstallerOptions {
    /// <summary>
    ///     Stable WiX upgrade code for the product.
    /// </summary>
    [Required]
    public string UpgradeCode { get; init; } = null!;

    /// <summary>
    ///     Path to the installer banner image, relative to the repository root unless absolute.
    /// </summary>
    [Required]
    public string BannerImagePath { get; init; } = null!;

    /// <summary>
    ///     Path to the installer background image, relative to the repository root unless absolute.
    /// </summary>
    [Required]
    public string BackgroundImagePath { get; init; } = null!;

    /// <summary>
    ///     Path to the control panel icon, relative to the repository root unless absolute.
    /// </summary>
    [Required]
    public string ProductIconPath { get; init; } = null!;
}
