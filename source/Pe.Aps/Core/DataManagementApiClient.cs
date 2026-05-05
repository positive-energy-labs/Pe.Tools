using Pe.Aps.DataManagement;
using Autodesk.DataManagement.Http;
using Autodesk.DataManagement.Model;
using Autodesk.SDKManager;

namespace Pe.Aps.Core;

public sealed class DataManagementApiClient(
    SDKManager sdkManager,
    Func<string> getAccessToken,
    ObjectStorageApiClient objectStorageClient) {
    private readonly HubsApi _hubsApi = new(sdkManager);
    private readonly ProjectsApi _projectsApi = new(sdkManager);
    private readonly FoldersApi _foldersApi = new(sdkManager);
    private readonly ItemsApi _itemsApi = new(sdkManager);
    private readonly VersionsApi _versionsApi = new(sdkManager);

    public async Task<IReadOnlyList<DataManagementHubEntry>> GetHubsAsync(CancellationToken cancellationToken) {
        var response = await this._hubsApi.GetHubsAsync(accessToken: getAccessToken())
            .WaitAsync(cancellationToken)
            .ConfigureAwait(false);
        return response.Content?.Data?.Select(ReadHubEntry).ToArray() ?? [];
    }

    public async Task<IReadOnlyList<DataManagementProjectEntry>> GetProjectsAsync(
        string hubId,
        CancellationToken cancellationToken
    ) {
        var response = await this._projectsApi.GetHubProjectsAsync(hubId, accessToken: getAccessToken())
            .WaitAsync(cancellationToken)
            .ConfigureAwait(false);
        return response.Content?.Data?.Select(ReadProjectEntry).ToArray() ?? [];
    }

    public async Task<IReadOnlyList<DataManagementContentEntry>> GetTopFoldersAsync(
        string hubId,
        string projectId,
        CancellationToken cancellationToken
    ) {
        var response = await this._projectsApi.GetProjectTopFoldersAsync(
                hubId,
                projectId,
                accessToken: getAccessToken()
            )
            .WaitAsync(cancellationToken)
            .ConfigureAwait(false);
        return response.Content?.Data?.Select(ReadTopFolderEntry).ToArray() ?? [];
    }

    public async Task<IReadOnlyList<DataManagementContentEntry>> GetFolderContentsAsync(
        string projectId,
        string folderId,
        CancellationToken cancellationToken
    ) {
        var response = await this._foldersApi.GetFolderContentsAsync(
                projectId,
                folderId,
                accessToken: getAccessToken()
            )
            .WaitAsync(cancellationToken)
            .ConfigureAwait(false);
        return response.Content?.Data?.Select(ReadContentEntry).ToArray() ?? [];
    }

    public async Task<IReadOnlyList<DataManagementVersionEntry>> GetItemVersionsAsync(
        string projectId,
        string itemId,
        CancellationToken cancellationToken
    ) {
        var response = await this._itemsApi.GetItemVersionsAsync(projectId, itemId, accessToken: getAccessToken())
            .WaitAsync(cancellationToken)
            .ConfigureAwait(false);
        return response.Content?.Data?.Select(ReadVersionEntry).ToArray() ?? [];
    }

    public async Task<DataManagementVersionEntry> GetVersionAsync(
        string projectId,
        string versionId,
        CancellationToken cancellationToken
    ) {
        var response = await this._versionsApi.GetVersionAsync(projectId, versionId, accessToken: getAccessToken())
            .WaitAsync(cancellationToken)
            .ConfigureAwait(false);
        return response.Content?.Data is { } version
            ? ReadVersionEntry(version)
            : throw new InvalidDataException("Version payload did not contain a data resource.");
    }

    public async Task DownloadVersionSourceAsync(
        string projectId,
        string versionId,
        string destinationPath,
        CancellationToken cancellationToken
    ) {
        var version = await this.GetVersionAsync(projectId, versionId, cancellationToken).ConfigureAwait(false);
        if (string.IsNullOrWhiteSpace(version.StorageId))
            throw new InvalidDataException($"Version '{versionId}' did not include a storage id.");

        var (bucketKey, objectKey) = ObjectStorageApiClient.ParseObjectUrn(version.StorageId);
        await objectStorageClient.DownloadObjectAsync(bucketKey, objectKey, destinationPath, cancellationToken)
            .ConfigureAwait(false);
    }

    private static DataManagementHubEntry ReadHubEntry(HubData hub) =>
        new(
            RequireString(hub.Id, "hub.id"),
            FirstNonWhiteSpace(hub.Attributes?.Name, hub.Id),
            hub.Attributes?.Region.ToString()
        );

    private static DataManagementProjectEntry ReadProjectEntry(ProjectData project) =>
        new(
            RequireString(project.Id, "project.id"),
            FirstNonWhiteSpace(project.Attributes?.Name, project.Id)
        );

    private static DataManagementContentEntry ReadTopFolderEntry(TopFolderData folder) =>
        new(
            RequireString(folder.Id, "topFolder.id"),
            FirstNonWhiteSpace(folder.Attributes?.Name, folder.Id),
            true,
            ReadTopFolderExtensionType(folder)
        );

    private static string? ReadTopFolderExtensionType(TopFolderData folder) {
#pragma warning disable CS0618
        return folder.Attributes?.Extension?.Type ?? folder.Attributes?.Extensions?.Type;
#pragma warning restore CS0618
    }

    private static DataManagementContentEntry ReadContentEntry(IFolderContentsData item) =>
        item switch {
            FolderData folder => new DataManagementContentEntry(
                RequireString(folder.Id, "folder.id"),
                FirstNonWhiteSpace(folder.Attributes?.Name, folder.Id),
                true,
                folder.Attributes?.Extension?.Type
            ),
            ItemData data => new DataManagementContentEntry(
                RequireString(data.Id, "item.id"),
                FirstNonWhiteSpace(data.Attributes?.DisplayName, data.Attributes?.PathInProject, data.Id),
                false,
                data.Attributes?.Extension?.Type
            ),
            _ => throw new InvalidDataException($"Unsupported folder contents resource type '{item.GetType().FullName}'.")
        };

    internal static DataManagementVersionEntry ReadVersionEntry(VersionData version) {
        var attributes = version.Attributes;
        var extension = attributes?.Extension;
        var data = extension?.Data;
        var storage = version.Relationships?.Storage;
        return new DataManagementVersionEntry(
            RequireString(version.Id, "version.id"),
            FirstNonWhiteSpace(attributes?.Name, attributes?.DisplayName, version.Id),
            attributes?.FileType,
            attributes?.MimeType,
            extension?.Type,
            ReadDateTimeOffset(attributes),
            ReadString(data, "projectGuid"),
            ReadString(data, "modelGuid"),
            ReadNullableInt(data, "revitProjectVersion"),
            ReadNullableBool(data, "isCompositeDesign"),
            ReadString(data, "compositeParentFile"),
            storage?.Data?.Id,
            storage?.Meta?.Link?.Href
        );
    }

    private static DateTimeOffset? ReadDateTimeOffset(VersionAttributes? attributes) {
        if (attributes == null)
            return null;

        var dateTime = attributes.LastModifiedTime != default
            ? attributes.LastModifiedTime
            : attributes.CreateTime;
        return dateTime != default
            ? new DateTimeOffset(DateTime.SpecifyKind(dateTime, DateTimeKind.Utc))
            : null;
    }

    private static string? ReadString(IReadOnlyDictionary<string, object>? data, string key) =>
        data != null && data.TryGetValue(key, out var value)
            ? value switch {
                string text => text,
                _ => Convert.ToString(value)
            }
            : null;

    private static int? ReadNullableInt(IReadOnlyDictionary<string, object>? data, string key) =>
        data != null && data.TryGetValue(key, out var value)
            ? value switch {
                int integer => integer,
                long integer => checked((int)integer),
                decimal number => decimal.ToInt32(number),
                string text when int.TryParse(text, out var parsed) => parsed,
                _ => null
            }
            : null;

    private static bool? ReadNullableBool(IReadOnlyDictionary<string, object>? data, string key) =>
        data != null && data.TryGetValue(key, out var value)
            ? value switch {
                bool boolean => boolean,
                string text when bool.TryParse(text, out var parsed) => parsed,
                _ => null
            }
            : null;

    private static string RequireString(string? value, string path) =>
        string.IsNullOrWhiteSpace(value)
            ? throw new InvalidDataException($"Expected APS SDK value at '{path}'.")
            : value;

    private static string FirstNonWhiteSpace(params string?[] values) =>
        values.FirstOrDefault(value => !string.IsNullOrWhiteSpace(value))
        ?? throw new InvalidDataException("Expected at least one non-empty APS SDK value.");
}
