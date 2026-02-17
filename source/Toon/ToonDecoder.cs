using System.Globalization;
using System.Text;
using System.Text.RegularExpressions;
using Newtonsoft.Json.Linq;

namespace Toon;

internal static class ToonDecoder
{
    private static readonly Regex HeaderRegex = new(
        "^(?<key>(?:\"(?:\\\\.|[^\"])*\"|[^\\[\\]:]+)?)\\[(?<count>\\d+)(?<delim>[\\t|])?\\](?:\\{(?<fields>.*)\\})?:\\s*(?<tail>.*)$",
        RegexOptions.Compiled);
    private static readonly Regex IntegerRegex = new(@"^-?(?:0|[1-9]\d*)$", RegexOptions.Compiled);
    private static readonly Regex FloatRegex = new(@"^-?(?:0|[1-9]\d*)\.\d+$|^-?(?:0|[1-9]\d*)[eE][+-]?\d+$|^-?(?:0|[1-9]\d*)\.\d+[eE][+-]?\d+$", RegexOptions.Compiled);

    public static JToken Decode(string toon, ToonOptions options)
    {
        var lines = ParseLines(toon, options);
        if (lines.Count == 0)
        {
            return new JObject();
        }

        var state = new State(lines, options);
        var rootLine = state.Peek() ?? throw new ToonParseException("Unexpected empty state.");
        if (IsArrayHeader(rootLine.Content, out var rootHeader) && string.IsNullOrWhiteSpace(rootHeader.Key))
        {
            var token = ParseArray(state, 0, false);
            EnsureComplete(state);
            return token;
        }

        if (!rootLine.Content.Contains(':'))
        {
            var primitive = ParseScalar(rootLine.Content, options.Delimiter);
            state.Advance();
            EnsureComplete(state);
            return primitive;
        }

        var root = ParseObject(state, 0);
        EnsureComplete(state);
        return root;
    }

    private static JObject ParseObject(State state, int indentLevel)
    {
        var obj = new JObject();
        while (!state.IsComplete)
        {
            var line = state.Peek()!;
            if (line.IndentLevel < indentLevel) break;
            if (line.IndentLevel > indentLevel)
            {
                throw new ToonParseException($"Unexpected indentation at line {line.LineNumber}.");
            }

            var (rawKey, remainder) = SplitAtFirstColon(line.Content);
            if (string.IsNullOrWhiteSpace(rawKey))
            {
                throw new ToonParseException($"Missing object key at line {line.LineNumber}.");
            }

            if (IsArrayHeader(line.Content, out var arrayHeader) && !string.IsNullOrWhiteSpace(arrayHeader.Key))
            {
                var arrayValue = ParseArray(state, indentLevel, true);
                obj[DecodeKey(arrayHeader.Key)] = arrayValue;
                continue;
            }

            var key = DecodeKey(rawKey.Trim());
            state.Advance();
            if (string.IsNullOrWhiteSpace(remainder))
            {
                var next = state.Peek();
                if (next is null || next.IndentLevel <= indentLevel)
                {
                    obj[key] = new JObject();
                }
                else if (IsArrayHeader(next.Content, out var nestedArray) && string.IsNullOrEmpty(nestedArray.Key))
                {
                    obj[key] = ParseArray(state, indentLevel + 1, false);
                }
                else
                {
                    obj[key] = ParseObject(state, indentLevel + 1);
                }
            }
            else
            {
                obj[key] = ParseScalar(remainder.TrimStart(), state.Options.Delimiter);
            }
        }

        return obj;
    }

