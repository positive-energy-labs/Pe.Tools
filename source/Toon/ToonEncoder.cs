using System.Globalization;
using System.Text;
using System.Text.RegularExpressions;
using Newtonsoft.Json.Linq;

namespace Toon;

internal static class ToonEncoder {
    private static readonly Regex NumberLikeRegex =
        new(@"^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?$", RegexOptions.Compiled);

    public static string Encode(JToken token, ToonOptions options) {
        var lines = new List<string>();
        EncodeRoot(token, 0, lines, options);
        return string.Join(Environment.NewLine, lines);
    }

    private static void EncodeRoot(JToken token, int indentLevel, List<string> lines, ToonOptions options) {
        switch (token.Type) {
        case JTokenType.Object:
            EncodeObject((JObject)token, indentLevel, lines, options);
            return;
        case JTokenType.Array:
            EncodeArrayWithHeader(string.Empty, (JArray)token, indentLevel, lines, options);
            return;
        default:
            lines.Add(EncodePrimitive(token, options.Delimiter));
            return;
        }
    }

    private static void EncodeObject(JObject obj, int indentLevel, List<string> lines, ToonOptions options) {
        foreach (var property in obj.Properties()) {
            EncodeField(property.Name, property.Value, indentLevel, lines, options);
        }
    }

    private static void EncodeField(string key, JToken value, int indentLevel, List<string> lines, ToonOptions options) {
        var indent = GetIndent(indentLevel, options);
        var encodedKey = EncodeKey(key);

        switch (value.Type) {
        case JTokenType.Object:
            lines.Add($"{indent}{encodedKey}:");
            EncodeObject((JObject)value, indentLevel + 1, lines, options);
            return;
        case JTokenType.Array:
            EncodeArrayWithHeader(encodedKey, (JArray)value, indentLevel, lines, options);
            return;
        default:
            lines.Add($"{indent}{encodedKey}: {EncodePrimitive(value, options.Delimiter)}");
            return;
        }
    }

    private static void EncodeArrayWithHeader(
        string encodedKey,
        JArray array,
        int indentLevel,
        List<string> lines,
        ToonOptions options
    ) {
        var indent = GetIndent(indentLevel, options);
        var prefix = string.IsNullOrEmpty(encodedKey) ? string.Empty : encodedKey;

        if (TryGetTabular(array, out var columns, out var rows)) {
            var delim = options.Delimiter;
            var delimiterSuffix = delim == ',' ? string.Empty : delim.ToString();
            var fields = string.Join(delim.ToString(), columns.Select(EncodeKey));
            lines.Add($"{indent}{prefix}[{array.Count}{delimiterSuffix}]{{{fields}}}:");
            foreach (var row in rows) {
                var cells = row.Select(value => EncodePrimitive(value, delim));
                lines.Add($"{GetIndent(indentLevel + 1, options)}{string.Join(delim.ToString(), cells)}");
            }

            return;
        }

        if (array.All(IsPrimitiveLike)) {
            var encodedValues = array.Select(value => EncodePrimitive(value, options.Delimiter));
            lines.Add($"{indent}{prefix}[{array.Count}]: {string.Join(options.Delimiter.ToString(), encodedValues)}");
            return;
        }

        lines.Add($"{indent}{prefix}[{array.Count}]:");
        foreach (var item in array) {
            EncodeListItem(item, indentLevel + 1, lines, options);
        }
    }

    private static void EncodeListItem(JToken item, int indentLevel, List<string> lines, ToonOptions options) {
        var indent = GetIndent(indentLevel, options);
        if (IsPrimitiveLike(item)) {
            lines.Add($"{indent}- {EncodePrimitive(item, options.Delimiter)}");
            return;
        }

        if (item is JArray arr) {
            var temp = new List<string>();
            EncodeArrayWithHeader(string.Empty, arr, indentLevel, temp, options);
            if (temp.Count == 0) {
                lines.Add($"{indent}- [0]:");
                return;
            }

            var first = temp[0];
            temp[0] = $"{indent}- {first.TrimStart()}";
            lines.AddRange(temp);
            return;
        }

        if (item is JObject obj) {
            var props = obj.Properties().ToList();
            if (props.Count == 0) {
                lines.Add($"{indent}-");
                return;
            }

            var firstProp = props[0];
            if (IsPrimitiveLike(firstProp.Value)) {
                lines.Add($"{indent}- {EncodeKey(firstProp.Name)}: {EncodePrimitive(firstProp.Value, options.Delimiter)}");
            } else if (firstProp.Value is JArray firstArray) {
                var temp = new List<string>();
                EncodeArrayWithHeader(EncodeKey(firstProp.Name), firstArray, indentLevel + 1, temp, options);
                if (temp.Count > 0) {
                    var firstLine = temp[0].TrimStart();
                    lines.Add($"{indent}- {firstLine}");
                    for (var i = 1; i < temp.Count; i++) {
                        lines.Add(temp[i]);
                    }
                } else {
                    lines.Add($"{indent}- {EncodeKey(firstProp.Name)}[0]:");
                }
            } else {
                lines.Add($"{indent}- {EncodeKey(firstProp.Name)}:");
                EncodeObject((JObject)firstProp.Value, indentLevel + 2, lines, options);
            }

            foreach (var prop in props.Skip(1)) {
                EncodeField(prop.Name, prop.Value, indentLevel + 1, lines, options);
            }

            return;
        }

        lines.Add($"{indent}- {EncodePrimitive(item, options.Delimiter)}");
    }

