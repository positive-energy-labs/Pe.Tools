using Newtonsoft.Json;
using Newtonsoft.Json.Converters;
using Newtonsoft.Json.Linq;
using Newtonsoft.Json.Serialization;
using Pe.Shared.ApsAuth;
using Pe.Shared.Product;
using System.Net.Http;
using System.Text;

namespace Pe.Revit.Global.Services.Aps;

internal static class TsApsAuthClient {
    private const string RpcRequestId = "1";

    private static readonly HttpClient HttpClient = new() {
        Timeout = TimeSpan.FromSeconds(30)
    };

    private static readonly JsonSerializerSettings TransportJsonSettings = new() {
        ContractResolver = new CamelCasePropertyNamesContractResolver(),
        Converters = [new StringEnumConverter()],
        NullValueHandling = NullValueHandling.Ignore
    };

    public static ApsTokenResult AcquireAccessToken(ApsTokenRequest request) =>
        Call<ApsTokenRequest, ApsTokenResult>("aps.auth.token", request);

    public static ApsPersistedTokenStatus Login(ApsTokenRequest request) =>
        Call<ApsTokenRequest, ApsPersistedTokenStatus>("aps.auth.login", request);

    public static ApsPersistedTokenStatus Status(ApsTokenRequest request) =>
        Call<ApsTokenRequest, ApsPersistedTokenStatus>("aps.auth.status", request);

    private static TResponse Call<TRequest, TResponse>(string rpcTag, TRequest request) {
        var url = $"{HostProcessIdentity.ResolveHostBaseUrl().TrimEnd('/')}/rpc";
        var rpcRequest = new JObject {
            ["_tag"] = "Request",
            ["id"] = RpcRequestId,
            ["tag"] = rpcTag,
            ["payload"] = JObject.FromObject(request!, JsonSerializer.Create(TransportJsonSettings)),
            ["headers"] = new JArray()
        };
        using var content = new StringContent(
            rpcRequest.ToString(Formatting.None) + "\n",
            Encoding.UTF8,
            "application/ndjson"
        );
        using var response = HttpClient.PostAsync(url, content).GetAwaiter().GetResult();
        var responseText = response.Content.ReadAsStringAsync().GetAwaiter().GetResult();
        if (!response.IsSuccessStatusCode)
            throw new InvalidOperationException(
                $"TS APS auth runtime failed ({(int) response.StatusCode}): {responseText}"
            );

        return ReadRpcResponse<TResponse>(responseText, rpcTag);
    }

    private static TResponse ReadRpcResponse<TResponse>(string responseText, string rpcTag) {
        foreach (var rawLine in responseText.Split(['\r', '\n'], StringSplitOptions.RemoveEmptyEntries)) {
            var message = JObject.Parse(rawLine);
            var tag = message.Value<string>("_tag");
            if (tag == "Exit")
                return ReadRpcExit<TResponse>(message, rpcTag);
            if (tag == "Defect")
                throw new InvalidOperationException($"TS APS auth runtime failed: {message.ToString(Formatting.None)}");
        }

        throw new InvalidOperationException("TS APS auth runtime returned no terminal RPC response.");
    }

    private static TResponse ReadRpcExit<TResponse>(JObject message, string rpcTag) {
        var exit = message["exit"] as JObject
                   ?? throw new InvalidOperationException("TS APS auth runtime returned a malformed RPC exit.");
        var exitTag = exit.Value<string>("_tag");
        if (exitTag == "Success") {
            var value = exit["value"]
                        ?? throw new InvalidOperationException($"TS APS auth runtime returned an empty response for '{rpcTag}'.");
            return value.ToObject<TResponse>(JsonSerializer.Create(TransportJsonSettings))
                   ?? throw new InvalidOperationException($"TS APS auth runtime returned an empty response for '{rpcTag}'.");
        }

        var error = FindHostRpcError(exit["cause"]);
        var status = error?.Value<int?>("status");
        var messageText = error?.Value<string>("message")
                          ?? exit.ToString(Formatting.None);
        throw new InvalidOperationException(
            $"TS APS auth runtime failed ({status?.ToString() ?? "RPC failure"}): {messageText}"
        );
    }

    private static JObject? FindHostRpcError(JToken? cause) {
        if (cause is not JArray failures)
            return null;

        foreach (var failure in failures.OfType<JObject>()) {
            if (failure.Value<string>("_tag") != "Fail")
                continue;
            if (failure["error"] is JObject error)
                return error;
        }

        return null;
    }
}
