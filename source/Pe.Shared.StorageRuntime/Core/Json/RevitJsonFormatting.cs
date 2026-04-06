using Newtonsoft.Json;
using Newtonsoft.Json.Converters;
using Pe.Shared.StorageRuntime.Json;
using Pe.Shared.StorageRuntime.Json.ContractResolvers;
using Pe.Shared.StorageRuntime.Core.Json.ContractResolvers;

namespace Pe.Shared.StorageRuntime.Core.Json;

public static class RevitJsonFormatting {
    public static JsonSerializerSettings CreateRevitIndentedSettings() {
        var settings = CreateIndentedSettings();
        settings.ContractResolver = new RevitTypeContractResolver();
        AddStringEnumConverter(settings);
        return settings;
    }

    public static JsonSerializerSettings CreateRequiredAwareRevitIndentedSettings(
        JsonTypeSchemaBindingRegistry? bindingRegistry = null
    ) {
        var settings = CreateIndentedSettings();
        settings.ContractResolver = new RequiredAwareContractResolver(bindingRegistry);
        AddStringEnumConverter(settings);
        return settings;
    }

    public static JsonSerializer CreateSerializer(JsonSerializerSettings settings) {
        if (settings == null)
            throw new ArgumentNullException(nameof(settings));
        return JsonFormatting.CreateSerializer(settings);
    }

    public static string Serialize(object value, JsonSerializerSettings settings) {
        if (settings == null)
            throw new ArgumentNullException(nameof(settings));
        return JsonFormatting.Serialize(value, settings);
    }

    public static string SerializeIndented(object value, JsonSerializerSettings settings) {
        if (settings == null)
            throw new ArgumentNullException(nameof(settings));
        return JsonFormatting.SerializeIndented(value, settings);
    }

    public static string SerializeWithTrailingNewline(object value, JsonSerializerSettings settings) {
        if (settings == null)
            throw new ArgumentNullException(nameof(settings));
        return JsonFormatting.SerializeWithTrailingNewline(value, settings);
    }

    private static JsonSerializerSettings CreateIndentedSettings() => new() {
        Formatting = Formatting.Indented,
        NullValueHandling = NullValueHandling.Ignore
    };

    private static void AddStringEnumConverter(JsonSerializerSettings settings) {
        if (settings.Converters.OfType<StringEnumConverter>().Any())
            return;

        settings.Converters.Add(new StringEnumConverter());
    }
}
