using Newtonsoft.Json;
using Newtonsoft.Json.Converters;
using Newtonsoft.Json.Serialization;

namespace Pe.Shared.RevitData.Serialization;

public static class RevitDataJson {
    public static JsonSerializerSettings CreateSerializerSettings() {
        var settings = new JsonSerializerSettings {
            NullValueHandling = NullValueHandling.Ignore,
            DefaultValueHandling = DefaultValueHandling.Ignore,
            ContractResolver = new DefaultContractResolver {
                NamingStrategy = new CamelCaseNamingStrategy {
                    ProcessDictionaryKeys = false,
                    OverrideSpecifiedNames = false
                }
            }
        };
        settings.Converters.Add(new StringEnumConverter());
        return settings;
    }

    public static string Serialize(object value, Formatting formatting = Formatting.None) =>
        JsonConvert.SerializeObject(value, formatting, CreateSerializerSettings());
}
