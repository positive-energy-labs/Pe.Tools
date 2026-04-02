using Newtonsoft.Json;
using Newtonsoft.Json.Converters;

namespace Pe.FamilyFoundry;

public sealed class ConnectorBindingsSpec {
    public List<ConnectorBindingSpec> Parameters { get; init; } = [];
}

public sealed class ConnectorBindingSpec {
    [JsonConverter(typeof(StringEnumConverter))]
    public ConnectorParameterKey Target { get; init; }

    public string SourceParameter { get; init; } = string.Empty;
}
