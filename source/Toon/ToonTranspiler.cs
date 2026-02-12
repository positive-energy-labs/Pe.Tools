using Newtonsoft.Json;
using Newtonsoft.Json.Linq;

namespace Toon;

public static class ToonTranspiler
{
    public static string EncodeJson(string json, ToonOptions? opts = null)
    {
        var options = opts ?? ToonOptions.Default;
        options.Validate();
        var token = JToken.Parse(json);
        return ToonEncoder.Encode(token, options);
    }

    public static string DecodeToJson(string toon, ToonOptions? opts = null)
    {
        var options = opts ?? ToonOptions.Default;
        options.Validate();
        var token = ToonDecoder.Decode(toon, options);
        return token.ToString(Formatting.Indented);
    }
}
