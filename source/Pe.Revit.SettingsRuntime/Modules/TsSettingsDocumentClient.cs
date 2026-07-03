using Newtonsoft.Json;
using Newtonsoft.Json.Converters;
using Newtonsoft.Json.Serialization;
using NJsonSchema;
using Pe.Revit.SettingsRuntime.Json;
using Pe.Shared.Product;
using Pe.Shared.StorageRuntime;
using Pe.Shared.StorageRuntime.Capabilities;
using Pe.Shared.StorageRuntime.Documents;
using System.Net;
using System.Net.Http;
using System.Text;

namespace Pe.Revit.SettingsRuntime.Modules;

internal static class TsSettingsDocumentClient {
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
        var request = new TsSettingsOpenRequest(
            new OpenSettingsDocumentRequest(
                documents.CreateDocumentId(relativePath, rootKey),
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

        var url = $"{HostProcessIdentity.ResolveHostBaseUrl().TrimEnd('/')}/api/settings/document/open";
        using var content = new StringContent(
            JsonConvert.SerializeObject(request, TransportJsonSettings),
            Encoding.UTF8,
            "application/json"
        );
        using var response = HttpClient.PostAsync(url, content).GetAwaiter().GetResult();
        var responseText = response.Content.ReadAsStringAsync().GetAwaiter().GetResult();
        if (response.StatusCode == HttpStatusCode.NotFound)
            throw new FileNotFoundException(
                $"Settings document '{documents.CreateDocumentId(relativePath, rootKey).StableId}' was not found."
            );
        if (!response.IsSuccessStatusCode)
            throw new InvalidOperationException(
                $"TS settings runtime failed ({(int) response.StatusCode}): {responseText}"
            );

        return JsonConvert.DeserializeObject<SettingsDocumentSnapshot>(
                   responseText,
                   TransportJsonSettings
               )
               ?? throw new InvalidOperationException("TS settings runtime returned an empty settings snapshot.");
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
