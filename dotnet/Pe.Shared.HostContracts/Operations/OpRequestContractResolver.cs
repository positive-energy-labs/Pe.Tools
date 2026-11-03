using System.Reflection;
using Newtonsoft.Json;
using Newtonsoft.Json.Serialization;

namespace Pe.Shared.HostContracts.Operations;

internal sealed class OpRequestContractResolver : DefaultContractResolver {
    protected override JsonProperty CreatePropertyFromConstructorParameter(JsonProperty? matchingMemberProperty, ParameterInfo parameterInfo) {
        var property = base.CreatePropertyFromConstructorParameter(matchingMemberProperty, parameterInfo);
        if (parameterInfo.HasDefaultValue) {
            // C# constructors own defaults. Populate here keeps dispatch and nested DTOs correct
            // without a second default table in the generated catalog or TS host. Populate alone
            // (not Ignore) preserves explicitly supplied zero and false values.
            property.DefaultValue = parameterInfo.DefaultValue;
            property.DefaultValueHandling = DefaultValueHandling.Populate;
            // Json.NET consults both the creator parameter and its member during missing-value population.
            if (matchingMemberProperty != null) {
                matchingMemberProperty.DefaultValue = parameterInfo.DefaultValue;
                matchingMemberProperty.DefaultValueHandling = DefaultValueHandling.Populate;
            }
        }
        return property;
    }
}
