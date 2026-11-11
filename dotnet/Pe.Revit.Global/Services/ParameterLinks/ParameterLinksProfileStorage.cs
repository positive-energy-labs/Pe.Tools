using Newtonsoft.Json;
using Newtonsoft.Json.Linq;
using Pe.Revit.Parameters;
using Pe.Shared.RevitData;
using Pe.Shared.RevitData.Serialization;
using RevitDocument = Autodesk.Revit.DB.Document;

namespace Pe.Revit.Global.Services.ParameterLinks;

internal sealed class ParameterLinksProfileStorage {
    private const string VersionKey = "formatVersion";
    private static readonly JsonSerializer Json = CreateSerializer();

    public ProfileReadResult Read(RevitDocument document) {
        var read = OwnerBlobStore.Read(document, ParameterLinkProfile.Owner);
        if (read.Status == OwnerBlobStatus.Absent)
            return new ProfileReadResult(null, false, null);
        if (read.Status != OwnerBlobStatus.Ok)
            return new ProfileReadResult(null, true, read.Error);

        try {
            if (read.Data!.ContainsKey(VersionKey))
                throw new JsonSerializationException("the version belongs to the envelope");
            return new ProfileReadResult(read.Data.ToObject<ParameterLinkProfile>(Json), true, null);
        } catch (JsonException ex) {
            return new ProfileReadResult(null, true, $"Stored parameter-links profile is invalid: {ex.Message}");
        }
    }

    /// <summary>The store refuses to write over a blob it cannot read; the service refuses first, with an issue.</summary>
    public bool Write(RevitDocument document, ParameterLinkProfile profile) {
        var data = JObject.FromObject(profile, Json);
        _ = data.Remove(VersionKey);
        return OwnerBlobStore.Write(document, ParameterLinkProfile.Owner, data);
    }

    // An unknown key is a read error, not a key to drop on the next write (ADR 0032 storage amendment, rule 2).
    private static JsonSerializer CreateSerializer() {
        var settings = RevitDataJson.CreateSerializerSettings();
        settings.DefaultValueHandling = DefaultValueHandling.Include;
        settings.NullValueHandling = NullValueHandling.Include;
        settings.MissingMemberHandling = MissingMemberHandling.Error;
        return JsonSerializer.Create(settings);
    }
}

internal sealed record ProfileReadResult(
    ParameterLinkProfile? Profile,
    bool HasStoredProfile,
    string? Error
);
