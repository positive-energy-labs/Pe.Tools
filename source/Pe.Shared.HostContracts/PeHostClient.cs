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

/// <summary>
/// Typed .NET client for Pe.Host HTTP operations.
/// </summary>
/// <remarks>
/// Use this client from C# scripts and repo code when composing host operations. Prefer the
/// blessed grouped methods under <see cref="Revit"/> for common Revit joins, and use
/// <see cref="ExecuteAsync{TRequest,TResponse}"/> only for less-common public operations.
/// </remarks>
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

    /// <summary>
    /// Host-local status, logs, and session health operations.
    /// </summary>
    public PeHostStatusClient Host { get; }

    /// <summary>
    /// Revit bridge-backed operations grouped by context, resolve, catalog, matrix, and detail layers.
    /// </summary>
    public PeHostRevitClient Revit { get; }

    /// <summary>
    /// Script workspace bootstrap and execution operations.
    /// </summary>
    public PeHostScriptingClient Scripting { get; }

    /// <summary>
    /// Executes a public host operation that does not have a blessed wrapper.
    /// </summary>
    /// <remarks>
    /// Prefer grouped methods for common joins because their XML docs carry workflow guidance.
    /// This method is the escape hatch for advanced or newly-added operation contracts.
    /// </remarks>
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

/// <summary>
/// Revit bridge-backed host operations grouped by the public operation layer.
/// </summary>
/// <remarks>
/// Low-waste joins usually follow this order: context or resolve once, collect handles,
/// run a matrix operation for coverage, then inspect only exact or missing handles through detail calls.
/// </remarks>
public sealed class PeHostRevitClient(HttpClient httpClient) {
    /// <summary>
    /// Current-document and current-view orientation surfaces.
    /// </summary>
    public PeHostRevitContextClient Context { get; } = new(httpClient);

    /// <summary>
    /// Candidate discovery surfaces. Use these to find schedules, families, parameters, and electrical candidates.
    /// </summary>
    public PeHostRevitCatalogClient Catalog { get; } = new(httpClient);

    /// <summary>
    /// Coverage and matrix projections over known scopes.
    /// </summary>
    public PeHostRevitMatrixClient Matrix { get; } = new(httpClient);

    /// <summary>
    /// Detail surfaces for exact handles, rows, and electrical facts after candidates are known.
    /// </summary>
    public PeHostRevitDetailClient Detail { get; } = new(httpClient);

    /// <summary>
    /// Natural-language reference resolution into stable Revit handles.
    /// </summary>
    public PeHostRevitResolveClient Resolve { get; } = new(httpClient);
}

/// <summary>
/// Current Revit context operations.
/// </summary>
public sealed class PeHostRevitContextClient(HttpClient httpClient) {
    private readonly HttpClient _httpClient = httpClient;

    /// <summary>
    /// Gets compact orientation for the active Revit document, active view/sheet, selection, and visible categories.
    /// </summary>
    /// <remarks>
    /// Start here before deciding whether a script or deeper host operation is needed. Use the returned
    /// active view, selection, category, and browser context to choose the smallest next scope.
    /// </remarks>
    public Task<RevitAgentContextSummaryData> GetSummaryAsync(
        CancellationToken cancellationToken = default
    ) => PeHostClient.SendAsync<NoRequest, RevitAgentContextSummaryData>(
        this._httpClient,
        GetRevitAgentContextSummaryOperationContract.Definition,
        new NoRequest(),
        cancellationToken
    );

    /// <summary>
    /// Gets open/active document session state without collecting model contents.
    /// </summary>
    public Task<RevitDocumentSessionContextData> GetDocumentSessionAsync(
        CancellationToken cancellationToken = default
    ) => PeHostClient.SendAsync<NoRequest, RevitDocumentSessionContextData>(
        this._httpClient,
        GetRevitDocumentSessionContextOperationContract.Definition,
        new NoRequest(),
        cancellationToken
    );

