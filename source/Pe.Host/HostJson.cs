using Newtonsoft.Json;
using Newtonsoft.Json.Converters;
using Newtonsoft.Json.Serialization;

namespace Pe.Host;

internal static class HostJson {
    public static JsonSerializerSettings CreateSerializerSettings() {
        var settings = new JsonSerializerSettings {
            NullValueHandling = NullValueHandling.Ignore,
            ContractResolver = new CamelCasePropertyNamesContractResolver()
        };
        settings.Converters.Add(new StringEnumConverter());
        return settings;
    }
}
