using System.Reflection;
using Newtonsoft.Json;
using Newtonsoft.Json.Linq;
using Pe.Shared.HostContracts.Operations;
using Pe.Shared.RevitData;
using Pe.Shared.RevitData.Ducts;

namespace Pe.Revit.Tests;

[TestFixture]
public sealed class OpConstructorDefaultsTests {
    [TestCase("{}")]
    [TestCase("""{"componentDrop":"Damper Drop"}""")]
    public void Duct_slot_overrides_preserve_stored_names_before_engine_defaults(string json) {
        var overrides = JsonConvert.DeserializeObject<DuctParameterSlotOverrides>(json, DispatchSettings)!;
        var stored = new DuctParameterSlotOverrides(FanFlow: "PE_M_Fan_AirFlow", TerminalFlow: "revit:Flow");
        var resolved = overrides.Resolve(stored);
        Assert.Multiple(() => {
            Assert.That(resolved.FanFlow, Is.EqualTo("PE_M_Fan_AirFlow"));
            Assert.That(resolved.TerminalFlow, Is.EqualTo("revit:Flow"));
            Assert.That(resolved.ComponentDrop, Is.EqualTo(json == "{}" ? "Pressure Drop" : "Damper Drop"));
        });
    }

    // Use the dispatch settings themselves so this cannot pass with a test-only resolver.
    private static JsonSerializerSettings DispatchSettings => (JsonSerializerSettings)typeof(Op)
        .GetField("JsonSettings", BindingFlags.NonPublic | BindingFlags.Static)!.GetValue(null)!;

    private static IEnumerable<TestCaseData> CatalogRequests() {
        var source = File.ReadAllText(Path.Combine(TestContext.CurrentContext.TestDirectory, "host-catalog.generated.ts"));
        var catalog = JArray.Parse(source[(source.IndexOf(" = [", StringComparison.Ordinal) + 3)..].Trim().TrimEnd(';'));
        var types = new[] { typeof(Op).Assembly, typeof(RevitElementHandle).Assembly, typeof(Pe.Revit.Space.SceneRequest).Assembly, Assembly.Load("Pe.Revit.Global") }
            .SelectMany(ContractTypes).ToArray();
        foreach (var op in catalog) {
            var name = (string)JObject.Parse((string)op["requestSchemaJson"]!)["title"]!;
            var type = types.SingleOrDefault(candidate => candidate.Name == name)
                ?? throw new InvalidOperationException($"Catalog request {name} ({op["key"]}) is not loaded.");
            var constructor = type.GetConstructors().OrderByDescending(c => c.GetParameters().Length).FirstOrDefault();
            if (constructor?.GetParameters().Any(p => p.HasDefaultValue) == true)
                yield return new TestCaseData(type, constructor).SetName($"Constructor_defaults_{op["key"]}");
        }
    }

    private static IEnumerable<Type> ContractTypes(Assembly assembly) {
        try { return assembly.GetTypes(); }
        // Space also contains Revit implementations; load its portable DTOs without RevitAPI.
        // Catalog lookup below still fails if any request type is unavailable.
        catch (ReflectionTypeLoadException exception) { return exception.Types.OfType<Type>(); }
    }

    [TestCaseSource(nameof(CatalogRequests))]
    public void Omitted_optional_fields_use_constructor_defaults(Type type, ConstructorInfo constructor) {
        var serializer = JsonSerializer.Create(DispatchSettings);
        var parameters = constructor.GetParameters();
        var required = new JObject();
        foreach (var parameter in parameters.Where(p => !p.HasDefaultValue)) {
            var value = RequiredValue(parameter.ParameterType);
            required[parameter.Name!] = value == null ? JValue.CreateNull() : JToken.FromObject(value, serializer);
        }
        var actual = required.ToObject(type, serializer)!;
        Assert.Multiple(() => {
            foreach (var parameter in parameters.Where(p => p.HasDefaultValue)) {
                var property = type.GetProperty(parameter.Name!, BindingFlags.Public | BindingFlags.Instance | BindingFlags.IgnoreCase)!;
                var expected = parameter.DefaultValue;
                if (expected != null && parameter.ParameterType.IsEnum)
                    expected = Enum.ToObject(parameter.ParameterType, expected);
                Assert.That(property.GetValue(actual), Is.EqualTo(expected), $"{type.Name}.{parameter.Name}");
            }
        });
    }

    private sealed record DefaultsProbe(int Count = 9, bool Enabled = true, string Label = "label",
        OpTier Tier = OpTier.Expert, DefaultsProbe? Nested = null);

    [Op("test.constructor-defaults", OpSubject.None, OpTouches.Metadata, OpEffect.Read, Does = "Echo bound constructor defaults.")]
    private static DefaultsProbe Echo(DefaultsProbe request) => request;

    [Test]
    public async Task Dispatch_populates_nested_defaults_and_preserves_explicit_values() {
        OpRegistry.RegisterFrom(typeof(OpConstructorDefaultsTests).Assembly);
        Assert.That(OpRegistry.TryGet("test.constructor-defaults", out var op), Is.True);
        var omitted = await op.ExecuteAsync("{}", null, CancellationToken.None);
        Assert.That(omitted, Is.EqualTo(new DefaultsProbe()));
        var supplied = await op.ExecuteAsync(
            """{"count":0,"enabled":false,"label":"","tier":"Default","nested":{}}""",
            null, CancellationToken.None);
        Assert.That(supplied, Is.EqualTo(new DefaultsProbe(0, false, "", OpTier.Default, new DefaultsProbe())));
    }

    private static object? RequiredValue(Type type) {
        if (type == typeof(string)) return "required";
        if (type.IsArray) return Array.CreateInstance(type.GetElementType()!, 0);
        if (type.IsValueType) return Activator.CreateInstance(type);
        if (type.IsGenericType && type.GetGenericTypeDefinition() == typeof(IReadOnlyList<>))
            return Array.CreateInstance(type.GetGenericArguments()[0], 0);
        var constructor = type.GetConstructors().OrderByDescending(c => c.GetParameters().Length).FirstOrDefault();
        return constructor?.Invoke(constructor.GetParameters().Select(p => p.HasDefaultValue ? p.DefaultValue : RequiredValue(p.ParameterType)).ToArray());
    }
}

