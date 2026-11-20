using Pe.Revit.Parameters;
using Pe.Shared.RevitData;
using Pe.Shared.RevitData.Serialization;
using RevitDocument = Autodesk.Revit.DB.Document;

namespace Pe.Revit.Global.Services.ParameterLinks;

internal sealed class ParameterLinksProfileStorage {
    public ProfileReadResult Read(RevitDocument document) {
        var blob = OwnerBlobStore.Read(document, ParameterLinkProfile.Owner);
        var read = ParameterLinkProfile.Read(blob);
        return new ProfileReadResult(read.Value, blob.Status != OwnerBlobStatus.Absent, read.Refusal, blob.Replacement);
    }

    public bool Write(RevitDocument document, ParameterLinkProfile profile, OwnerBlobReplacement? replacing = null, OwnerBlobNotices? notices = null) =>
        replacing is null ? OwnerBlobStore.Write(document, ParameterLinkProfile.Owner, profile.ToData())
            : OwnerBlobStore.Write(document, ParameterLinkProfile.Owner, profile.ToData(), replacing, notices ?? throw new ArgumentNullException(nameof(notices)));
}

internal sealed record ProfileReadResult(
    ParameterLinkProfile? Profile,
    bool HasStoredProfile,
    string? Error,
    OwnerBlobReplacement? Replacement = null
);
