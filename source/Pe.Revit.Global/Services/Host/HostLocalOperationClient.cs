using Newtonsoft.Json;
using Newtonsoft.Json.Converters;
using Newtonsoft.Json.Linq;
using Newtonsoft.Json.Serialization;
using Pe.Shared.HostContracts.Operations;
using Pe.Shared.HostContracts.Protocol;
using System.Net;
using System.Net.Http;
using System.Text;

namespace Pe.Revit.Global.Services.Host;

public sealed class HostLocalOperationClient(HttpClient? httpClient = null) : IDisposable {
    private static readonly JsonSerializerSettings JsonSettings = new() {
        ContractResolver = new CamelCasePropertyNamesContractResolver(),
        NullValueHandling = NullValueHandling.Ignore,
        Converters = [new StringEnumConverter()]
    };

    private readonly HttpClient _httpClient = httpClient ?? new HttpClient();
    private readonly bool _ownsHttpClient = httpClient == null;

    public async Task<TResponse> ExecuteAsync<TRequest, TResponse>(
        HostOperationDefinition definition,
        TRequest request,
        CancellationToken cancellationToken = default
    ) {
        if (definition.ExecutionMode != HostExecutionMode.Local) {
            throw new InvalidOperationException(
                $"Host operation '{definition.Key}' is not a local host operation."
            );
        }

        using var message = this.CreateRequestMessage(definition, request);
        try {
            using var response = await this._httpClient.SendAsync(message, cancellationToken).ConfigureAwait(false);
            var content = response.Content == null
                ? ""
                : await response.Content.ReadAsStringAsync().ConfigureAwait(false);

            if (!response.IsSuccessStatusCode)
                throw CreateOperationFailure(definition, response.StatusCode, content);

            if (typeof(TResponse) == typeof(NoRequest) || string.IsNullOrWhiteSpace(content))
                return default!;

            return JsonConvert.DeserializeObject<TResponse>(content, JsonSettings)
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

    public void Dispose() {
        if (this._ownsHttpClient)
            this._httpClient.Dispose();
    }

    private HttpRequestMessage CreateRequestMessage<TRequest>(
        HostOperationDefinition definition,
        TRequest request
    ) {
        var route = definition.Verb == HostHttpVerb.Get
            ? AppendQueryString(definition.Route, request)
            : definition.Route;
        var requestMessage = new HttpRequestMessage(ToHttpMethod(definition.Verb), BuildAbsoluteUri(route));
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
        string content
    ) {
        var detail = TryReadProblemDetail(content);
        var message = string.IsNullOrWhiteSpace(detail)
            ? $"Host operation '{definition.Key}' failed with HTTP {(int)statusCode}."
            : detail;
        return new InvalidOperationException(message);
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

    private static HttpMethod ToHttpMethod(HostHttpVerb verb) =>
        verb switch {
            HostHttpVerb.Get => HttpMethod.Get,
            HostHttpVerb.Post => HttpMethod.Post,
            _ => throw new ArgumentOutOfRangeException(nameof(verb), verb, null)
        };

    private static string BuildAbsoluteUri(string route) =>
        $"{ResolveHostBaseUrl().TrimEnd('/')}{route}";

    private static string ResolveHostBaseUrl() {
        var configured = Environment.GetEnvironmentVariable(SettingsEditorRuntime.HostBaseUrlVariable);
        return string.IsNullOrWhiteSpace(configured)
            ? SettingsEditorRuntime.DefaultHostBaseUrl
            : configured;
    }

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

        return $"{route}?{string.Join("&", parameters)}";
    }

    private static string ConvertToString(object value) =>
        value switch {
            bool boolValue => boolValue ? "true" : "false",
            Enum enumValue => enumValue.ToString(),
            _ => Convert.ToString(value, System.Globalization.CultureInfo.InvariantCulture) ?? string.Empty
        };

    private static string ToCamelCase(string value) =>
        string.IsNullOrEmpty(value) ? value : char.ToLowerInvariant(value[0]) + value[1..];
}
