using Newtonsoft.Json;
using Newtonsoft.Json.Converters;
using Newtonsoft.Json.Linq;
using Newtonsoft.Json.Serialization;
using System.Net.Http;
using System.Text;

namespace Pe.Shared.Product;

/// <summary>
///     The Revit-side caller for the TS host's single wire: POST /call { key, request }.
///     Success is the operation's response JSON; failure is problem-JSON
///     ({ kind, message, status }) surfaced as <see cref="TsHostCallException" />.
/// </summary>
public static class TsHostCallClient {
    // ponytail: one shared HttpClient, per-call timeout via cancellation token.
    private static readonly HttpClient HttpClient = new() {
        Timeout = System.Threading.Timeout.InfiniteTimeSpan
    };

    private static readonly JsonSerializerSettings WireJsonSettings = new() {
        ContractResolver = new CamelCasePropertyNamesContractResolver(),
        Converters = [new StringEnumConverter()],
        NullValueHandling = NullValueHandling.Ignore
    };

    public static TResponse Call<TResponse>(string key, object request, TimeSpan timeout)
        where TResponse : class {
        var url = $"{HostProcessIdentity.ResolveHostBaseUrl().TrimEnd('/')}/call";
        var body = new JObject {
            ["key"] = key,
            ["request"] = JObject.FromObject(request, JsonSerializer.Create(WireJsonSettings))
        };
        using var cancellation = new CancellationTokenSource(timeout);
        using var content = new StringContent(
            body.ToString(Formatting.None),
            Encoding.UTF8,
            "application/json"
        );
        using var response = HttpClient
            .PostAsync(url, content, cancellation.Token)
            .GetAwaiter()
            .GetResult();
        var responseText = response.Content.ReadAsStringAsync().GetAwaiter().GetResult();
        if (!response.IsSuccessStatusCode)
            throw TsHostCallException.FromProblemJson(key, (int) response.StatusCode, responseText);

        return JsonConvert.DeserializeObject<TResponse>(responseText, WireJsonSettings)
               ?? throw new TsHostCallException(
                   key,
                   (int) response.StatusCode,
                   null,
                   $"TS host returned an empty response for '{key}'."
               );
    }
}

/// <summary>A failed /call, carrying the problem-JSON status and kind.</summary>
public sealed class TsHostCallException : InvalidOperationException {
    public TsHostCallException(string key, int status, string? kind, string detail)
        : base($"TS host call '{key}' failed ({status}{(kind is null ? "" : $" {kind}")}): {detail}") {
        Key = key;
        Status = status;
        Kind = kind;
    }

    public string Key { get; }
    public int Status { get; }
    public string? Kind { get; }

    public static TsHostCallException FromProblemJson(string key, int httpStatus, string body) {
        try {
            var problem = JObject.Parse(body);
            return new TsHostCallException(
                key,
                problem.Value<int?>("status") ?? httpStatus,
                problem.Value<string>("kind"),
                problem.Value<string>("message") ?? body
            );
        }
        catch (JsonReaderException) {
            return new TsHostCallException(key, httpStatus, null, body);
        }
    }
}
