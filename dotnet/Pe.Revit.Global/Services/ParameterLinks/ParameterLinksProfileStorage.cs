using Pe.Revit.Parameters;
using Pe.Shared.RevitData;
using Pe.Shared.RevitData.Serialization;
using RevitDocument = Autodesk.Revit.DB.Document;

namespace Pe.Revit.Global.Services.ParameterLinks;

internal sealed class ParameterLinksProfileStorage {
    public ProfileReadResult Read(RevitDocument document) {
        var blob = OwnerBlobStore.Read(document, ParameterLinkProfile.Owner);
        var read = ParameterLinkProfile.Read(blob);
        return new ProfileReadResult(read.Value, blob.Status != OwnerBlobStatus.Absent, read.Refusal);
    }

    public bool Write(RevitDocument document, ParameterLinkProfile profile) =>
        OwnerBlobStore.Write(document, ParameterLinkProfile.Owner with { ValidateData = read => ParameterLinkProfile.Read(read).Refusal },
            profile.ToData());
}

internal sealed record ProfileReadResult(
    ParameterLinkProfile? Profile,
    bool HasStoredProfile,
    string? Error
);
