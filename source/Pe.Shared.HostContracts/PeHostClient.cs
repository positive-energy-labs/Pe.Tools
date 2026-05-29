using Newtonsoft.Json;
using Newtonsoft.Json.Converters;
using Newtonsoft.Json.Linq;
using Newtonsoft.Json.Serialization;
using Pe.Shared.HostContracts.Operations;
using Pe.Shared.HostContracts.Protocol;
using Pe.Shared.HostContracts.Scripting;
using Pe.Shared.HostContracts.SettingsStorage;
using Pe.Shared.Product;
using Pe.Shared.RevitData;
using Pe.Shared.RevitData.Schedules;
using System.Net;
using System.Net.Http;
using System.Text;

namespace Pe.Shared.HostContracts;

public sealed class PeHostClient : IDisposable {
    private static readonly JsonSerializerSettings JsonSettings = new() {
        ContractResolver = new CamelCasePropertyNamesContractResolver(),
        NullValueHandling = NullValueHandling.Ignore,
        Converters = [new StringEnumConverter()]
    };

    private readonly HttpClient _httpClient;
    private readonly bool _ownsHttpClient;

    public PeHostClient(HttpClient? httpClient = null, string? hostBaseUrl = null) {
        this._httpClient = httpClient ?? new HttpClient();
        this._ownsHttpClient = httpClient == null;
        if (this._httpClient.BaseAddress == null)
            this._httpClient.BaseAddress = new Uri(EnsureTrailingSlash(
                HostProcessIdentity.ResolveHostBaseUrl(hostBaseUrl)
            ));

        this.Host = new PeHostStatusClient(this._httpClient);
        this.Revit = new PeHostRevitClient(this._httpClient);
        this.Scripting = new PeHostScriptingClient(this._httpClient);
    }

    public PeHostStatusClient Host { get; }
    public PeHostRevitClient Revit { get; }
    public PeHostScriptingClient Scripting { get; }

    public Task<TResponse> ExecuteAsync<TRequest, TResponse>(
        HostOperationDefinition definition,
        TRequest request,
        CancellationToken cancellationToken = default
    ) => SendAsync<TRequest, TResponse>(this._httpClient, definition, request, cancellationToken);

    public void Dispose() {
        if (this._ownsHttpClient)
            this._httpClient.Dispose();
    }

    internal static async Task<TResponse> SendAsync<TRequest, TResponse>(
        HttpClient httpClient,
        HostOperationDefinition definition,
        TRequest request,
        CancellationToken cancellationToken
    ) {
        if (!definition.IsPublicHttp || definition.Http == null) {
            throw new InvalidOperationException(
                $"Host operation '{definition.Key}' is not available through the public HTTP client."
            );
        }

        using var httpRequest = CreateRequest(httpClient, definition, request);
        try {
            using var response = await httpClient.SendAsync(httpRequest, cancellationToken).ConfigureAwait(false);
            var text = response.Content == null
                ? string.Empty
                : await response.Content.ReadAsStringAsync().ConfigureAwait(false);

            if (!response.IsSuccessStatusCode)
                throw CreateOperationFailure(definition, response.StatusCode, text, response.ReasonPhrase);

            if (typeof(TResponse) == typeof(NoRequest) || string.IsNullOrWhiteSpace(text))
                return default!;

            return JsonConvert.DeserializeObject<TResponse>(text, JsonSettings)
                   ?? throw new InvalidOperationException(
                       $"Host operation '{definition.Key}' returned an unreadable {typeof(TResponse).Name} payload."
                   );
        } catch (HttpRequestException ex) {
            throw new InvalidOperationException(
                "Pe.Host is not running or did not respond. Start Pe.Host and try again.",
                ex
            );
        } catch (TaskCanceledException ex) {
            throw new InvalidOperationException(
                "Pe.Host did not respond in time. Start Pe.Host and try again.",
                ex
            );
        }
    }

    private static HttpRequestMessage CreateRequest<TRequest>(
        HttpClient httpClient,
        HostOperationDefinition definition,
        TRequest request
    ) {
        var route = definition.Verb == HostHttpVerb.Get
            ? AppendQueryString(definition.Route, request)
            : definition.Route;
        var requestMessage = new HttpRequestMessage(
            ToHttpMethod(definition.Verb),
            new Uri(httpClient.BaseAddress!, route)
        );
        if (definition.Verb == HostHttpVerb.Post && request is not NoRequest) {
            requestMessage.Content = new StringContent(
                JsonConvert.SerializeObject(request, JsonSettings),
                Encoding.UTF8,
                "application/json"
            );
        }

        return requestMessage;
    }