    /// <summary>
    /// Gets bounded visible-element context for the active view or explicit view handles.
    /// </summary>
    /// <remarks>
    /// Use this when the user asks about "visible", "current view", or printed view contents. Prefer
    /// handles-only output for joins: resolve view/sheet handles once, collect visible equipment handles,
    /// then pass those handles into matrix or detail calls.
    /// </remarks>
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

/// <summary>
/// Natural-language reference resolution operations.
/// </summary>
public sealed class PeHostRevitResolveClient(HttpClient httpClient) {
    private readonly HttpClient _httpClient = httpClient;

    /// <summary>
    /// Resolves fuzzy user phrases such as "M201", "printed lower level", or "selected equipment" to stable handles.
    /// </summary>
    /// <remarks>
    /// Resolve each phrase once per turn and reuse returned handles. For printed-context questions, narrow the
    /// request to view/sheet handle kinds and require printed context where possible; do not repeat broad fuzzy
    /// resolution after the scope is known.
    /// </remarks>
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

/// <summary>
/// Revit catalog discovery operations.
/// </summary>
public sealed class PeHostRevitCatalogClient(HttpClient httpClient) {
    private readonly HttpClient _httpClient = httpClient;

    /// <summary>
    /// Discovers loaded families and types with bounded projections.
    /// </summary>
    public Task<LoadedFamiliesCatalogData> GetLoadedFamiliesAsync(
        LoadedFamiliesCatalogRequest request,
        CancellationToken cancellationToken = default
    ) => PeHostClient.SendAsync<LoadedFamiliesCatalogRequest, LoadedFamiliesCatalogData>(
        this._httpClient,
        GetLoadedFamiliesCatalogOperationContract.Definition,
        request,
        cancellationToken
    );

    /// <summary>
    /// Gets the loaded-family filter schema for building valid loaded-family catalog requests.
    /// </summary>
    public Task<SchemaData> GetLoadedFamilyFilterSchemaAsync(
        CancellationToken cancellationToken = default
    ) => PeHostClient.SendAsync<NoRequest, SchemaData>(
        this._httpClient,
        GetLoadedFamiliesFilterSchemaOperationContract.Definition,
        new NoRequest(),
        cancellationToken
    );

    /// <summary>
    /// Gets document-specific loaded-family filter options.
    /// </summary>
    public Task<FieldOptionsData> GetLoadedFamilyFilterFieldOptionsAsync(
        LoadedFamiliesFilterFieldOptionsRequest request,
        CancellationToken cancellationToken = default
    ) => PeHostClient.SendAsync<LoadedFamiliesFilterFieldOptionsRequest, FieldOptionsData>(
        this._httpClient,
        GetLoadedFamiliesFilterFieldOptionsOperationContract.Definition,
        request,
        cancellationToken
    );

    /// <summary>
    /// Gets project parameter binding facts before parameter coverage audits.
    /// </summary>
    public Task<ProjectParameterBindingsData> GetParameterBindingsAsync(
        ProjectParameterBindingsRequest request,
        CancellationToken cancellationToken = default
    ) => PeHostClient.SendAsync<ProjectParameterBindingsRequest, ProjectParameterBindingsData>(
        this._httpClient,
        GetProjectParameterBindingsOperationContract.Definition,
        request,
        cancellationToken
    );

    /// <summary>
    /// Ranks task-relevant parameter identities from bindings, schedules, and scoped element evidence.
    /// </summary>
    /// <remarks>
    /// Use this before detail or coverage calls when project standards may use a custom/shared parameter
    /// instead of a familiar built-in such as Mark. Inspect reasons, then pass observed identities or
    /// <see cref="ParameterReference"/> values into <see cref="PeHostRevitMatrixClient.GetParameterCoverageAsync"/>
    /// or <see cref="PeHostRevitDetailClient.GetElementsAsync"/>.
    /// </remarks>
    public Task<ConceptEvidenceData> GetConceptEvidenceAsync(
        ConceptEvidenceRequest request,
        CancellationToken cancellationToken = default
    ) => PeHostClient.SendAsync<ConceptEvidenceRequest, ConceptEvidenceData>(
        this._httpClient,
        GetConceptEvidenceOperationContract.Definition,
        request,
        cancellationToken
    );

