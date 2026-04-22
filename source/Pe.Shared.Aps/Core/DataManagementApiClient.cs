using Newtonsoft.Json.Linq;
using Pe.Shared.Aps.Models;

namespace Pe.Shared.Aps.Core;

public sealed class DataManagementApiClient(HttpClient httpClient) {
    public async Task<IReadOnlyList<DataManagementHubEntry>> GetHubsAsync(CancellationToken cancellationToken) {
        var payload = await this.GetJsonAsync("project/v1/hubs", cancellationToken);
        return ReadArray(payload, token => new DataManagementHubEntry(
            ReadRequiredString(token, "id"),
            ReadDisplayName(token),
            ReadString(token, "attributes", "region")
        ));
    }

    public async Task<IReadOnlyList<DataManagementProjectEntry>> GetProjectsAsync(
        string hubId,
        CancellationToken cancellationToken
    ) {
        var payload = await this.GetJsonAsync(
            $"project/v1/hubs/{Escape(hubId)}/projects",
            cancellationToken
        );
        return ReadArray(payload, token => new DataManagementProjectEntry(
            ReadRequiredString(token, "id"),
            ReadDisplayName(token)
        ));
    }

    public async Task<IReadOnlyList<DataManagementContentEntry>> GetTopFoldersAsync(
        string hubId,
        string projectId,
        CancellationToken cancellationToken
    ) {
        var payload = await this.GetJsonAsync(
            $"project/v1/hubs/{Escape(hubId)}/projects/{Escape(projectId)}/topFolders",
            cancellationToken
        );
        return ReadContents(payload);
    }

    public async Task<IReadOnlyList<DataManagementContentEntry>> GetFolderContentsAsync(
        string projectId,
        string folderId,
        CancellationToken cancellationToken
    ) {
        var payload = await this.GetJsonAsync(
            $"data/v1/projects/{Escape(projectId)}/folders/{Escape(folderId)}/contents",
            cancellationToken
        );
        return ReadContents(payload);
    }

    public async Task<IReadOnlyList<DataManagementVersionEntry>> GetItemVersionsAsync(
        string projectId,
        string itemId,
        CancellationToken cancellationToken
    ) {
        var payload = await this.GetJsonAsync(
            $"data/v1/projects/{Escape(projectId)}/items/{Escape(itemId)}/versions",
            cancellationToken
        );
        return ReadArray(payload, token => {
            var attributes = token["attributes"] as JObject;
            var extension = attributes?["extension"] as JObject;
            var extensionData = extension?["data"] as JObject;
            return new DataManagementVersionEntry(
                ReadRequiredString(token, "id"),
                ReadDisplayName(token),
                attributes?["fileType"]?.Value<string>(),
                attributes?["mimeType"]?.Value<string>(),
                extension?["type"]?.Value<string>(),
                ReadDateTimeOffset(attributes?["lastModifiedTime"] ?? attributes?["createTime"]),
                extensionData?["projectGuid"]?.Value<string>(),
                extensionData?["modelGuid"]?.Value<string>()
            );
        });
    }

    private async Task<JObject> GetJsonAsync(string relativeUrl, CancellationToken cancellationToken) {
        using var response = await httpClient.GetAsync(relativeUrl, cancellationToken).ConfigureAwait(false);
        response.EnsureSuccessStatusCode();
        var content = await response.Content.ReadAsStringAsyncCompat(cancellationToken).ConfigureAwait(false);
        return JObject.Parse(content);
    }

    private static IReadOnlyList<DataManagementContentEntry> ReadContents(JObject payload) =>
        ReadArray(payload, token => {
            var type = ReadRequiredString(token, "type");
            return new DataManagementContentEntry(
                ReadRequiredString(token, "id"),
                ReadDisplayName(token),
                string.Equals(type, "folders", StringComparison.OrdinalIgnoreCase),
                ReadString(token, "attributes", "extension", "type")
            );
        });

    private static IReadOnlyList<T> ReadArray<T>(JObject payload, Func<JObject, T> projector) =>
        payload["data"] is not JArray data
            ? []
            : data
                .OfType<JObject>()
                .Select(projector)
                .ToArray();

    private static string ReadDisplayName(JObject token) =>
        ReadString(token, "attributes", "displayName")
        ?? ReadString(token, "attributes", "name")
        ?? ReadRequiredString(token, "id");

    private static string ReadRequiredString(JObject token, params string[] path) =>
        ReadString(token, path)
        ?? throw new InvalidDataException($"Expected JSON string at path '{string.Join(".", path)}'.");

    private static string? ReadString(JToken token, params string[] path) {
        var current = token;
        foreach (var segment in path) {
            current = current?[segment];
            if (current == null)
                return null;
        }

        return current.Type == JTokenType.String ? current.Value<string>() : null;
    }

    private static DateTimeOffset? ReadDateTimeOffset(JToken? token) =>
        token?.Type == JTokenType.String &&
        DateTimeOffset.TryParse(token.Value<string>(), out var parsed)
            ? parsed
            : null;

    private static string Escape(string value) => Uri.EscapeDataString(value);
}