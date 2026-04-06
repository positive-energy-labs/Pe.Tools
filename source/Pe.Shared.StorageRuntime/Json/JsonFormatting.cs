using Newtonsoft.Json;
using Newtonsoft.Json.Converters;
using Newtonsoft.Json.Serialization;

namespace Pe.Shared.StorageRuntime.Json;

public static class JsonFormatting {
    public static string NormalizeTrailingNewline(string content) =>
        string.IsNullOrEmpty(content)
            ? Environment.NewLine
            : content.TrimEnd('\r', '\n') + Environment.NewLine;

    public static JsonSerializerSettings CreateCamelCaseSettings() {
        var settings = CreateDefaultSettings();
        settings.ContractResolver = new CamelCasePropertyNamesContractResolver();
        AddStringEnumConverter(settings);
        return settings;
    }

    public static JsonSerializer CreateSerializer(JsonSerializerSettings settings) {
        if (settings == null)
            throw new ArgumentNullException(nameof(settings));
        return JsonSerializer.Create(settings);
    }

    public static string Serialize(object value, JsonSerializerSettings settings) {
        if (settings == null)
            throw new ArgumentNullException(nameof(settings));
        return JsonConvert.SerializeObject(value, settings);
    }

    public static string SerializeIndented(object value, JsonSerializerSettings settings) {
        if (settings == null)
            throw new ArgumentNullException(nameof(settings));

        var effectiveSettings = CloneSettings(settings);
        effectiveSettings.Formatting = Formatting.Indented;
        return JsonConvert.SerializeObject(value, effectiveSettings);
    }

    public static string SerializeWithTrailingNewline(object value, JsonSerializerSettings settings) =>
        NormalizeTrailingNewline(Serialize(value, settings));

    private static JsonSerializerSettings CreateDefaultSettings() => new() {
        NullValueHandling = NullValueHandling.Ignore
    };

    private static JsonSerializerSettings CloneSettings(JsonSerializerSettings settings) => new() {
        Binder = settings.Binder,
        CheckAdditionalContent = settings.CheckAdditionalContent,
        Converters = settings.Converters.ToList(),
        ConstructorHandling = settings.ConstructorHandling,
        Context = settings.Context,
        ContractResolver = settings.ContractResolver,
        Culture = settings.Culture,
        DateFormatHandling = settings.DateFormatHandling,
        DateFormatString = settings.DateFormatString,
        DateParseHandling = settings.DateParseHandling,
        DateTimeZoneHandling = settings.DateTimeZoneHandling,
        DefaultValueHandling = settings.DefaultValueHandling,
        EqualityComparer = settings.EqualityComparer,
        FloatFormatHandling = settings.FloatFormatHandling,
        FloatParseHandling = settings.FloatParseHandling,
        Formatting = settings.Formatting,
        MaxDepth = settings.MaxDepth,
        MetadataPropertyHandling = settings.MetadataPropertyHandling,
        MissingMemberHandling = settings.MissingMemberHandling,
        NullValueHandling = settings.NullValueHandling,
        ObjectCreationHandling = settings.ObjectCreationHandling,
        PreserveReferencesHandling = settings.PreserveReferencesHandling,
        ReferenceLoopHandling = settings.ReferenceLoopHandling,
        ReferenceResolverProvider = settings.ReferenceResolverProvider,
        StringEscapeHandling = settings.StringEscapeHandling,
        TraceWriter = settings.TraceWriter,
        TypeNameAssemblyFormatHandling = settings.TypeNameAssemblyFormatHandling,
        TypeNameHandling = settings.TypeNameHandling
    };

    private static void AddStringEnumConverter(JsonSerializerSettings settings) {
        if (settings.Converters.OfType<StringEnumConverter>().Any())
            return;

        settings.Converters.Add(new StringEnumConverter());
    }
}