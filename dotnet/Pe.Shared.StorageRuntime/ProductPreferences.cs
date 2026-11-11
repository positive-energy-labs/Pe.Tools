using System.ComponentModel;
using System.ComponentModel.DataAnnotations;
using Newtonsoft.Json;
using Pe.Shared.Product;
using Pe.Shared.StorageRuntime.Json;

namespace Pe.Shared.StorageRuntime;

public sealed class ProductPreferences {
    [Description(
        "The account ID derived from an 'id' field returned by `project/v1/hubs` but with the 'b.' prefix sliced off. A firm-level id: left empty, the shared preferences.json supplies it; with neither, the read refuses."
    )]
    [Required]
    public string Bim360AccountId { get; set; } = "";

    [Description(
        "The group ID derived from an 'id' field returned by `parameters/v1/accounts/<accountId>/groups`. A firm-level id: left empty, the shared preferences.json supplies it; with neither, the read refuses."
    )]
    [Required]
    public string ParamServiceGroupId { get; set; } = "";

    [Description(
        "The collection ID derived from an 'id' field returned by `parameters/v1/accounts/<accountId>/groups/<groupId>/collections`. A firm-level id: left empty, the shared preferences.json supplies it; with neither, the read refuses."
    )]
    public string ParamServiceCollectionId { get; set; } = "";

    /// <summary>
    ///     A firm-level id (ADR 0035 rule 11): the user's own non-empty value, else the shared
    ///     <c>&lt;shared&gt;\preferences.json</c>, else a refusal naming why. Never a silent default.
    /// </summary>
    public static string FirmId(Func<ProductPreferences, string> pick, string name) {
        var user = pick(new LocalDiskJsonFile<ProductPreferences>(ProductUserContentLayout.ForCurrentUser().PreferencesPath).Read());
        if (!string.IsNullOrWhiteSpace(user)) return user.Trim();
        // Read only: the shared root is the firm's, so a missing file is never created there.
        var sharedPath = ProductPathing.SharedPreferencesPath()
            ?? throw new InvalidOperationException(
                $"No {name}: none in your preferences.json, and no shared root (set {ProductPathNames.SharedRootVariable} for the shared preferences.json).");
        var shared = File.Exists(sharedPath)
            ? JsonConvert.DeserializeObject<ProductPreferences>(File.ReadAllText(sharedPath))
            : null;
        var value = shared is null ? null : pick(shared);
        return string.IsNullOrWhiteSpace(value)
            ? throw new InvalidOperationException($"No {name}: none in your preferences.json or the shared {sharedPath}.")
            : value!.Trim();
    }

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
