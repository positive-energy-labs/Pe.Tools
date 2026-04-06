using Pe.StorageRuntime.Json;

namespace Pe.StorageRuntime;

public sealed class Csv<T>(string filePath) : CsvReadWriter<T> where T : class, new() {
    public string FilePath { get; } = Initialize(filePath);

    public Dictionary<string, T> Read() {
        try {
            if (!File.Exists(this.FilePath))
                return [];

            var lines = File.ReadAllLines(this.FilePath);
            if (lines.Length < 2)
                return [];

            var headers = lines[0].Split(',');
            var rows = new Dictionary<string, T>(StringComparer.OrdinalIgnoreCase);

            for (var rowIndex = 1; rowIndex < lines.Length; rowIndex++) {
                var values = lines[rowIndex].Split(',');
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
        } catch {
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
            var lines = new List<string> { string.Join(",", new[] { "Key" }.Concat(properties.Select(property => property.Name))) };

            foreach (var entry in data) {
                var values = new List<string> { entry.Key };
                values.AddRange(properties.Select(property => property.GetValue(entry.Value)?.ToString() ?? string.Empty));
                lines.Add(string.Join(",", values));
            }

            File.WriteAllLines(this.FilePath, lines);
            return this.FilePath;
        } catch {
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
        } catch {
            return null;
        }
    }
}
