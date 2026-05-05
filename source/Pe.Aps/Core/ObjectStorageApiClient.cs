using Autodesk.Oss.Http;
using Autodesk.Oss.Model;
using Autodesk.SDKManager;
using System.Net;
using System.Net.Http.Headers;

namespace Pe.Aps.Core;

public sealed class ObjectStorageApiClient {
    private readonly BucketsApi _bucketsApi;
    private readonly ObjectsApi _objectsApi;
    private readonly Func<string> _getAccessToken;

    public ObjectStorageApiClient(string accessToken)
        : this(() => accessToken) { }

    public ObjectStorageApiClient(Func<string> getAccessToken)
        : this(SdkManagerBuilder.Create().Build(), getAccessToken) { }

    public ObjectStorageApiClient(SDKManager sdkManager, Func<string> getAccessToken) {
        this._bucketsApi = new BucketsApi(sdkManager);
        this._objectsApi = new ObjectsApi(sdkManager);
        this._getAccessToken = getAccessToken;
    }

    public async Task EnsureTransientBucketAsync(string bucketKey, CancellationToken cancellationToken) {
        var response = await this._bucketsApi.CreateBucketAsync(
                new CreateBucketsPayload {
                    BucketKey = bucketKey,
                    PolicyKey = PolicyKey.Transient
                },
                Region.US,
                this._getAccessToken(),
                throwOnError: false
            )
            .WaitAsync(cancellationToken)
            .ConfigureAwait(false);

        if (response.HttpResponse.IsSuccessStatusCode || response.HttpResponse.StatusCode == HttpStatusCode.Conflict)
            return;

        var content = await response.HttpResponse.Content.ReadAsStringAsync(cancellationToken).ConfigureAwait(false);
        throw new HttpRequestException(
            $"OSS bucket create failed: {(int)response.HttpResponse.StatusCode} - {content}",
            null,
            response.HttpResponse.StatusCode
        );
    }

    public static string BuildObjectUrn(string bucketKey, string objectKey) =>
        $"urn:adsk.objects:os.object:{bucketKey}/{Uri.EscapeDataString(objectKey)}";

    public async Task DownloadObjectAsync(
        string bucketKey,
        string objectKey,
        string destinationPath,
        CancellationToken cancellationToken
    ) {
        Directory.CreateDirectory(Path.GetDirectoryName(destinationPath) ?? ".");
        var signedDownloadUrl = await this.GetSignedDownloadUrlAsync(bucketKey, objectKey, cancellationToken)
            .ConfigureAwait(false);
        using var signedClient = new HttpClient();
        using var response = await signedClient.GetAsync(signedDownloadUrl, cancellationToken).ConfigureAwait(false);
        response.EnsureSuccessStatusCode();

        await using var destination = File.Create(destinationPath);
        await response.Content.CopyToAsync(destination, cancellationToken).ConfigureAwait(false);
    }

    public async Task UploadObjectAsync(
        string bucketKey,
        string objectKey,
        string sourcePath,
        CancellationToken cancellationToken
    ) {
        var signedUpload = await this.GetSignedUploadAsync(bucketKey, objectKey, cancellationToken).ConfigureAwait(false);

        await using (var source = File.OpenRead(sourcePath))
        using (var uploadContent = new StreamContent(source)) {
            uploadContent.Headers.ContentType = new MediaTypeHeaderValue("application/octet-stream");
            using var signedClient = new HttpClient();
            using var uploadResponse = await signedClient.PutAsync(signedUpload.Url, uploadContent, cancellationToken)
                .ConfigureAwait(false);
            if (!uploadResponse.IsSuccessStatusCode) {
                var uploadBody = await uploadResponse.Content.ReadAsStringAsync(cancellationToken).ConfigureAwait(false);
                throw new HttpRequestException(
                    $"OSS signed upload PUT failed: {(int)uploadResponse.StatusCode} - {uploadBody}",
                    null,
                    uploadResponse.StatusCode
                );
            }
        }

        await this._objectsApi.CompleteSignedS3UploadAsync(
                bucketKey,
                EncodeObjectKeyForSdk(objectKey),
                "application/octet-stream",
                new Completes3uploadBody {
                    UploadKey = signedUpload.UploadKey,
                    Size = new FileInfo(sourcePath).Length
                },
                accessToken: this._getAccessToken()
            )
            .WaitAsync(cancellationToken)
            .ConfigureAwait(false);
    }

    public async Task<string> GetSignedDownloadUrlAsync(
        string bucketKey,
        string objectKey,
        CancellationToken cancellationToken
    ) {
        var response = await this._objectsApi.SignedS3DownloadAsync(
                bucketKey,
                EncodeObjectKeyForSdk(objectKey),
                accessToken: this._getAccessToken()
            )
            .WaitAsync(cancellationToken)
            .ConfigureAwait(false);
        var payload = response.Content;
        if (payload is { Status: DownloadStatus.Complete } && !string.IsNullOrWhiteSpace(payload.Url))
            return payload.Url;

        throw new InvalidDataException(
            $"OSS signeds3download did not return a completed download URL for '{bucketKey}/{objectKey}'."
        );
    }

    private async Task<SignedUploadSpec> GetSignedUploadAsync(
        string bucketKey,
        string objectKey,
        CancellationToken cancellationToken
    ) {
        var response = await this._objectsApi.SignedS3UploadAsync(
                bucketKey,
                EncodeObjectKeyForSdk(objectKey),
                parts: 1,
                firstPart: 1,
                accessToken: this._getAccessToken()
            )
            .WaitAsync(cancellationToken)
            .ConfigureAwait(false);
        var payload = response.Content;
        var uploadKey = payload?.UploadKey;
        var url = payload?.Urls?.FirstOrDefault();
        if (string.IsNullOrWhiteSpace(uploadKey) || string.IsNullOrWhiteSpace(url)) {
            throw new InvalidDataException(
                $"OSS signeds3upload did not return uploadKey/url for '{bucketKey}/{objectKey}'."
            );
        }

        return new SignedUploadSpec(uploadKey, url);
    }

    internal static string EncodeObjectKeyForSdk(string objectKey) =>
        Uri.EscapeDataString(Uri.UnescapeDataString(objectKey));

    internal static (string BucketKey, string ObjectKey) ParseObjectUrn(string storageUrn) {
        const string prefix = "urn:adsk.objects:os.object:";
        if (!storageUrn.StartsWith(prefix, StringComparison.OrdinalIgnoreCase)) {
            throw new InvalidDataException(
                $"Storage id '{storageUrn}' was not an Autodesk OSS object URN."
            );
        }

        var remainder = storageUrn[prefix.Length..];
        var slashIndex = remainder.IndexOf('/');
        if (slashIndex <= 0 || slashIndex >= remainder.Length - 1) {
            throw new InvalidDataException(
                $"Storage id '{storageUrn}' did not include bucket/object segments."
            );
        }

        return (remainder[..slashIndex], Uri.UnescapeDataString(remainder[(slashIndex + 1)..]));
    }

    private sealed record SignedUploadSpec(string UploadKey, string Url);
}