    public Task<ParameterEvidenceData> GetParameterEvidenceAsync(
        ParameterEvidenceRequest request,
        CancellationToken cancellationToken = default
    ) => PeHostClient.SendAsync<ParameterEvidenceRequest, ParameterEvidenceData>(
        this._httpClient,
        GetParameterEvidenceOperationContract.Definition,
        request,
        cancellationToken
    );

    /// <summary>
    /// Discovers candidate schedules and schedule handles.
    /// </summary>
    /// <remarks>
    /// Use this for schedule discovery, filtering, and handle provenance. Keep default responses compact;
    /// request <c>parameterUsages</c> only when schedule fields are the next join input. Do not use broad
    /// schedule catalog calls to answer visible-equipment coverage; use <see cref="PeHostRevitMatrixClient.GetScheduleCoverageAsync"/>
    /// from resolved view or element handles instead.
    /// </remarks>
    public Task<ScheduleCatalogData> GetSchedulesAsync(
        ScheduleCatalogRequest request,
        CancellationToken cancellationToken = default
    ) => PeHostClient.SendAsync<ScheduleCatalogRequest, ScheduleCatalogData>(
        this._httpClient,
        GetScheduleCatalogOperationContract.Definition,
        request,
        cancellationToken
    );

    /// <summary>
    /// Discovers electrical panels by known names, marks, or panel filters.
    /// </summary>
    /// <remarks>
    /// Use after context/detail calls identify likely panel names or element handles. Avoid broad electrical
    /// catalog calls before exact equipment or panel candidates exist.
    /// </remarks>
    public Task<ElectricalPanelsCatalogData> GetElectricalPanelsAsync(
        ElectricalPanelsCatalogRequest request,
        CancellationToken cancellationToken = default
    ) => PeHostClient.SendAsync<ElectricalPanelsCatalogRequest, ElectricalPanelsCatalogData>(
        this._httpClient,
        GetElectricalPanelsCatalogOperationContract.Definition,
        request,
        cancellationToken
    );

    /// <summary>
    /// Discovers electrical circuits by known panel, circuit number, load name, or nearby proxy context.
    /// </summary>
    /// <remarks>
    /// Use this only after exact element detail or panel schedule inspection yields candidate panel/load/circuit
    /// values. Feed the discovered values back into narrow filters instead of scanning all circuits.
    /// </remarks>
    public Task<ElectricalCircuitsCatalogData> GetElectricalCircuitsAsync(
        ElectricalCircuitsCatalogRequest request,
        CancellationToken cancellationToken = default
    ) => PeHostClient.SendAsync<ElectricalCircuitsCatalogRequest, ElectricalCircuitsCatalogData>(
        this._httpClient,
        GetElectricalCircuitsCatalogOperationContract.Definition,
        request,
        cancellationToken
    );

    /// <summary>
    /// Gets electrical load classifications for known electrical workflows.
    /// </summary>
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

/// <summary>
/// Revit matrix and coverage operations.
/// </summary>
public sealed class PeHostRevitMatrixClient(HttpClient httpClient) {
    private readonly HttpClient _httpClient = httpClient;

    /// <summary>
    /// Gets loaded-family/type matrix facts for bounded family analysis.
    /// </summary>
    public Task<LoadedFamiliesMatrixData> GetLoadedFamiliesAsync(
        LoadedFamiliesMatrixRequest request,
        CancellationToken cancellationToken = default
    ) => PeHostClient.SendAsync<LoadedFamiliesMatrixRequest, LoadedFamiliesMatrixData>(
        this._httpClient,
        GetLoadedFamiliesMatrixOperationContract.Definition,
        request,
        cancellationToken
    );

    /// <summary>
    /// Gets schedule profile projections for known schedules.
    /// </summary>
    public Task<ScheduleProfilesQueryData> GetScheduleProfilesAsync(
        ScheduleProfilesQueryRequest request,
        CancellationToken cancellationToken = default
    ) => PeHostClient.SendAsync<ScheduleProfilesQueryRequest, ScheduleProfilesQueryData>(
        this._httpClient,
        GetScheduleProfilesQueryOperationContract.Definition,
        request,
        cancellationToken
    );