    private static Exception CreateOperationFailure(
        HostOperationDefinition definition,
        HttpStatusCode statusCode,
        string content,
        string? reasonPhrase
    ) {
        var problem = TryDeserialize<HostProblemDetails>(content);
        var detail = problem?.Detail ?? problem?.Title ?? TryReadProblemDetail(content);
        var message = string.IsNullOrWhiteSpace(detail)
            ? $"Host operation '{definition.Key}' failed with HTTP {(int)statusCode}{(string.IsNullOrWhiteSpace(reasonPhrase) ? string.Empty : $" {reasonPhrase}")}."
            : detail!;
        return new PeHostClientException(statusCode, problem, message);
    }

    private static string? TryReadProblemDetail(string content) {
        if (string.IsNullOrWhiteSpace(content))
            return null;

        try {
            var token = JToken.Parse(content);
            return token["detail"]?.Value<string>() ?? token["title"]?.Value<string>();
        } catch (JsonException) {
            return content;
        }
    }

    private static T? TryDeserialize<T>(string text) {
        if (string.IsNullOrWhiteSpace(text))
            return default;

        try {
            return JsonConvert.DeserializeObject<T>(text, JsonSettings);
        } catch (JsonException) {
            return default;
        }
    }

    private static HttpMethod ToHttpMethod(HostHttpVerb verb) =>
        verb switch {
            HostHttpVerb.Get => HttpMethod.Get,
            HostHttpVerb.Post => HttpMethod.Post,
            _ => throw new ArgumentOutOfRangeException(nameof(verb), verb, null)
        };

    private static string AppendQueryString<TRequest>(string route, TRequest request) {
        if (request is null || request is NoRequest)
            return route;

        var parameters = request
            .GetType()
            .GetProperties()
            .Select(property => (Property: property, Value: property.GetValue(request)))
            .Where(item => item.Value != null)
            .Select(item =>
                $"{Uri.EscapeDataString(ToCamelCase(item.Property.Name))}={Uri.EscapeDataString(ConvertToString(item.Value!))}")
            .ToArray();
        if (parameters.Length == 0)
            return route;

        return $"{route}{(route.Contains('?') ? '&' : '?')}{string.Join("&", parameters)}";
    }

    private static string ConvertToString(object value) =>
        value switch {
            bool boolValue => boolValue ? "true" : "false",
            Enum enumValue => enumValue.ToString(),
            _ => Convert.ToString(value, System.Globalization.CultureInfo.InvariantCulture) ?? string.Empty
        };

    private static string ToCamelCase(string value) =>
        string.IsNullOrEmpty(value) ? value : char.ToLowerInvariant(value[0]) + value[1..];

    private static string EnsureTrailingSlash(string value) =>
        value.EndsWith("/", StringComparison.Ordinal) ? value : value + "/";
}

public sealed class PeHostStatusClient(HttpClient httpClient) {
    private readonly HttpClient _httpClient = httpClient;

    public Task<HostProbeData> GetProbeAsync(
        CancellationToken cancellationToken = default
    ) => PeHostClient.SendAsync<NoRequest, HostProbeData>(
        this._httpClient,
        GetHostProbeOperationContract.Definition,
        new NoRequest(),
        cancellationToken
    );

    public Task<HostSessionSummaryData> GetSessionSummaryAsync(
        CancellationToken cancellationToken = default
    ) => PeHostClient.SendAsync<NoRequest, HostSessionSummaryData>(
        this._httpClient,
        GetHostSessionSummaryOperationContract.Definition,
        new NoRequest(),
        cancellationToken
    );

    public Task<HostLogsData> GetLogsAsync(
        HostLogsRequest request,
        CancellationToken cancellationToken = default
    ) => PeHostClient.SendAsync<HostLogsRequest, HostLogsData>(
        this._httpClient,
        GetHostLogsOperationContract.Definition,
        request,
        cancellationToken
    );
}

public sealed class PeHostRevitClient(HttpClient httpClient) {
    public PeHostRevitContextClient Context { get; } = new(httpClient);
    public PeHostRevitCatalogClient Catalog { get; } = new(httpClient);
    public PeHostRevitMatrixClient Matrix { get; } = new(httpClient);
    public PeHostRevitDetailClient Detail { get; } = new(httpClient);
    public PeHostRevitResolveClient Resolve { get; } = new(httpClient);
}