    private static JArray ParseArray(State state, int expectedIndent, bool keyedHeader)
    {
        var headerLine = state.Peek() ?? throw new ToonParseException("Unexpected end while parsing array.");
        if (headerLine.IndentLevel != expectedIndent)
        {
            throw new ToonParseException($"Array header indentation mismatch at line {headerLine.LineNumber}.");
        }

        if (!IsArrayHeader(headerLine.Content, out var header))
        {
            throw new ToonParseException($"Invalid array header at line {headerLine.LineNumber}.");
        }

        if (keyedHeader && string.IsNullOrWhiteSpace(header.Key))
        {
            throw new ToonParseException($"Expected keyed array header at line {headerLine.LineNumber}.");
        }

        if (!keyedHeader && !string.IsNullOrWhiteSpace(header.Key))
        {
            throw new ToonParseException($"Root or nested list array header should not contain key at line {headerLine.LineNumber}.");
        }

        state.Advance();
        var result = new JArray();
        if (header.Fields.Count > 0)
        {
            ParseTabularRows(state, header, expectedIndent + 1, result);
            return result;
        }

        if (!string.IsNullOrWhiteSpace(header.Tail))
        {
            ParseInlinePrimitiveValues(header.Tail, header.Delimiter, result);
            ValidateCount(result.Count, header.Count, headerLine.LineNumber, state.Options.StrictDecoding);
            return result;
        }

        ParseListArray(state, expectedIndent + 1, header.Count, result);
        return result;
    }

    private static void ParseTabularRows(State state, ArrayHeader header, int rowIndent, JArray result)
    {
        while (!state.IsComplete)
        {
            var line = state.Peek()!;
            if (line.IndentLevel < rowIndent) break;
            if (line.IndentLevel > rowIndent)
            {
                throw new ToonParseException($"Unexpected tabular row indentation at line {line.LineNumber}.");
            }

            var values = SplitDelimited(line.Content, header.Delimiter);
            if (values.Count != header.Fields.Count)
            {
                throw new ToonParseException(
                    $"Tabular row at line {line.LineNumber} has {values.Count} values but expected {header.Fields.Count}.");
            }

            var row = new JObject();
            for (var i = 0; i < header.Fields.Count; i++)
            {
                row[DecodeKey(header.Fields[i])] = ParseScalar(values[i], header.Delimiter);
            }

            result.Add(row);
            state.Advance();
        }

        ValidateCount(result.Count, header.Count, state.LastLineNumber, state.Options.StrictDecoding);
    }

    private static void ParseInlinePrimitiveValues(string tail, char delimiter, JArray result)
    {
        var values = SplitDelimited(tail, delimiter);
        foreach (var value in values)
        {
            result.Add(ParseScalar(value, delimiter));
        }
    }

    private static void ParseListArray(State state, int itemIndent, int expectedCount, JArray result)
    {
        while (!state.IsComplete)
        {
            var line = state.Peek()!;
            if (line.IndentLevel < itemIndent) break;
            if (line.IndentLevel > itemIndent || !line.Content.StartsWith("-"))
            {
                throw new ToonParseException($"Expected list item at line {line.LineNumber}.");
            }

            var item = ParseListItem(state, itemIndent);
            result.Add(item);
        }

        ValidateCount(result.Count, expectedCount, state.LastLineNumber, state.Options.StrictDecoding);
    }