    /// <summary>
    /// Audits whether scoped elements are represented by candidate schedules.
    /// </summary>
    /// <remarks>
    /// Best join path for visible equipment audits: resolve view/sheet handles once, collect visible equipment
    /// handles if needed, call this with <see cref="RevitElementScope.ViewReferences"/> or
    /// <see cref="RevitElementScope.ExplicitHandles"/>, then inspect only missing handles through
    /// <see cref="PeHostRevitDetailClient.GetElementsAsync"/>.
    /// </remarks>
    public Task<ScheduleCoverageData> GetScheduleCoverageAsync(
        ScheduleCoverageRequest request,
        CancellationToken cancellationToken = default
    ) => PeHostClient.SendAsync<ScheduleCoverageRequest, ScheduleCoverageData>(
        this._httpClient,
        GetScheduleCoverageOperationContract.Definition,
        request,
        cancellationToken
    );

    /// <summary>
    /// Audits parameter presence, blank values, and default values over scoped elements.
    /// </summary>
    /// <remarks>
    /// Use after parameter binding discovery when the question is about missing/blank/default parameter values.
    /// Scope by active view, explicit handles, or known categories; inspect samples through detail calls only
    /// when the matrix result shows a focused problem.
    /// </remarks>
    public Task<ParameterCoverageData> GetParameterCoverageAsync(
        ParameterCoverageRequest request,
        CancellationToken cancellationToken = default
    ) => PeHostClient.SendAsync<ParameterCoverageRequest, ParameterCoverageData>(
        this._httpClient,
        GetParameterCoverageOperationContract.Definition,
        request,
        cancellationToken
    );
}

/// <summary>
/// Revit detail operations for exact handles, rows, and electrical facts.
/// </summary>
public sealed class PeHostRevitDetailClient(HttpClient httpClient) {
    private readonly HttpClient _httpClient = httpClient;

    /// <summary>
    /// Gets exact element context for selected or explicit element handles.
    /// </summary>
    /// <remarks>
    /// This is the preferred element/electrical join surface. For equipment alignment, request parameters such as
    /// Mark, Panel, Circuit Number, and Load Name, then use returned panel/circuit/load facts to narrow electrical
    /// catalog or panel-schedule calls.
    /// </remarks>
    public Task<ElementContextQueryData> GetElementsAsync(
        ElementContextQueryRequest request,
        CancellationToken cancellationToken = default
    ) => PeHostClient.SendAsync<ElementContextQueryRequest, ElementContextQueryData>(
        this._httpClient,
        GetElementContextQueryOperationContract.Definition,
        request,
        cancellationToken
    );

    /// <summary>
    /// Gets rendered row/cell detail for known schedules.
    /// </summary>
    /// <remarks>
    /// Resolve or catalog schedules first, then query exact schedule names/handles. Include columns to inspect
    /// header text, field names, and backing parameter identity before comparing element values. Use row/issue
    /// projections for schedule data audits instead of dumping broad schedule catalogs.
    /// </remarks>
    public Task<ScheduleQueryData> GetSchedulesAsync(
        ScheduleQueryRequest request,
        CancellationToken cancellationToken = default
    ) => PeHostClient.SendAsync<ScheduleQueryRequest, ScheduleQueryData>(
        this._httpClient,
        GetScheduleQueryOperationContract.Definition,
        request,
        cancellationToken
    );

    /// <summary>
    /// Gets rendered panel-schedule rows/cells for known panel schedules or panel names.
    /// </summary>
    /// <remarks>
    /// Use after exact equipment detail or electrical catalog calls identify candidate panel names, circuit
    /// numbers, or load names. This is detail, not discovery; keep the query focused.
    /// </remarks>
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

    public Task<ScriptPodImportData> ImportPodAsync(
        ScriptPodImportRequest request,
        CancellationToken cancellationToken = default
    ) => PeHostClient.SendAsync<ScriptPodImportRequest, ScriptPodImportData>(
        this._httpClient,
        ImportScriptPodOperationContract.Definition,
        request,
        cancellationToken
    );

    public Task<ScriptPodExportData> ExportPodAsync(
        ScriptPodExportRequest request,
        CancellationToken cancellationToken = default
    ) => PeHostClient.SendAsync<ScriptPodExportRequest, ScriptPodExportData>(
        this._httpClient,
        ExportScriptPodOperationContract.Definition,
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