public sealed class PeHostRevitContextClient(HttpClient httpClient) {
    private readonly HttpClient _httpClient = httpClient;

    public Task<RevitAgentContextSummaryData> GetSummaryAsync(
        CancellationToken cancellationToken = default
    ) => PeHostClient.SendAsync<NoRequest, RevitAgentContextSummaryData>(
        this._httpClient,
        GetRevitAgentContextSummaryOperationContract.Definition,
        new NoRequest(),
        cancellationToken
    );

    public Task<RevitDocumentSessionContextData> GetDocumentSessionAsync(
        CancellationToken cancellationToken = default
    ) => PeHostClient.SendAsync<NoRequest, RevitDocumentSessionContextData>(
        this._httpClient,
        GetRevitDocumentSessionContextOperationContract.Definition,
        new NoRequest(),
        cancellationToken
    );

    public Task<RevitAgentVisibleContextData> GetVisibleSummaryAsync(
        RevitAgentVisibleContextRequest request,
        CancellationToken cancellationToken = default
    ) => PeHostClient.SendAsync<RevitAgentVisibleContextRequest, RevitAgentVisibleContextData>(
        this._httpClient,
        GetRevitAgentVisibleContextOperationContract.Definition,
        request,
        cancellationToken
    );
}

public sealed class PeHostRevitResolveClient(HttpClient httpClient) {
    private readonly HttpClient _httpClient = httpClient;

    public Task<RevitAgentContextResolveData> ReferencesAsync(
        RevitAgentContextResolveRequest request,
        CancellationToken cancellationToken = default
    ) => PeHostClient.SendAsync<RevitAgentContextResolveRequest, RevitAgentContextResolveData>(
        this._httpClient,
        ResolveRevitAgentContextOperationContract.Definition,
        request,
        cancellationToken
    );
}

public sealed class PeHostRevitCatalogClient(HttpClient httpClient) {
    private readonly HttpClient _httpClient = httpClient;

    public Task<LoadedFamiliesCatalogData> GetLoadedFamiliesAsync(
        LoadedFamiliesCatalogRequest request,
        CancellationToken cancellationToken = default
    ) => PeHostClient.SendAsync<LoadedFamiliesCatalogRequest, LoadedFamiliesCatalogData>(
        this._httpClient,
        GetLoadedFamiliesCatalogOperationContract.Definition,
        request,
        cancellationToken
    );

    public Task<SchemaData> GetLoadedFamilyFilterSchemaAsync(
        CancellationToken cancellationToken = default
    ) => PeHostClient.SendAsync<NoRequest, SchemaData>(
        this._httpClient,
        GetLoadedFamiliesFilterSchemaOperationContract.Definition,
        new NoRequest(),
        cancellationToken
    );

    public Task<FieldOptionsData> GetLoadedFamilyFilterFieldOptionsAsync(
        LoadedFamiliesFilterFieldOptionsRequest request,
        CancellationToken cancellationToken = default
    ) => PeHostClient.SendAsync<LoadedFamiliesFilterFieldOptionsRequest, FieldOptionsData>(
        this._httpClient,
        GetLoadedFamiliesFilterFieldOptionsOperationContract.Definition,
        request,
        cancellationToken
    );

    public Task<ProjectParameterBindingsData> GetParameterBindingsAsync(
        ProjectParameterBindingsRequest request,
        CancellationToken cancellationToken = default
    ) => PeHostClient.SendAsync<ProjectParameterBindingsRequest, ProjectParameterBindingsData>(
        this._httpClient,
        GetProjectParameterBindingsOperationContract.Definition,
        request,
        cancellationToken
    );

    public Task<ScheduleCatalogData> GetSchedulesAsync(
        ScheduleCatalogRequest request,
        CancellationToken cancellationToken = default
    ) => PeHostClient.SendAsync<ScheduleCatalogRequest, ScheduleCatalogData>(
        this._httpClient,
        GetScheduleCatalogOperationContract.Definition,
        request,
        cancellationToken
    );

    public Task<ElectricalPanelsCatalogData> GetElectricalPanelsAsync(
        ElectricalPanelsCatalogRequest request,
        CancellationToken cancellationToken = default
    ) => PeHostClient.SendAsync<ElectricalPanelsCatalogRequest, ElectricalPanelsCatalogData>(
        this._httpClient,
        GetElectricalPanelsCatalogOperationContract.Definition,
        request,
        cancellationToken
    );