    private static JToken ParseListItem(State state, int itemIndent)
    {
        var line = state.Peek() ?? throw new ToonParseException("Expected list item.");
        var trimmed = line.Content;
        if (!trimmed.StartsWith("-"))
        {
            throw new ToonParseException($"Expected '-' list marker at line {line.LineNumber}.");
        }

        var afterDash = trimmed.Length == 1 ? string.Empty : trimmed[1..].TrimStart();
        state.Advance();

        if (string.IsNullOrEmpty(afterDash))
        {
            var next = state.Peek();
            if (next is null || next.IndentLevel <= itemIndent)
            {
                return JValue.CreateNull();
            }

            if (IsArrayHeader(next.Content, out var nested) && string.IsNullOrEmpty(nested.Key))
            {
                return ParseArray(state, itemIndent + 1, false);
            }

            return ParseObject(state, itemIndent + 1);
        }

        if (IsArrayHeader(afterDash, out var inlineHeader) && string.IsNullOrWhiteSpace(inlineHeader.Key))
        {
            var synthetic = new ParsedLine(line.LineNumber, itemIndent, afterDash);
            state.PushSynthetic(synthetic);
            return ParseArray(state, itemIndent, false);
        }

        if (IsArrayHeader(afterDash, out var keyedInlineHeader) && !string.IsNullOrWhiteSpace(keyedInlineHeader.Key))
        {
            var obj = new JObject();
            var synthetic = new ParsedLine(line.LineNumber, itemIndent + 1, afterDash);
            state.PushSynthetic(synthetic);
            obj[DecodeKey(keyedInlineHeader.Key)] = ParseArray(state, itemIndent + 1, true);

            while (!state.IsComplete)
            {
                var next = state.Peek()!;
                if (next.IndentLevel <= itemIndent) break;
                if (next.IndentLevel != itemIndent + 1)
                {
                    throw new ToonParseException($"Unexpected indentation for list item object at line {next.LineNumber}.");
                }

                if (IsArrayHeader(next.Content, out var header) && !string.IsNullOrWhiteSpace(header.Key))
                {
                    var parsed = ParseArray(state, itemIndent + 1, true);
                    obj[DecodeKey(header.Key)] = parsed;
                    continue;
                }

                var (rawNestedKey, nestedRemainder) = SplitAtFirstColon(next.Content);
                var nestedKey = DecodeKey(rawNestedKey.Trim());
                state.Advance();
                if (string.IsNullOrWhiteSpace(nestedRemainder))
                {
                    var probe = state.Peek();
                    if (probe is null || probe.IndentLevel <= itemIndent + 1)
                    {
                        obj[nestedKey] = new JObject();
                    }
                    else
                    {
                        obj[nestedKey] = ParseObject(state, itemIndent + 2);
                    }
                }
                else
                {
                    obj[nestedKey] = ParseScalar(nestedRemainder.TrimStart(), state.Options.Delimiter);
                }
            }

            return obj;
        }

        if (afterDash.Contains(':'))
        {
            var (rawKey, remainder) = SplitAtFirstColon(afterDash);
            var obj = new JObject();
            var key = DecodeKey(rawKey.Trim());
            if (string.IsNullOrWhiteSpace(remainder))
            {
                var next = state.Peek();
                if (next is null || next.IndentLevel <= itemIndent)
                {
                    obj[key] = new JObject();
                }
                else
                {
                    obj[key] = ParseObject(state, itemIndent + 1);
                }
            }
            else
            {
                obj[key] = ParseScalar(remainder.TrimStart(), state.Options.Delimiter);
            }

            while (!state.IsComplete)
            {
                var next = state.Peek()!;
                if (next.IndentLevel <= itemIndent) break;
                if (next.IndentLevel != itemIndent + 1)
                {
                    throw new ToonParseException($"Unexpected indentation for list item object at line {next.LineNumber}.");
                }

                if (IsArrayHeader(next.Content, out var header) && !string.IsNullOrWhiteSpace(header.Key))
                {
                    var parsed = ParseArray(state, itemIndent + 1, true);
                    obj[DecodeKey(header.Key)] = parsed;
                    continue;
                }

                var (rawNestedKey, nestedRemainder) = SplitAtFirstColon(next.Content);
                var nestedKey = DecodeKey(rawNestedKey.Trim());
                state.Advance();
                if (string.IsNullOrWhiteSpace(nestedRemainder))
                {
                    var probe = state.Peek();
                    if (probe is null || probe.IndentLevel <= itemIndent + 1)
                    {
                        obj[nestedKey] = new JObject();
                    }
                    else
                    {
                        obj[nestedKey] = ParseObject(state, itemIndent + 2);
                    }
                }
                else
                {
                    obj[nestedKey] = ParseScalar(nestedRemainder.TrimStart(), state.Options.Delimiter);
                }
            }

            return obj;
        }

        return ParseScalar(afterDash, state.Options.Delimiter);
    }

