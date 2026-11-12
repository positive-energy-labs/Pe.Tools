using Pe.Shared.StorageRuntime.Json;
using Serilog;
using System.Text;

namespace Pe.Shared.StorageRuntime;

public sealed class Csv<T>(string filePath, string place) : CsvReadWriter<T> where T : class, new() {
    public string FilePath { get; } = Initialize(filePath);

    public Dictionary<string, T> Read() {
        try {
            if (!File.Exists(this.FilePath))
                return [];

            var lines = Parse(File.ReadAllText(this.FilePath));
            if (lines.Count == 0 || lines[0][0] != "Key")
                throw new InvalidDataException("Invalid CSV header");

            var headers = lines[0];
            var rows = new Dictionary<string, T>(StringComparer.OrdinalIgnoreCase);

            for (var rowIndex = 1; rowIndex < lines.Count; rowIndex++) {
                var values = lines[rowIndex];
                if (values.Length != headers.Length) throw new InvalidDataException("Invalid CSV row");
                if (values.Length == 0 || string.IsNullOrWhiteSpace(values[0]))
                    continue;

                var key = values[0];
                var row = new T();

                for (var valueIndex = 1; valueIndex < headers.Length && valueIndex < values.Length; valueIndex++) {
                    var property = typeof(T).GetProperty(headers[valueIndex]);
                    if (property == null || !property.CanWrite)
                        continue;

                    var convertedValue = ConvertValue(values[valueIndex], property.PropertyType);
                    if (convertedValue != null)
                        property.SetValue(row, convertedValue);
                }

                rows[key] = row;
            }

            return rows;
        } catch (Exception exception) when (exception is IOException && exception is not InvalidDataException || exception is UnauthorizedAccessException) {
            Log.Warning(exception, "Could not read {Place} at {Path}", place, this.FilePath);
            return [];
        } catch (Exception exception) {
            StoredFile.Refuse(this.FilePath, StoredPolicy.Discard, place, exception);
            return [];
        }
    }

    public T? ReadRow(string key) {
        var rows = this.Read();
        return rows.TryGetValue(key, out var value) ? value : null;
    }

    public string Write(Dictionary<string, T> data) {
        try {
            if (data.Count == 0)
                return string.Empty;

            StorageFileUtils.EnsureDirectoryExists(this.FilePath);
            var properties = typeof(T).GetProperties().Where(property => property.CanRead).ToList();
            var lines = new List<string> {
                string.Join(",", new[] { "Key" }.Concat(properties.Select(property => property.Name)).Select(Quote))
            };

            foreach (var entry in data) {
                var values = new List<string> { entry.Key };
                values.AddRange(
                    properties.Select(property => property.GetValue(entry.Value)?.ToString() ?? string.Empty));
                lines.Add(string.Join(",", values.Select(Quote)));
            }

            StoredFile.WriteAtomic(this.FilePath, System.Text.Encoding.UTF8.GetBytes(string.Join(Environment.NewLine, lines) + Environment.NewLine), overwrite: true);
            return this.FilePath;
        } catch (Exception exception) {
            Log.Warning(exception, "Could not write {Place} at {Path}", place, this.FilePath);
            return string.Empty;
        }
    }

    public string WriteRow(string key, T rowData) {
        var rows = this.Read();
        rows[key] = rowData;
        return this.Write(rows);
    }

    private static string Initialize(string filePath) {
        StorageFileUtils.ValidateFileNameAndExtension(filePath, ".csv");
        StorageFileUtils.EnsureDirectoryExists(filePath);
        return filePath;
    }

    private static string Quote(string value) => value.IndexOfAny([',', '"', '\r', '\n']) < 0
        ? value : "\"" + value.Replace("\"", "\"\"") + "\"";

    private static List<string[]> Parse(string text) {
        var rows = new List<string[]>();
        var fields = new List<string>();
        var field = new StringBuilder();
        var quoted = false;
        var closed = false;
        void EndField() { fields.Add(field.ToString()); field.Clear(); closed = false; }
        for (var index = 0; index < text.Length; index++) {
            var character = text[index];
            if (quoted) {
                if (character != '"') field.Append(character);
                else if (index + 1 < text.Length && text[index + 1] == '"') { field.Append('"'); index++; }
                else { quoted = false; closed = true; }
            } else if (character == ',') EndField();
            else if (character is '\r' or '\n') {
                EndField(); rows.Add(fields.ToArray()); fields.Clear();
                if (character == '\r' && index + 1 < text.Length && text[index + 1] == '\n') index++;
            } else if (character == '"' && field.Length == 0 && !closed) quoted = true;
            else {
                if (closed || character == '"') throw new InvalidDataException("Invalid CSV quote");
                field.Append(character);
            }
        }
        if (quoted) throw new InvalidDataException("Unterminated CSV quote");
        if (field.Length > 0 || closed || fields.Count > 0) { EndField(); rows.Add(fields.ToArray()); }
        return rows;
    }

    private static object? ConvertValue(string value, Type targetType) {
        if (string.IsNullOrEmpty(value))
            return null;

        try {
            if (targetType == typeof(string))
                return value;
            if (targetType == typeof(int))
                return int.Parse(value);
            if (targetType == typeof(long))
                return long.Parse(value);
            if (targetType == typeof(double))
                return double.Parse(value);
            if (targetType == typeof(decimal))
                return decimal.Parse(value);
            if (targetType == typeof(bool))
                return bool.Parse(value);
            if (targetType == typeof(DateTime))
                return DateTime.Parse(value);
            if (targetType == typeof(Guid))
                return Guid.Parse(value);
            if (targetType.IsEnum)
                return Enum.Parse(targetType, value);
            if (targetType.IsGenericType && targetType.GetGenericTypeDefinition() == typeof(Nullable<>)) {
                var underlyingType = Nullable.GetUnderlyingType(targetType);
                return underlyingType == null ? null : ConvertValue(value, underlyingType);
            }

            return null;
        } catch (Exception exception) { throw new InvalidDataException($"Invalid CSV value for {targetType.Name}", exception); }
    }
}
