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

    /// <summary>For data stored in a model: defaults are written, so a stored value never depends on a DTO's default.</summary>
    public static JsonSerializer CreateStoredSerializer() {
        var settings = CreateSerializerSettings();
        settings.DefaultValueHandling = DefaultValueHandling.Include;
        return JsonSerializer.Create(settings);
    }

    public static string Serialize(object value, Formatting formatting = Formatting.None) =>
        JsonConvert.SerializeObject(value, formatting, CreateSerializerSettings());
}