    private static JValue ParseScalar(string token, char delimiter)
    {
        if (token.StartsWith("\""))
        {
            return new JValue(ParseQuoted(token));
        }

        var trimmed = token.Trim();
        if (trimmed == "null") return JValue.CreateNull();
        if (trimmed == "true") return new JValue(true);
        if (trimmed == "false") return new JValue(false);

        if (IntegerRegex.IsMatch(trimmed) &&
            long.TryParse(trimmed, NumberStyles.Integer, CultureInfo.InvariantCulture, out var asInt))
        {
            return new JValue(asInt);
        }

        if (FloatRegex.IsMatch(trimmed) &&
            double.TryParse(trimmed, NumberStyles.Float, CultureInfo.InvariantCulture, out var asDouble))
        {
            return new JValue(asDouble);
        }

        if (trimmed.Contains(delimiter))
        {
            throw new ToonParseException($"Unexpected delimiter '{delimiter}' in scalar token '{token}'.");
        }

        return new JValue(trimmed);
    }

    private static string ParseQuoted(string token)
    {
        if (token.Length < 2 || token[^1] != '"')
        {
            throw new ToonParseException($"Invalid quoted string token '{token}'.");
        }

        var sb = new StringBuilder();
        for (var i = 1; i < token.Length - 1; i++)
        {
            var ch = token[i];
            if (ch != '\\')
            {
                sb.Append(ch);
                continue;
            }

            if (i + 1 >= token.Length - 1)
            {
                throw new ToonParseException("Invalid trailing escape sequence.");
            }

            var next = token[++i];
            _ = next switch
            {
                '\\' => sb.Append('\\'),
                '"' => sb.Append('"'),
                'n' => sb.Append('\n'),
                'r' => sb.Append('\r'),
                't' => sb.Append('\t'),
                _ => throw new ToonParseException($"Unsupported escape sequence '\\{next}'.")
            };
        }

        return sb.ToString();
    }

    private static (string key, string remainder) SplitAtFirstColon(string content)
    {
        var inQuotes = false;
        var escaped = false;
        for (var i = 0; i < content.Length; i++)
        {
            var ch = content[i];
            if (escaped)
            {
                escaped = false;
                continue;
            }

            if (ch == '\\')
            {
                escaped = true;
                continue;
            }

            if (ch == '"')
            {
                inQuotes = !inQuotes;
                continue;
            }

            if (!inQuotes && ch == ':')
            {
                var key = content[..i];
                var remainder = i + 1 < content.Length ? content[(i + 1)..] : string.Empty;
                return (key, remainder);
            }
        }

        throw new ToonParseException($"Unable to locate ':' separator in '{content}'.");
    }

    private static List<string> SplitDelimited(string input, char delimiter)
    {
        var result = new List<string>();
        var sb = new StringBuilder();
        var inQuotes = false;
        var escaped = false;
        for (var i = 0; i < input.Length; i++)
        {
            var ch = input[i];
            if (escaped)
            {
                sb.Append('\\');
                sb.Append(ch);
                escaped = false;
                continue;
            }

            if (ch == '\\')
            {
                escaped = true;
                continue;
            }

            if (ch == '"')
            {
                inQuotes = !inQuotes;
                sb.Append(ch);
                continue;
            }

            if (!inQuotes && ch == delimiter)
            {
                result.Add(sb.ToString().Trim());
                sb.Clear();
                continue;
            }

            sb.Append(ch);
        }

        if (escaped)
        {
            throw new ToonParseException("Unexpected trailing escape in delimited value.");
        }

        if (inQuotes)
        {
            throw new ToonParseException("Unterminated quote in delimited value.");
        }

        result.Add(sb.ToString().Trim());
        return result;
    }

    private static bool IsArrayHeader(string content, out ArrayHeader header)
    {
        var match = HeaderRegex.Match(content);
        if (!match.Success)
        {
            header = default;
            return false;
        }

        var key = match.Groups["key"].Value;
        var count = int.Parse(match.Groups["count"].Value, CultureInfo.InvariantCulture);
        var delimGroup = match.Groups["delim"].Value;
        var delimiter = delimGroup.Length == 0 ? ',' : delimGroup[0];
        var fieldsRaw = match.Groups["fields"].Value;
        var fields = fieldsRaw.Length == 0
            ? []
            : SplitDelimited(fieldsRaw, delimiter);
        var tail = match.Groups["tail"].Value;
        header = new ArrayHeader(key, count, delimiter, fields, tail);
        return true;
    }

