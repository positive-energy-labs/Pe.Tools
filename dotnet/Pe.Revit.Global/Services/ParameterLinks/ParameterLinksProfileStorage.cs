using Pe.Revit.Parameters;
using Pe.Shared.RevitData;
using Pe.Shared.RevitData.Serialization;
using RevitDocument = Autodesk.Revit.DB.Document;

namespace Pe.Revit.Global.Services.ParameterLinks;

internal sealed class ParameterLinksProfileStorage {
    private static readonly OwnerDescriptor Owner = ParameterLinkProfile.Owner with {
        ValidateData = read => ParameterLinkProfile.Read(read).Refusal
    };

    public ProfileReadResult Read(RevitDocument document) {
        var blob = OwnerBlobStore.Read(document, Owner);
        var read = ParameterLinkProfile.Read(blob);
        return new ProfileReadResult(read.Value, blob.Status != OwnerBlobStatus.Absent, read.Refusal, blob.Replacement);
    }

    public bool Write(RevitDocument document, ParameterLinkProfile profile) =>
        OwnerBlobStore.Write(document, Owner, profile.ToData());
}

internal sealed record ProfileReadResult(
    ParameterLinkProfile? Profile,
    bool HasStoredProfile,
    string? Error,
    OwnerBlobReplacement? Replacement = null
);
