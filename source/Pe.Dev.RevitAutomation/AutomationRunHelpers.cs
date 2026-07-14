using Pe.Aps.DesignAutomation;
using System.IO;
using System.Net;
using System.Net.Http;

namespace Pe.Dev.RevitAutomation;

public static class AutomationDevRunHelpers {
    public static string BuildArtifactLocalPath(string repoRoot, int revitYear, string objectKey) {
        var fileName = Path.GetFileName(objectKey);
        return Path.Combine(
            repoRoot,
            ".artifacts",
            "automation",
            "results",
            revitYear.ToString(),
            fileName
        );
    }

    public static Task ValidateJsonArtifactAsync<TArtifact>(
        string artifactPath,
        string invalidMessage,
        CancellationToken cancellationToken
    ) =>
        DesignAutomationRunHelpers.ValidateJsonArtifactAsync<TArtifact>(artifactPath, invalidMessage, cancellationToken);

    public static bool HasStatusCode(
        HttpRequestException exception,
        HttpStatusCode first,
        HttpStatusCode second
    ) =>
        DesignAutomationRunHelpers.HasStatusCode(exception, first, second);
}
