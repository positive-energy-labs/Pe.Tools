using System.ComponentModel;
using System.ComponentModel.DataAnnotations;

namespace Pe.Shared.StorageRuntime;

public sealed class ProductPreferences {
    [Description(
        "The account ID derived from an 'id' field returned by `project/v1/hubs` but with the 'b.' prefix sliced off. If left empty, the first item of 'data' will be used."
    )]
    [Required]
    public string Bim360AccountId { get; set; } = "";

    [Description(
        "The group ID derived from an 'id' field returned by `parameters/v1/accounts/<accountId>/groups`. If left empty, the first item of 'results' will be used."
    )]
    [Required]
    public string ParamServiceGroupId { get; set; } = "";

    [Description(
        "The collection ID derived from an 'id' field returned by `parameters/v1/accounts/<accountId>/groups/<groupId>/collections`. If left empty, the first item of 'results' will be used."
    )]
    public string ParamServiceCollectionId { get; set; } = "";

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
