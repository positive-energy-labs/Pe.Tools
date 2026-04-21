namespace Pe.Dev.RevitAutomation;

internal sealed record RevitAutomationSettings(
    string Namespace,
    string AppBundleId,
    string ActivityId,
    string AliasId,
    string ArtifactBucketKeyPrefix
) {
    public static RevitAutomationSettings Load(string clientId) =>
        new(
            Read("PE_AUTOMATION_NICKNAME", clientId),
            Read("PE_AUTOMATION_APPBUNDLE_ID", "PeToolsRevitAutomationShellAppBundle"),
            Read("PE_AUTOMATION_ACTIVITY_ID", "PeToolsRevitAutomationShellActivity"),
            Read("PE_AUTOMATION_ALIAS", "dev"),
            Read("PE_AUTOMATION_ARTIFACT_BUCKET_PREFIX", "petools-automation")
        );

    public string BuildArtifactBucketKey() {
        var raw = $"{this.ArtifactBucketKeyPrefix}-{this.Namespace}";
        var normalized = new string(raw
            .Trim()
            .ToLowerInvariant()
            .Select(ch => char.IsLetterOrDigit(ch) || ch == '-' ? ch : '-')
            .ToArray());

        var collapsed = normalized;
        while (collapsed.Contains("--", StringComparison.Ordinal))
            collapsed = collapsed.Replace("--", "-", StringComparison.Ordinal);

        collapsed = collapsed.Trim('-');
        if (collapsed.Length < 3)
            collapsed = $"pe-{collapsed}".Trim('-');

        return collapsed.Length <= 128 ? collapsed : collapsed[..128].Trim('-');
    }

    private static string Read(string variableName, string fallback) {
        var configured = Environment.GetEnvironmentVariable(variableName);
        return string.IsNullOrWhiteSpace(configured) ? fallback : configured.Trim();
    }
}
