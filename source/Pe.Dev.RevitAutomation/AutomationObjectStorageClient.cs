using Newtonsoft.Json;
using System.Net;
using System.Net.Http;
using System.Net.Http.Headers;
using System.Text;
using System.IO;
using Newtonsoft.Json.Linq;

namespace Pe.Dev.RevitAutomation;

internal sealed class AutomationObjectStorageClient(string accessToken) {
    private const string OssBaseUrl = "https://developer.api.autodesk.com/oss/v2/";
    private readonly HttpClient _httpClient = CreateClient(accessToken);

    public async Task EnsureTransientBucketAsync(string bucketKey, CancellationToken cancellationToken) {
        using var response = await this._httpClient.PostAsync(
                "buckets",
                BuildJsonContent(new {
                    bucketKey,
                    policyKey = "transient"
                }),
                cancellationToken
            )
            .ConfigureAwait(false);

        if (response.IsSuccessStatusCode || response.StatusCode == HttpStatusCode.Conflict)
            return;

        var content = await response.Content.ReadAsStringAsync(cancellationToken).ConfigureAwait(false);
        throw new HttpRequestException(
            $"OSS bucket create failed: {(int)response.StatusCode} - {content}",
            null,
            response.StatusCode
        );
    }

    public string BuildObjectUrn(string bucketKey, string objectKey) =>
        $"urn:adsk.objects:os.object:{bucketKey}/{Uri.EscapeDataString(objectKey)}";

    public async Task DownloadObjectAsync(
        string bucketKey,
        string objectKey,
        string destinationPath,
        CancellationToken cancellationToken
    ) {
        Directory.CreateDirectory(Path.GetDirectoryName(destinationPath) ?? ".");
        var signedDownloadUrl = await GetSignedDownloadUrlAsync(bucketKey, objectKey, cancellationToken).ConfigureAwait(false);
        using var signedClient = new HttpClient();
        using var response = await signedClient.GetAsync(signedDownloadUrl, cancellationToken).ConfigureAwait(false);
        response.EnsureSuccessStatusCode();

        await using var destination = File.Create(destinationPath);
        await response.Content.CopyToAsync(destination, cancellationToken).ConfigureAwait(false);
    }

    private async Task<string> GetSignedDownloadUrlAsync(
        string bucketKey,
        string objectKey,
        CancellationToken cancellationToken
    ) {
        using var response = await this._httpClient.GetAsync(
                $"buckets/{Uri.EscapeDataString(bucketKey)}/objects/{Uri.EscapeDataString(objectKey)}/signeds3download",
                cancellationToken
            )
            .ConfigureAwait(false);

        var content = await response.Content.ReadAsStringAsync(cancellationToken).ConfigureAwait(false);
        if (!response.IsSuccessStatusCode) {
            throw new HttpRequestException(
                $"OSS signeds3download failed: {(int)response.StatusCode} - {content}",
                null,
                response.StatusCode
            );
        }

        var payload = JObject.Parse(content);
        var status = payload["status"]?.ToString();
        var url = payload["url"]?.ToString();
        if (!string.Equals(status, "complete", StringComparison.OrdinalIgnoreCase) || string.IsNullOrWhiteSpace(url))
            throw new InvalidDataException($"OSS signeds3download did not return a completed download URL. Payload: {content}");

        return url;
    }

    private static HttpClient CreateClient(string accessToken) => new() {
        BaseAddress = new Uri(OssBaseUrl),
        DefaultRequestHeaders = {
            Accept = { new MediaTypeWithQualityHeaderValue("application/json") },
            Authorization = new AuthenticationHeaderValue("Bearer", accessToken)
        }
    };

    private static StringContent BuildJsonContent(object payload) =>
        new(JsonConvert.SerializeObject(payload), Encoding.UTF8, "application/json");
}
