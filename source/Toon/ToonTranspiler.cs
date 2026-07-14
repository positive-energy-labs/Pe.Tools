using Newtonsoft.Json.Linq;

namespace Toon;

public static class ToonTranspiler {
    public static string EncodeJson(string json, ToonOptions? opts = null) {
        var options = opts ?? ToonOptions.Default;
        options.Validate();
        var token = JToken.Parse(json);
        return ToonEncoder.Encode(token, options);
    }
}