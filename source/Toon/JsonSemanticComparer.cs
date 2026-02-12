using Newtonsoft.Json.Linq;

namespace Toon;

public static class JsonSemanticComparer
{
    public static bool AreEquivalent(string leftJson, string rightJson)
    {
        var left = Normalize(JToken.Parse(leftJson));
        var right = Normalize(JToken.Parse(rightJson));
        return JToken.DeepEquals(left, right);
    }

    public static string Normalize(string json) => Normalize(JToken.Parse(json)).ToString(Newtonsoft.Json.Formatting.None);

    private static JToken Normalize(JToken token) =>
        token.Type switch
        {
            JTokenType.Object => NormalizeObject((JObject)token),
            JTokenType.Array => NormalizeArray((JArray)token),
            _ => token.DeepClone()
        };

    private static JToken NormalizeObject(JObject source)
    {
        var result = new JObject();
        foreach (var property in source.Properties().OrderBy(p => p.Name, StringComparer.Ordinal))
        {
            result[property.Name] = Normalize(property.Value);
        }

        return result;
    }

    private static JToken NormalizeArray(JArray source)
    {
        var result = new JArray();
        foreach (var item in source)
        {
            result.Add(Normalize(item));
        }

        return result;
    }
}