    public Task<ElectricalCircuitsCatalogData> GetElectricalCircuitsAsync(
        ElectricalCircuitsCatalogRequest request,
        CancellationToken cancellationToken = default
    ) => PeHostClient.SendAsync<ElectricalCircuitsCatalogRequest, ElectricalCircuitsCatalogData>(
        this._httpClient,
        GetElectricalCircuitsCatalogOperationContract.Definition,
        request,
        cancellationToken
    );

    public Task<ElectricalLoadClassificationsCatalogData> GetElectricalLoadClassificationsAsync(
        ElectricalLoadClassificationsCatalogRequest request,
        CancellationToken cancellationToken = default
    ) => PeHostClient.SendAsync<ElectricalLoadClassificationsCatalogRequest, ElectricalLoadClassificationsCatalogData>(
        this._httpClient,
        GetElectricalLoadClassificationsCatalogOperationContract.Definition,
        request,
        cancellationToken
    );
}

public sealed class PeHostRevitMatrixClient(HttpClient httpClient) {
    private readonly HttpClient _httpClient = httpClient;

    public Task<LoadedFamiliesMatrixData> GetLoadedFamiliesAsync(
        LoadedFamiliesMatrixRequest request,
        CancellationToken cancellationToken = default
    ) => PeHostClient.SendAsync<LoadedFamiliesMatrixRequest, LoadedFamiliesMatrixData>(
        this._httpClient,
        GetLoadedFamiliesMatrixOperationContract.Definition,
        request,
        cancellationToken
    );

    public Task<ScheduleProfilesQueryData> GetScheduleProfilesAsync(
        ScheduleProfilesQueryRequest request,
        CancellationToken cancellationToken = default
    ) => PeHostClient.SendAsync<ScheduleProfilesQueryRequest, ScheduleProfilesQueryData>(
        this._httpClient,
        GetScheduleProfilesQueryOperationContract.Definition,
        request,
        cancellationToken
    );
}

public sealed class PeHostRevitDetailClient(HttpClient httpClient) {
    private readonly HttpClient _httpClient = httpClient;

    public Task<ElementContextQueryData> GetElementsAsync(
        ElementContextQueryRequest request,
        CancellationToken cancellationToken = default
    ) => PeHostClient.SendAsync<ElementContextQueryRequest, ElementContextQueryData>(
        this._httpClient,
        GetElementContextQueryOperationContract.Definition,
        request,
        cancellationToken
    );

    public Task<ScheduleQueryData> GetSchedulesAsync(
        ScheduleQueryRequest request,
        CancellationToken cancellationToken = default
    ) => PeHostClient.SendAsync<ScheduleQueryRequest, ScheduleQueryData>(
        this._httpClient,
        GetScheduleQueryOperationContract.Definition,
        request,
        cancellationToken
    );

    public Task<ElectricalPanelSchedulesQueryData> GetElectricalPanelSchedulesAsync(
        ElectricalPanelSchedulesQueryRequest request,
        CancellationToken cancellationToken = default
    ) => PeHostClient.SendAsync<ElectricalPanelSchedulesQueryRequest, ElectricalPanelSchedulesQueryData>(
        this._httpClient,
        GetElectricalPanelSchedulesQueryOperationContract.Definition,
        request,
        cancellationToken
    );
}

public sealed class PeHostScriptingClient(HttpClient httpClient) {
    private readonly HttpClient _httpClient = httpClient;

    public Task<ScriptWorkspaceBootstrapData> BootstrapWorkspaceAsync(
        ScriptWorkspaceBootstrapRequest request,
        CancellationToken cancellationToken = default
    ) => PeHostClient.SendAsync<ScriptWorkspaceBootstrapRequest, ScriptWorkspaceBootstrapData>(
        this._httpClient,
        GetScriptWorkspaceBootstrapOperationContract.Definition,
        request,
        cancellationToken
    );

    public Task<ExecuteRevitScriptData> ExecuteAsync(
        ExecuteRevitScriptRequest request,
        CancellationToken cancellationToken = default
    ) => PeHostClient.SendAsync<ExecuteRevitScriptRequest, ExecuteRevitScriptData>(
        this._httpClient,
        ExecuteRevitScriptOperationContract.Definition,
        request,
        cancellationToken
    );
}

public sealed class PeHostClientException(
    HttpStatusCode statusCode,
    HostProblemDetails? problem,
    string message
) : Exception(message) {
    public HttpStatusCode StatusCode { get; } = statusCode;
    public HostProblemDetails? Problem { get; } = problem;
}

public sealed record HostProblemDetails(
    string? Type,
    string? Title,
    int? Status,
    string? Detail,
    string? Instance
);