    private static bool TryGetTabular(JArray array, out List<string> columns, out List<List<JToken>> rows) {
        columns = [];
        rows = [];
        if (array.Count == 0) {
            return false;
        }

        if (!array.All(x => x is JObject)) {
            return false;
        }

        var first = (JObject)array[0];
        var firstColumns = first.Properties().Select(p => p.Name).ToList();
        if (firstColumns.Count == 0) {
            return false;
        }

        foreach (var item in array.Cast<JObject>()) {
            var keys = item.Properties().Select(p => p.Name).OrderBy(x => x, StringComparer.Ordinal).ToList();
            var firstSorted = firstColumns.OrderBy(x => x, StringComparer.Ordinal).ToList();
            if (!keys.SequenceEqual(firstSorted, StringComparer.Ordinal)) {
                return false;
            }

            if (item.Properties().Any(p => !IsPrimitiveLike(p.Value))) {
                return false;
            }
        }

        columns = firstColumns;
        foreach (var item in array.Cast<JObject>()) {
            rows.Add(columns.Select(c => item[c] ?? JValue.CreateNull()).ToList());
        }

        return true;
    }

    private static string EncodePrimitive(JToken token, char delimiter) {
        return token.Type switch {
            JTokenType.Null => "null",
            JTokenType.Boolean => token.Value<bool>() ? "true" : "false",
            JTokenType.Integer => Convert.ToString(token, CultureInfo.InvariantCulture) ?? "0",
            JTokenType.Float => EncodeFloat(token),
            _ => EncodeString(token.ToString(), delimiter)
        };
    }

    private static string EncodeFloat(JToken token) {
        var value = token.Value<double>();
        if (double.IsNaN(value) || double.IsInfinity(value)) {
            return "null";
        }

        if (value == 0) {
            return "0";
        }

        return value.ToString("0.###############################", CultureInfo.InvariantCulture);
    }

    private static string EncodeKey(string key) => NeedsKeyQuotes(key) ? Quote(key) : key;

    private static bool NeedsKeyQuotes(string key) {
        if (string.IsNullOrEmpty(key)) return true;
        if (key.Any(char.IsControl)) return true;
        return key.Any(ch => ch is ':' or '"' or '\\' or '[' or ']' or '{' or '}');
    }

    private static string EncodeString(string value, char delimiter) {
        if (NeedsQuotes(value, delimiter)) {
            return Quote(value);
        }

        return value;
    }

    private static bool NeedsQuotes(string value, char delimiter) {
        if (value.Length == 0) return true;
        if (value != value.Trim()) return true;
        if (value is "true" or "false" or "null") return true;
        if (value == "-" || (value.StartsWith("-") && value.Length > 1)) return true;
        if (NumberLikeRegex.IsMatch(value)) return true;
        if (value.Any(ch => ch is ':' or '"' or '\\' or '[' or ']' or '{' or '}' or '\n' or '\r' or '\t')) return true;
        if (value.Contains(delimiter)) return true;
        return false;
    }

    private static string Quote(string value) {
        var sb = new StringBuilder();
        sb.Append('"');
        foreach (var ch in value) {
            _ = ch switch {
                '\\' => sb.Append("\\\\"),
                '"' => sb.Append("\\\""),
                '\n' => sb.Append("\\n"),
                '\r' => sb.Append("\\r"),
                '\t' => sb.Append("\\t"),
                _ => sb.Append(ch)
            };
        }

        sb.Append('"');
        return sb.ToString();
    }

    private static string GetIndent(int indentLevel, ToonOptions options) => new(' ', indentLevel * options.IndentSize);

    private static bool IsPrimitiveLike(JToken value) =>
        value.Type is JTokenType.Null
            or JTokenType.Boolean
            or JTokenType.Integer
            or JTokenType.Float
            or JTokenType.String
            or JTokenType.Date;
}
