using System.ComponentModel;
using System.ComponentModel.DataAnnotations;
using Newtonsoft.Json;
using Pe.Shared.Product;

namespace Pe.Shared.StorageRuntime;

public sealed class ProductPreferences {
    [Description(
        "The account ID derived from an 'id' field returned by `project/v1/hubs` but with the 'b.' prefix sliced off. A firm-level id, read from the firm home's Settings/preferences.json; without it the read refuses."
    )]
    [Required]
    public string Bim360AccountId { get; set; } = "";

    [Description(
        "The group ID derived from an 'id' field returned by `parameters/v1/accounts/<accountId>/groups`. A firm-level id, read from the firm home's Settings/preferences.json; without it the read refuses."
    )]
    [Required]
    public string ParamServiceGroupId { get; set; } = "";

    [Description(
        "The collection ID derived from an 'id' field returned by `parameters/v1/accounts/<accountId>/groups/<groupId>/collections`. A firm-level id, read from the firm home's Settings/preferences.json; without it the read refuses."
    )]
    public string ParamServiceCollectionId { get; set; } = "";

    /// <summary>
    ///     A firm-level id, read from the firm home's <c>Settings\preferences.json</c> (ADR 0037), else a refusal
    ///     naming why. Never a silent default, and no per-user copy: the user home holds no preferences file.
    ///     The firm home is configured in Settings or uses the literal default; <paramref name="homes" /> is the
    ///     injection point for a test that must not read this machine's home. Read only: nothing is created.
    /// </summary>
    public static string FirmId(Func<ProductPreferences, string> pick, string name, ProductHomes? homes = null) {
        homes ??= ProductPathing.Homes();
        var firmPath = homes.FirmPreferencesPath
            ?? throw new InvalidOperationException("Set your firm home in Settings");
        var value = File.Exists(firmPath)
            ? JsonConvert.DeserializeObject<ProductPreferences>(File.ReadAllText(firmPath)) is { } firm ? pick(firm) : null
            : null;
        return string.IsNullOrWhiteSpace(value)
            ? throw new InvalidOperationException($"No {name}: none in the firm's {firmPath}.")
            : value!.Trim();
    }
}
