using System.Text.Json;

namespace Pe.Host.Tray;

/** Validates the embedded JSON schema projected from host-contracts/native-adapter.ts. */
internal static class NativeAdapterContract {
    private static readonly JsonDocument Contract = Load();

    private static JsonDocument Load() {
        using var stream = typeof(NativeAdapterContract).Assembly.GetManifestResourceStream("Pe.Host.Tray.NativeAdapter.schema.json")
            ?? throw new InvalidOperationException("Native adapter schema is missing.");
        var contract = JsonDocument.Parse(stream);
        CheckSchema(contract.RootElement);
        return contract;
    }

    private static void CheckSchema(JsonElement schema) {
        if (schema.ValueKind is JsonValueKind.True or JsonValueKind.False) return;
        foreach (var keyword in schema.EnumerateObject()) {
            switch (keyword.Name) {
                case "$schema": case "$ref": case "type": case "const": case "enum": case "required":
                case "minimum": case "maximum": case "minLength": break;
                case "properties": case "$defs":
                    foreach (var property in keyword.Value.EnumerateObject()) CheckSchema(property.Value);
                    break;
                case "oneOf": case "anyOf":
                    foreach (var item in keyword.Value.EnumerateArray()) CheckSchema(item);
                    break;
                case "items": case "additionalProperties": case "propertyNames": CheckSchema(keyword.Value); break;
                default: throw new InvalidOperationException($"Unsupported native schema keyword: {keyword.Name}");
            }
        }
    }

    internal static bool Accepts(string direction, JsonElement value) =>
        Contract.RootElement.GetProperty("properties").TryGetProperty(direction, out var schema) && Matches(schema, value);

    private static bool Matches(JsonElement schema, JsonElement value) {
        if (schema.ValueKind == JsonValueKind.True) return true;
        if (schema.ValueKind != JsonValueKind.Object) return false;
        if (schema.TryGetProperty("$ref", out var reference)) {
            var target = Contract.RootElement;
            foreach (var part in reference.GetString()![2..].Split('/')) target = target.GetProperty(part);
            return Matches(target, value);
        }
        if (schema.TryGetProperty("oneOf", out var one)) return one.EnumerateArray().Count(s => Matches(s, value)) == 1;
        if (schema.TryGetProperty("anyOf", out var any)) return any.EnumerateArray().Any(s => Matches(s, value));
        if (schema.TryGetProperty("const", out var constant) && !Same(constant, value)) return false;
        if (schema.TryGetProperty("enum", out var choices) && !choices.EnumerateArray().Any(c => Same(c, value))) return false;
        if (schema.TryGetProperty("type", out var type)) {
            var valid = type.GetString() switch {
                "object" => value.ValueKind == JsonValueKind.Object,
                "array" => value.ValueKind == JsonValueKind.Array,
                "string" => value.ValueKind == JsonValueKind.String,
                "boolean" => value.ValueKind is JsonValueKind.True or JsonValueKind.False,
                "null" => value.ValueKind == JsonValueKind.Null,
                "number" => value.ValueKind == JsonValueKind.Number && value.TryGetDouble(out var number) && double.IsFinite(number),
                "integer" => value.ValueKind == JsonValueKind.Number && value.TryGetDouble(out var integer) && double.IsFinite(integer) && Math.Truncate(integer) == integer,
                _ => false
            };
            if (!valid) return false;
        }
        if (value.ValueKind == JsonValueKind.String && schema.TryGetProperty("minLength", out var length)
            && value.GetString()!.Length < length.GetInt32()) return false;
        if (value.ValueKind == JsonValueKind.Number) {
            var number = value.GetDouble();
            if (schema.TryGetProperty("minimum", out var minimum) && number < minimum.GetDouble()) return false;
            if (schema.TryGetProperty("maximum", out var maximum) && number > maximum.GetDouble()) return false;
        }
        if (value.ValueKind == JsonValueKind.Array && schema.TryGetProperty("items", out var items))
            return value.EnumerateArray().All(item => Matches(items, item));
        if (value.ValueKind != JsonValueKind.Object) return true;
        if (schema.TryGetProperty("required", out var required)
            && required.EnumerateArray().Any(key => !value.TryGetProperty(key.GetString()!, out _))) return false;
        schema.TryGetProperty("properties", out var properties);
        schema.TryGetProperty("additionalProperties", out var additional);
        schema.TryGetProperty("propertyNames", out var names);
        foreach (var property in value.EnumerateObject()) {
            if (names.ValueKind != JsonValueKind.Undefined && !Matches(names, JsonSerializer.SerializeToElement(property.Name))) return false;
            if (properties.ValueKind == JsonValueKind.Object && properties.TryGetProperty(property.Name, out var propertySchema)) {
                if (!Matches(propertySchema, property.Value)) return false;
            } else if (additional.ValueKind != JsonValueKind.Undefined && !Matches(additional, property.Value)) return false;
        }
        return true;
    }

    private static bool Same(JsonElement expected, JsonElement value) =>
        expected.ValueKind == value.ValueKind && (expected.ValueKind == JsonValueKind.String
            ? expected.GetString() == value.GetString() : expected.GetRawText() == value.GetRawText());

    internal static string SerializeNative<T>(T value) {
        var json = JsonSerializer.SerializeToElement(value);
        if (!Accepts("native", json)) throw new InvalidOperationException("Invalid native adapter event.");
        return json.GetRawText();
    }
}
