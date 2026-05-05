using Pe.Aps.DesignAutomation;
using Newtonsoft.Json;
using System.Net;
using System.Net.Http.Headers;
using System.Text;

namespace Pe.Aps.Core;

public sealed class AutomationApiClient(HttpClient httpClient, string automationNamespace) {
    private const string StatusCodeDataKey = "Pe.AutomationApiClient.StatusCode";

    private readonly string _automationNamespace = automationNamespace;
    private readonly HttpClient _httpClient = httpClient;

    public async Task CreateOrUpdateAppBundleAsync(
        AutomationAppBundleSpec spec,
        byte[] packageContents,
        CancellationToken cancellationToken = default
    ) {
        ValidateRequired(spec.Id, nameof(spec.Id));
        ValidateRequired(spec.Engine, nameof(spec.Engine));
        ValidateRequired(spec.AliasId, nameof(spec.AliasId));

        var appBundles = await this.GetIdListAsync("appbundles", cancellationToken);
        var qualifiedId = this.Qualify(spec.Id, spec.AliasId);
        var bundleExists = appBundles.Any(item => item.StartsWith($"{this._automationNamespace}.{spec.Id}+",
            StringComparison.OrdinalIgnoreCase));
        var aliasExists = appBundles.Any(item => string.Equals(item, qualifiedId, StringComparison.OrdinalIgnoreCase));

        AppBundleVersionResponse versionResponse;
        if (bundleExists) {
            versionResponse = await this.PostJsonAsync<AppBundleVersionResponse>(
                $"appbundles/{spec.Id}/versions",
                new { engine = spec.Engine, description = spec.Description },
                cancellationToken
            );

            if (aliasExists) {
                await this.PatchJsonAsync(
                    $"appbundles/{spec.Id}/aliases/{spec.AliasId}",
                    new { version = versionResponse.Version },
                    cancellationToken
                );
            } else {
                await this.PostJsonAsync<object>(
                    $"appbundles/{spec.Id}/aliases",
                    new { id = spec.AliasId, version = versionResponse.Version },
                    cancellationToken
                );
            }
        } else {
            versionResponse = await this.PostJsonAsync<AppBundleVersionResponse>(
                "appbundles",
                new {
                    id = spec.Id,
                    package = spec.Package ?? spec.Id,
                    engine = spec.Engine,
                    description = spec.Description
                },
                cancellationToken
            );

            await this.PostJsonAsync<object>(
                $"appbundles/{spec.Id}/aliases",
                new { id = spec.AliasId, version = 1 },
                cancellationToken
            );
        }

        await UploadAppBundleAsync(versionResponse.UploadParameters, packageContents, cancellationToken);
    }

    public async Task CreateOrUpdateActivityAsync(
        AutomationActivitySpec spec,
        CancellationToken cancellationToken = default
    ) {
        ValidateRequired(spec.Id, nameof(spec.Id));
        ValidateRequired(spec.Engine, nameof(spec.Engine));
        ValidateRequired(spec.AliasId, nameof(spec.AliasId));
        if (spec.CommandLine.Count == 0)
            throw new InvalidOperationException("Activity command line is required.");

        var activities = await this.GetIdListAsync("activities", cancellationToken);
        var qualifiedId = this.Qualify(spec.Id, spec.AliasId);
        var activityExists = activities.Any(item => item.StartsWith($"{this._automationNamespace}.{spec.Id}+",
            StringComparison.OrdinalIgnoreCase));
        var aliasExists = activities.Any(item => string.Equals(item, qualifiedId, StringComparison.OrdinalIgnoreCase));

        var versionPayload = new {
            engine = spec.Engine,
            description = spec.Description,
            appbundles = spec.AppBundles,
            commandLine = spec.CommandLine,
            parameters = spec.Parameters,
            settings = spec.Settings
        };

        var createPayload = new {
            id = spec.Id,
            engine = spec.Engine,
            description = spec.Description,
            appbundles = spec.AppBundles,
            commandLine = spec.CommandLine,
            parameters = spec.Parameters,
            settings = spec.Settings
        };

        ActivityVersionResponse versionResponse;
        if (activityExists) {
            versionResponse = await this.PostJsonAsync<ActivityVersionResponse>(
                $"activities/{spec.Id}/versions",
                versionPayload,
                cancellationToken
            );

            if (aliasExists) {
                await this.PatchJsonAsync(
                    $"activities/{spec.Id}/aliases/{spec.AliasId}",
                    new { version = versionResponse.Version },
                    cancellationToken
                );
            } else {
                await this.PostJsonAsync<object>(
                    $"activities/{spec.Id}/aliases",
                    new { id = spec.AliasId, version = versionResponse.Version },
                    cancellationToken
                );
            }
        } else {
            versionResponse = await this.PostJsonAsync<ActivityVersionResponse>(
                "activities",
                createPayload,
                cancellationToken
            );

            await this.PostJsonAsync<object>(
                $"activities/{spec.Id}/aliases",
                new { id = spec.AliasId, version = 1 },
                cancellationToken
            );
        }
    }

