using Newtonsoft.Json;
using Newtonsoft.Json.Converters;
using Newtonsoft.Json.Linq;
using Newtonsoft.Json.Serialization;
using NJsonSchema;
using Pe.Revit.SettingsRuntime.Json;
using Pe.Shared.Product;
using Pe.Shared.StorageRuntime;
using Pe.Shared.StorageRuntime.Capabilities;
using Pe.Shared.StorageRuntime.Documents;
using System.Net.Http;
using System.Text;

namespace Pe.Revit.SettingsRuntime.Modules;

internal static class TsSettingsDocumentClient {
    private const string OpenWithModuleRpcTag = "settings.document.open-with-module";
    private const string RpcRequestId = "1";

    private static readonly HttpClient HttpClient = new() {
        Timeout = TimeSpan.FromSeconds(10)
    };

    private static readonly JsonSerializerSettings TransportJsonSettings = new() {
        ContractResolver = new CamelCasePropertyNamesContractResolver(),
        Converters = [new StringEnumConverter()],
        NullValueHandling = NullValueHandling.Ignore
    };

    public static SettingsDocumentSnapshot OpenRequired<TSettings>(
        ModuleDocumentStorage documents,
        string relativePath,
        string rootKey
    ) where TSettings : class {
        var documentId = documents.CreateDocumentId(relativePath, rootKey);
        var request = new TsSettingsOpenRequest(
            new OpenSettingsDocumentRequest(
                documentId,
                true
            ),
            new TsSettingsModuleDescriptor(
                documents.ModuleKey,
                documents.DefaultRootKey,
                [new TsSettingsRootDescriptor(rootKey, rootKey)],
                new TsSettingsStorageOptions(
                    [.. documents.StorageOptions.IncludeRoots],
                    [.. documents.StorageOptions.PresetRoots]
                )
            ),
            RevitJsonSchemaFactory
                .BuildAuthoringSchema(typeof(TSettings), documents.RuntimeMode, resolveFieldOptionSamples: false)
                .ToJson()
        );

        var url = $"{HostProcessIdentity.ResolveHostBaseUrl().TrimEnd('/')}/rpc";
        var rpcRequest = new JObject {
            ["_tag"] = "Request",
            ["id"] = RpcRequestId,
            ["tag"] = OpenWithModuleRpcTag,
            ["payload"] = JObject.FromObject(request, JsonSerializer.Create(TransportJsonSettings)),
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
                $"TS settings runtime failed ({(int) response.StatusCode}): {responseText}"
            );

        return ReadOpenWithModuleRpcResponse(responseText, documentId.StableId);
    }

    private static SettingsDocumentSnapshot ReadOpenWithModuleRpcResponse(
        string responseText,
        string stableDocumentId
    ) {
        foreach (var rawLine in responseText.Split(['\r', '\n'], StringSplitOptions.RemoveEmptyEntries)) {
            var message = JObject.Parse(rawLine);
            var tag = message.Value<string>("_tag");
            if (tag == "Exit")
                return ReadRpcExit(message, stableDocumentId);
            if (tag == "Defect")
                throw new InvalidOperationException($"TS settings runtime failed: {message.ToString(Formatting.None)}");
        }

        throw new InvalidOperationException("TS settings runtime returned no terminal RPC response.");
    }

    private static SettingsDocumentSnapshot ReadRpcExit(JObject message, string stableDocumentId) {
        var exit = message["exit"] as JObject
                   ?? throw new InvalidOperationException("TS settings runtime returned a malformed RPC exit.");
        var exitTag = exit.Value<string>("_tag");
        if (exitTag == "Success") {
            var value = exit["value"]
                        ?? throw new InvalidOperationException("TS settings runtime returned an empty settings snapshot.");
            return value.ToObject<SettingsDocumentSnapshot>(JsonSerializer.Create(TransportJsonSettings))
                   ?? throw new InvalidOperationException("TS settings runtime returned an empty settings snapshot.");
        }

        var error = FindHostRpcError(exit["cause"]);
        var status = error?.Value<int?>("status");
        var messageText = error?.Value<string>("message")
                          ?? exit.ToString(Formatting.None);
        if (status == 404)
            throw new FileNotFoundException($"Settings document '{stableDocumentId}' was not found.");

        throw new InvalidOperationException(
            $"TS settings runtime failed ({status?.ToString() ?? "RPC failure"}): {messageText}"
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

    private sealed record TsSettingsOpenRequest(
        OpenSettingsDocumentRequest Request,
        TsSettingsModuleDescriptor Module,
        string SchemaJson
    );

    private sealed record TsSettingsModuleDescriptor(
        string ModuleKey,
        string DefaultRootKey,
        IReadOnlyCollection<TsSettingsRootDescriptor> Roots,
        TsSettingsStorageOptions StorageOptions
    );

    private sealed record TsSettingsRootDescriptor(
        string RootKey,
        string DisplayName
    );

    private sealed record TsSettingsStorageOptions(
        IReadOnlyCollection<string> IncludeRoots,
        IReadOnlyCollection<string> PresetRoots
    );
}
