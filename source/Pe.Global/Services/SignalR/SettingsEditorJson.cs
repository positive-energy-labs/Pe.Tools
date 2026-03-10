using Microsoft.AspNetCore.SignalR;
using Newtonsoft.Json;
using Newtonsoft.Json.Converters;
using Newtonsoft.Json.Serialization;

namespace Pe.Global.Services.SignalR;

/// <summary>
///     Central JSON serializer settings for the settings-editor SignalR contract.
///     Tests and transport setup should both use this so the wire format cannot drift silently.
/// </summary>
public static class SettingsEditorJson {
    public static JsonSerializerSettings CreateSerializerSettings() {
        var settings = new JsonSerializerSettings {
            NullValueHandling = NullValueHandling.Ignore,
            ContractResolver = new CamelCasePropertyNamesContractResolver()
        };
        settings.Converters.Add(new StringEnumConverter());
        return settings;
    }

    public static void ConfigureProtocol(NewtonsoftJsonHubProtocolOptions options) {
        var settings = CreateSerializerSettings();
        options.PayloadSerializerSettings.NullValueHandling = settings.NullValueHandling;
        options.PayloadSerializerSettings.ContractResolver = settings.ContractResolver;

        foreach (var converter in settings.Converters)
            options.PayloadSerializerSettings.Converters.Add(converter);
    }
}