    public Task<AutomationWorkItemStatus> SubmitWorkItemAsync(
        AutomationWorkItemSpec spec,
        CancellationToken cancellationToken = default
    ) =>
        this.PostJsonAsync<AutomationWorkItemStatus>(
            "workitems",
            new {
                activityId = spec.ActivityId,
                arguments = spec.Arguments,
                limitProcessingTimeSec = spec.LimitProcessingTimeSec,
                debug = spec.Debug
            },
            cancellationToken
        );

    public Task<AutomationWorkItemStatus> GetWorkItemStatusAsync(
        string workItemId,
        CancellationToken cancellationToken = default
    ) {
        ValidateRequired(workItemId, nameof(workItemId));
        return this.GetJsonAsync<AutomationWorkItemStatus>($"workitems/{workItemId}", cancellationToken);
    }

    public async Task<IReadOnlyList<AutomationWorkItemStatus>> GetWorkItemStatusesAsync(
        IReadOnlyList<string> workItemIds,
        CancellationToken cancellationToken = default
    ) {
        if (workItemIds.Count == 0)
            return [];

        using var response = await this._httpClient.PostAsync(
                "workitems/status",
                BuildJsonContent(workItemIds),
                cancellationToken
            )
            .ConfigureAwait(false);

        var payload = await DeserializeResponseAsync<WorkItemStatusesResponse>(response, cancellationToken)
            .ConfigureAwait(false);
        return payload.Results ?? [];
    }

    public async Task<AutomationReportFetchResult> GetWorkItemReportAsync(
        string? reportUrl,
        CancellationToken cancellationToken = default
    ) {
        if (string.IsNullOrWhiteSpace(reportUrl))
            return new AutomationReportFetchResult();

        using var response = await this.CreateReportClient(reportUrl)
            .GetAsync(reportUrl, cancellationToken)
            .ConfigureAwait(false);
        var content = await response.Content.ReadAsStringAsync(cancellationToken).ConfigureAwait(false);
        if (!response.IsSuccessStatusCode) {
            throw CreateHttpRequestException(
                $"Automation report fetch failed: {(int)response.StatusCode} - {content}",
                response.StatusCode
            );
        }

        return new AutomationReportFetchResult { ReportUrl = reportUrl, ReportContent = content };
    }

    private HttpClient CreateReportClient(string reportUrl) {
        if (!Uri.TryCreate(reportUrl, UriKind.Absolute, out var reportUri))
            return this._httpClient;

        var baseUri = this._httpClient.BaseAddress;
        if (baseUri is not null &&
            string.Equals(reportUri.Host, baseUri.Host, StringComparison.OrdinalIgnoreCase))
            return this._httpClient;

        return new HttpClient();
    }

    private async Task<IReadOnlyList<string>> GetIdListAsync(string relativeUrl, CancellationToken cancellationToken) {
        var response = await this.GetJsonAsync<ListResponse>(relativeUrl, cancellationToken);
        return response.Data ?? [];
    }

    private async Task<T> GetJsonAsync<T>(string relativeUrl, CancellationToken cancellationToken) {
        using var response = await this._httpClient.GetAsync(relativeUrl, cancellationToken).ConfigureAwait(false);
        return await DeserializeResponseAsync<T>(response, cancellationToken).ConfigureAwait(false);
    }

    private async Task<T> PostJsonAsync<T>(string relativeUrl, object payload, CancellationToken cancellationToken) {
        using var response = await this._httpClient.PostAsync(
                relativeUrl,
                BuildJsonContent(payload),
                cancellationToken
            )
            .ConfigureAwait(false);

        return await DeserializeResponseAsync<T>(response, cancellationToken).ConfigureAwait(false);
    }

