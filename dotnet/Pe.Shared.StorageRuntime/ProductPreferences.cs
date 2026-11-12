using System.ComponentModel;
using System.ComponentModel.DataAnnotations;
using Newtonsoft.Json;
using Pe.Shared.Product;

namespace Pe.Shared.StorageRuntime;

public sealed class ProductPreferences {
    [Description(
        "The account ID derived from an 'id' field returned by `project/v1/hubs` but with the 'b.' prefix sliced off. A firm-level id: left empty, the firm home's Settings/preferences.json supplies it; with neither, the read refuses."
    )]
    [Required]
    public string Bim360AccountId { get; set; } = "";

    [Description(
        "The group ID derived from an 'id' field returned by `parameters/v1/accounts/<accountId>/groups`. A firm-level id: left empty, the firm home's Settings/preferences.json supplies it; with neither, the read refuses."
    )]
    [Required]
    public string ParamServiceGroupId { get; set; } = "";

    [Description(
        "The collection ID derived from an 'id' field returned by `parameters/v1/accounts/<accountId>/groups/<groupId>/collections`. A firm-level id: left empty, the firm home's Settings/preferences.json supplies it; with neither, the read refuses."
    )]
    public string ParamServiceCollectionId { get; set; } = "";

    /// <summary>
    ///     A firm-level id: the user's own non-empty value, else the firm home's
    ///     <c>Settings\preferences.json</c> (ADR 0037), else a refusal naming why. Never a silent default.
    ///     The firm home is found by its marker, with no environment variable; <paramref name="homes" /> is the
    ///     injection point for a test that must not read this machine's drives.
    /// </summary>
    public static string FirmId(Func<ProductPreferences, string> pick, string name, ProductHomes? homes = null) {
        homes ??= ProductPathing.Homes();
        // Read only, both files: a home holds authored files, so a read never creates a skeleton in one.
        var user = ReadOrNull(Path.Combine(homes.User, ProductPathNames.PreferencesFileName)) is { } own ? pick(own) : null;
        if (!string.IsNullOrWhiteSpace(user)) return user!.Trim();
        var firmPath = homes.FirmPreferencesPath
            ?? throw new InvalidOperationException(homes.FirmConflict.Count > 0
                ? $"No {name}: none in your preferences.json, and two folders claim to be the firm home, so neither is used: {string.Join(" and ", homes.FirmConflict)}."
                : $"No {name}: none in your preferences.json, and this machine found no firm home (a '{ProductPathNames.FirmSoftwareDirectoryName}\\{ProductIdentity.ProductName}' folder on the shared drive whose {ProductPathNames.HomeMarkerFileName} reads firm).");
        var value = ReadOrNull(firmPath) is { } firm ? pick(firm) : null;
        return string.IsNullOrWhiteSpace(value)
            ? throw new InvalidOperationException($"No {name}: none in your preferences.json or the firm's {firmPath}.")
            : value!.Trim();
    }

    private static ProductPreferences? ReadOrNull(string path) =>
        File.Exists(path) ? JsonConvert.DeserializeObject<ProductPreferences>(File.ReadAllText(path)) : null;

    [Description("Dev/override PostHog ingest settings for a checkout without an installed product manifest.")]
    [Newtonsoft.Json.JsonProperty("posthog")]
    public PostHogPreferences? PostHog { get; set; }
}

public sealed class PostHogPreferences {
    [Description("Public write-only PostHog ingest key (phc_...).")]
    public string ApiKey { get; set; } = "";

    [Description("PostHog ingest host.")]
    public string Host { get; set; } = "https://us.i.posthog.com";
}