    private static string DecodeKey(string keyToken)
    {
        var trimmed = keyToken.Trim();
        if (trimmed.StartsWith("\""))
        {
            return ParseQuoted(trimmed);
        }

        return trimmed;
    }

    private static List<ParsedLine> ParseLines(string toon, ToonOptions options)
    {
        var rows = toon.Replace("\r\n", "\n").Split('\n');
        var result = new List<ParsedLine>();
        for (var i = 0; i < rows.Length; i++)
        {
            var raw = rows[i];
            if (string.IsNullOrWhiteSpace(raw)) continue;

            var (leadingSpaces, leadingWhitespaceLength, hasLeadingTab) = AnalyzeLeadingWhitespace(raw);
            if (options.StrictDecoding && hasLeadingTab)
            {
                throw new ToonParseException($"Tabs are not allowed in indentation in strict mode at line {i + 1}.");
            }

            if (options.StrictDecoding && leadingSpaces % options.IndentSize != 0)
            {
                throw new ToonParseException(
                    $"Indentation must align to {options.IndentSize} spaces at line {i + 1}.");
            }

            var indentLevel = leadingSpaces / options.IndentSize;
            var content = raw[leadingWhitespaceLength..];
            result.Add(new ParsedLine(i + 1, indentLevel, content));
        }

        return result;
    }

    private static (int leadingSpaces, int leadingWhitespaceLength, bool hasLeadingTab)
        AnalyzeLeadingWhitespace(string line)
    {
        var leadingSpaces = 0;
        var leadingWhitespaceLength = 0;
        var hasLeadingTab = false;
        while (leadingWhitespaceLength < line.Length)
        {
            var ch = line[leadingWhitespaceLength];
            if (ch == ' ')
            {
                leadingSpaces++;
                leadingWhitespaceLength++;
                continue;
            }

            if (ch == '\t')
            {
                hasLeadingTab = true;
                leadingWhitespaceLength++;
                continue;
            }

            break;
        }

        return (leadingSpaces, leadingWhitespaceLength, hasLeadingTab);
    }

    private static void ValidateCount(int actual, int expected, int lineNumber, bool strict)
    {
        if (strict && actual != expected)
        {
            throw new ToonParseException($"Array length mismatch at line {lineNumber}: expected {expected}, got {actual}.");
        }
    }

    private static void EnsureComplete(State state)
    {
        if (!state.IsComplete)
        {
            var line = state.Peek()!;
            throw new ToonParseException($"Unexpected trailing content at line {line.LineNumber}.");
        }
    }

    private sealed record ParsedLine(int LineNumber, int IndentLevel, string Content);

    private readonly record struct ArrayHeader(
        string Key,
        int Count,
        char Delimiter,
        List<string> Fields,
        string Tail
    );

    private sealed class State(List<ParsedLine> lines, ToonOptions options)
    {
        private readonly Stack<ParsedLine> _synthetic = new();
        private int _index;

        public ToonOptions Options { get; } = options;
        public int LastLineNumber => this._index > 0 ? lines[Math.Min(this._index - 1, lines.Count - 1)].LineNumber : 1;
        public bool IsComplete => this._index >= lines.Count && this._synthetic.Count == 0;

        public ParsedLine? Peek()
        {
            if (this._synthetic.Count > 0) return this._synthetic.Peek();
            if (this._index >= lines.Count) return null;
            return lines[this._index];
        }

        public void Advance()
        {
            if (this._synthetic.Count > 0)
            {
                _ = this._synthetic.Pop();
                return;
            }

            this._index++;
        }

        public void PushSynthetic(ParsedLine line) => this._synthetic.Push(line);
    }
}
