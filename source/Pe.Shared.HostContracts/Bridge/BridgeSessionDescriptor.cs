using Newtonsoft.Json.Linq;
using System.Linq;

namespace Pe.Shared.HostContracts.Bridge;

/// <summary>
/// Tolerant reader for the two descriptor shapes a Revit session can find beside (or pointed at by)
/// its loaded payload:
/// <list type="bullet">
/// <item>The SDK session receipt / runtime descriptor (<c>&lt;Assembly&gt;.runtime.json</c>, also
/// the file <c>PE_REVIT_SESSION_DESCRIPTOR</c> points at): <c>assembly</c>/<c>lane</c>/
/// <c>path</c>/<c>buildStamp</c>/<c>sessionId</c>. Lane is <c>dev</c> or <c>installed</c> — payload
/// SOURCE only. A launch receipt always carries <c>sessionId</c>; a build-emitted runtime
/// descriptor never does.</item>
/// <item>Pe.App's installed runtime deployment descriptor (<c>Pe.App.runtime.json</c> written by
/// WritePeAppRuntimeDescriptor): <c>runtimeLane</c> only.</item>
/// </list>
/// Fields are selectors and metadata for the broker, never identity — session identity is always
/// hash(pid + processStartUtc), assigned by the broker.
/// </summary>
public sealed record BridgeSessionDescriptor(
    string? Assembly,
    string? Lane,
    string? SessionId,
    string? BuildStamp,
    string? PayloadPath
) {
    /// <summary>
    /// Parses the SDK's schema-2 session RECEIPT (session.json: <c>lane</c>/<c>sessionId</c> plus
    /// <c>override:{Assembly}</c> pointers) for the payload loaded from
    /// <paramref name="payloadDirectory"/>. The receipt carries no <c>path</c> itself: the override
    /// it names for this payload does (a build-emitted runtime descriptor). No override for any
    /// product means every product runs its installed payload in-lane, so the receipt describes
    /// this payload too. Returns null when the text is not a JSON object.
    /// </summary>
    public static BridgeSessionDescriptor? TryParseReceipt(string? json, string? payloadDirectory) {
        var receipt = TryParse(json);
        if (receipt is null || receipt.PayloadPath is not null)
            return receipt;
        JObject root;
        try {
            root = JObject.Parse(json!);
        } catch (Newtonsoft.Json.JsonException) {
            return receipt;
        }
        var overrides = root.Properties()
            .Where(p => p.Name.StartsWith("override:", StringComparison.OrdinalIgnoreCase) && p.Value.Type == JTokenType.String)
            .ToList();
        foreach (var property in overrides) {
            BridgeSessionDescriptor? over;
            try {
                var file = property.Value.Value<string>()!;
                over = File.Exists(file) ? TryParse(File.ReadAllText(file)) : null;
            } catch (Exception e) when (e is IOException or UnauthorizedAccessException) {
                over = null;
            }
            if (over?.PayloadPath is null || !over.DescribesPayloadDirectory(payloadDirectory))
                continue;
            return new BridgeSessionDescriptor(
                over.Assembly ?? property.Name.Substring("override:".Length),
                receipt.Lane ?? over.Lane,
                receipt.SessionId,
                over.BuildStamp,
                over.PayloadPath
            );
        }
        // A receipt with no override at all: every product is on its installed payload, in-lane.
        return overrides.Count == 0 && payloadDirectory is not null
            ? receipt with { PayloadPath = payloadDirectory }
            : receipt;
    }

    /// <summary>Parses descriptor JSON. Returns null when the text is not a JSON object.</summary>
    public static BridgeSessionDescriptor? TryParse(string? json) {
        if (string.IsNullOrWhiteSpace(json))
            return null;

        JObject root;
        try {
            root = JObject.Parse(json!);
        } catch (Newtonsoft.Json.JsonException) {
            return null;
        }

        return new BridgeSessionDescriptor(
            ReadString(root, "assembly"),
            NormalizeLane(ReadString(root, "lane") ?? ReadString(root, "runtimeLane")),
            ReadString(root, "sessionId"),
            ReadString(root, "buildStamp"),
            ReadString(root, "path")
        );
    }

    /// <summary>
    /// Whether this descriptor describes the payload loaded from <paramref name="payloadDirectory"/>.
    /// Used to validate PE_REVIT_SESSION_DESCRIPTOR: the env var belongs to the whole Revit process,
    /// so a descriptor for an unrelated product must be ignored by this payload.
    /// </summary>
    public bool DescribesPayloadDirectory(string? payloadDirectory) {
        if (string.IsNullOrWhiteSpace(this.PayloadPath) || string.IsNullOrWhiteSpace(payloadDirectory))
            return false;

        return string.Equals(
            NormalizeDirectory(this.PayloadPath!),
            NormalizeDirectory(payloadDirectory!),
            StringComparison.OrdinalIgnoreCase
        );
    }

    private static string NormalizeDirectory(string path) {
        var normalized = path.Replace('/', Path.DirectorySeparatorChar)
            .Replace('\\', Path.DirectorySeparatorChar)
            .TrimEnd(Path.DirectorySeparatorChar);
        try {
            return Path.GetFullPath(normalized);
        } catch (Exception e) when (e is ArgumentException or NotSupportedException or PathTooLongException) {
            return normalized;
        }
    }

    private static string? ReadString(JObject root, string name) {
        var token = root.TryGetValue(name, StringComparison.OrdinalIgnoreCase, out var value) ? value : null;
        var text = token?.Type == JTokenType.String ? token.Value<string>() : null;
        return string.IsNullOrWhiteSpace(text) ? null : text;
    }

    private static string? NormalizeLane(string? lane) =>
        string.IsNullOrWhiteSpace(lane) ? null : lane!.Trim().ToLowerInvariant();
}
