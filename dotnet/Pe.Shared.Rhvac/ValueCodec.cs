using System.Globalization;
using System.Text;
using Newtonsoft.Json.Linq;

namespace Pe.Shared.Rhvac;

public sealed class DecodeResult {
    public JToken Value { get; }
    public IReadOnlyList<JObject> Diagnostics { get; }
    public DecodeResult(JToken value, params JObject[] diagnostics) { Value = value; Diagnostics = diagnostics; }
}

public static class ValueCodec {
    // Explicit CP1252 decoding also works on netstandard without a process-wide encoding provider.
    private const string Cp1252Controls = "\u20ac\u0081\u201a\u0192\u201e\u2026\u2020\u2021\u02c6\u2030\u0160\u2039\u0152\u008d\u017d\u008f\u0090\u2018\u2019\u201c\u201d\u2022\u2013\u2014\u02dc\u2122\u0161\u203a\u0153\u009d\u017e\u0178";
    public static string DecodeText(byte[] bytes, int offset, int length) {
        var chars = new char[length];
        for (var i = 0; i < length; i++) { var b = bytes[offset + i]; chars[i] = b >= 128 && b <= 159 ? Cp1252Controls[b - 128] : (char)b; }
        return new string(chars);
    }
    public static JToken Number(double number) => double.IsNaN(number) ? new JObject { ["$number"] = "NaN" }
        : double.IsPositiveInfinity(number) ? new JObject { ["$number"] = "+Infinity" }
        : double.IsNegativeInfinity(number) ? new JObject { ["$number"] = "-Infinity" } : new JValue(number);
    public static JObject Diagnostic(string code, string message) => new JObject { ["code"] = code, ["message"] = message };
    public static DecodeResult Decode(byte[]? bytes) {
        if (bytes == null) return new DecodeResult(JValue.CreateNull());
        var raw = new JObject { ["binary"] = Convert.ToBase64String(bytes) };
        if (bytes.Length == 0) return new DecodeResult(new JArray());
        try {
            if (bytes.Length >= 16 && BitConverter.ToUInt16(bytes, 6) == 1) {
                var type = BitConverter.ToUInt16(bytes, 4);
                var count = BitConverter.ToInt32(bytes, 8);
                if (count < 0 || count > bytes.Length || BitConverter.ToInt32(bytes, 0) != count - 1 || BitConverter.ToInt32(bytes, 12) != 0)
                    throw new FormatException("Invalid variant array header.");
                var values = new JArray(); var offset = 16;
                for (var i = 0; i < count; i++) {
                    if (type == 0x2008) {
                        Require(bytes, offset, 2); var size = BitConverter.ToUInt16(bytes, offset); offset += 2;
                        Require(bytes, offset, size); values.Add(DecodeText(bytes, offset, size)); offset += size;
                    } else {
                        var size = type == 0x2003 || type == 0x2004 ? 4 : type == 0x200B ? 2 : throw new FormatException("Unsupported array variant " + type + ".");
                        Require(bytes, offset, size);
                        if (type == 0x2003) values.Add(BitConverter.ToInt32(bytes, offset));
                        else if (type == 0x2004) values.Add(Number(BitConverter.ToSingle(bytes, offset)));
                        else { var value = BitConverter.ToInt16(bytes, offset); if (value != -1 && value != 0) throw new FormatException("Invalid VB6 boolean."); values.Add(value); }
                        offset += size;
                    }
                }
                if (offset != bytes.Length) throw new FormatException("Trailing variant array bytes.");
                return new DecodeResult(values);
            }
            for (var i = 1; i <= 2 && i < bytes.Length; i++) {
                if (bytes[i] != (byte)'q' && bytes[i] != 0xA6) continue;
                var prefix = DecodeText(bytes, 0, i); var text = DecodeText(bytes, i + 1, bytes.Length - i - 1);
                JToken value;
                switch (prefix) {
                    case "3": value = new JValue(int.Parse(text, CultureInfo.InvariantCulture)); break;
                    case "4": value = Number(float.Parse(text, CultureInfo.InvariantCulture)); break;
                    case "6": value = Number(double.Parse(text, CultureInfo.InvariantCulture)); break;
                    case "8": value = new JValue(text); break;
                    case "11": value = new JValue(text == "True" || text == "-1" ? -1 : text == "False" || text == "0" ? 0 : throw new FormatException("Invalid scalar boolean.")); break;
                    default: throw new FormatException("Unsupported scalar variant.");
                }
                return new DecodeResult(new JArray(value));
            }
            throw new FormatException("Unknown binary format.");
        } catch (Exception e) when (e is FormatException || e is OverflowException || e is ArgumentException) {
            return new DecodeResult(raw, Diagnostic("unknown-format", e.Message));
        }
    }
    private static void Require(byte[] bytes, int offset, int size) { if (offset > bytes.Length - size) throw new FormatException("Truncated variant array."); }
    public static JToken CarryForward(JArray values, int index) {
        if (index < 0) throw new ArgumentOutOfRangeException(nameof(index));
        if (values.Count == 0) throw new InvalidOperationException("An empty array has no carry-forward value.");
        return values[Math.Min(index, values.Count - 1)].DeepClone();
    }
    public static bool Equal(JToken? a, JToken? b) => JToken.DeepEquals(a, b);
    public static JObject ArrayDifference(JArray before, JArray after) {
        var indexes = new JArray();
        for (var i = 0; i < Math.Max(before.Count, after.Count); i++)
            if (i >= before.Count || i >= after.Count || !Equal(before[i], after[i])) indexes.Add(i);
        var remaining = after.Select(x => x.DeepClone()).ToList();
        var permutation = before.Count == after.Count;
        foreach (var v in before) { var i = remaining.FindIndex(x => Equal(x, v)); if (i < 0) { permutation = false; break; } remaining.RemoveAt(i); }
        return new JObject { ["beforeLength"] = before.Count, ["afterLength"] = after.Count, ["changedIndexes"] = indexes, ["reorder"] = permutation && indexes.Count > 0 };
    }
}

public static class RhvacValueCodec {
    public static DecodeResult Decode(byte[]? bytes) => ValueCodec.Decode(bytes);
    public static JToken CarryForward(JArray values, int index) => ValueCodec.CarryForward(values, index);
}
