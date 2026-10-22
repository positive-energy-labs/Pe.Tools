using Newtonsoft.Json;
using Pe.Revit.Global.Lib;
using Pe.Shared.RevitData;
using Pe.Shared.RevitData.Serialization;
using RevitDocument = Autodesk.Revit.DB.Document;

namespace Pe.Revit.Global.Services.ParameterLinks;

internal sealed class ParameterLinksProfileStorage {
    internal static readonly Guid ProfileParameterGuid = new("ceb230bf-9e1b-485a-a05e-0cda66558efd");
    internal const string ProfileParameterName = "_PE_ParameterLinksProfile";

    private static readonly ProjectInfoText Blob = new(ProfileParameterGuid, ProfileParameterName, "Versioned Pe.Tools parameter-link profile.");

    public ProfileReadResult Read(RevitDocument document) {
        if (Blob.Read(document) is not { } json)
            return new ProfileReadResult(null, false, null);

        try {
            var profile = JsonConvert.DeserializeObject<ParameterLinkProfile>(json, CreateProfileSerializerSettings());
            return profile == null
                ? new ProfileReadResult(null, true, "Stored parameter-links profile is empty.")
                : new ProfileReadResult(profile, true, null);
        } catch (Exception ex) {
            return new ProfileReadResult(null, true, $"Stored parameter-links profile is invalid: {ex.Message}");
        }
    }

    public bool Write(RevitDocument document, ParameterLinkProfile profile) =>
        Blob.Write(document, JsonConvert.SerializeObject(profile, Formatting.None, CreateProfileSerializerSettings()));

    private static JsonSerializerSettings CreateProfileSerializerSettings() {
        var settings = RevitDataJson.CreateSerializerSettings();
        settings.DefaultValueHandling = DefaultValueHandling.Include;
        settings.NullValueHandling = NullValueHandling.Include;
        return settings;
    }
}

internal sealed record ProfileReadResult(
    ParameterLinkProfile? Profile,
    bool HasStoredProfile,
    string? Error
);