    private async Task PatchJsonAsync(string relativeUrl, object payload, CancellationToken cancellationToken) {
        using var request = new HttpRequestMessage(new HttpMethod("PATCH"), relativeUrl) {
            Content = BuildJsonContent(payload)
        };

        using var response = await this._httpClient.SendAsync(request, cancellationToken).ConfigureAwait(false);
        _ = await DeserializeResponseAsync<object>(response, cancellationToken, true)
            .ConfigureAwait(false);
    }

    private static StringContent BuildJsonContent(object payload) =>
        new(JsonConvert.SerializeObject(payload), Encoding.UTF8, "application/json");

    private static async Task<T> DeserializeResponseAsync<T>(
        HttpResponseMessage response,
        CancellationToken cancellationToken,
        bool allowEmptyResponse = false
    ) {
        var content = await response.Content.ReadAsStringAsync(cancellationToken).ConfigureAwait(false);
        if (!response.IsSuccessStatusCode) {
            throw CreateHttpRequestException(
                $"Automation API request failed: {(int)response.StatusCode} - {content}",
                response.StatusCode
            );
        }

        if (allowEmptyResponse && string.IsNullOrWhiteSpace(content))
            return default!;

        var result = JsonConvert.DeserializeObject<T>(content);
        if (result == null) {
            throw new JsonSerializationException(
                $"Automation API returned an unreadable payload for {typeof(T).Name}."
            );
        }

        return result;
    }

    private static async Task UploadAppBundleAsync(
        UploadParameters? uploadParameters,
        byte[] packageContents,
        CancellationToken cancellationToken
    ) {
        if (uploadParameters == null || string.IsNullOrWhiteSpace(uploadParameters.EndpointUrl))
            throw new InvalidOperationException("Automation appbundle upload parameters were missing.");

        using var formContent = new MultipartFormDataContent();
        if (uploadParameters.FormData != null) {
            foreach (var item in uploadParameters.FormData)
                formContent.Add(new StringContent(item.Value), item.Key);
        }

        var fileContent = new ByteArrayContent(packageContents);
        fileContent.Headers.ContentType = new MediaTypeHeaderValue("application/octet-stream");
        formContent.Add(fileContent, "file", "bundle.zip");

        using var client = new HttpClient();
        using var response = await client.PostAsync(uploadParameters.EndpointUrl, formContent, cancellationToken)
            .ConfigureAwait(false);
        var content = await response.Content.ReadAsStringAsync(cancellationToken).ConfigureAwait(false);
        if (!response.IsSuccessStatusCode) {
            throw CreateHttpRequestException(
                $"Automation package upload failed: {(int)response.StatusCode} - {content}",
                response.StatusCode
            );
        }
    }

    private string Qualify(string id, string aliasId) => $"{this._automationNamespace}.{id}+{aliasId}";

    private static void ValidateRequired(string value, string parameterName) {
        if (string.IsNullOrWhiteSpace(value))
            throw new ArgumentException("Value is required.", parameterName);
    }

    public static HttpRequestException CreateHttpRequestException(string message, HttpStatusCode statusCode) {
        var exception = new HttpRequestException($"{message} (HTTP {(int)statusCode})");
        exception.Data[StatusCodeDataKey] = statusCode;
        return exception;
    }

    public static HttpStatusCode? GetStatusCode(HttpRequestException exception) =>
        exception.Data[StatusCodeDataKey] is HttpStatusCode statusCode ? statusCode : null;

    private sealed class ListResponse {
        [JsonProperty("data")] public List<string>? Data { get; init; }
    }

    private sealed class AppBundleVersionResponse {
        [JsonProperty("version")] public int Version { get; init; }
        [JsonProperty("uploadParameters")] public UploadParameters? UploadParameters { get; init; }
    }

    private sealed class ActivityVersionResponse {
        [JsonProperty("version")] public int Version { get; init; }
    }

    private sealed class WorkItemStatusesResponse {
        [JsonProperty("results")] public List<AutomationWorkItemStatus>? Results { get; init; }
    }

    private sealed class UploadParameters {
        [JsonProperty("endpointURL")] public string? EndpointUrl { get; init; }
        [JsonProperty("formData")] public Dictionary<string, string>? FormData { get; init; }
    }
}
