using Newtonsoft.Json;
using Newtonsoft.Json.Linq;
using Pe.StorageRuntime.Json.ContractResolvers;
using Pe.StorageRuntime.Revit.Core.Json;
using Pe.StorageRuntime.Revit.Core.Json.ContractResolvers;

namespace Pe.Tools.Tests;

public sealed class JsonContractResolverTests {
    [Test]
    public async Task OrderedResolver_PreservesExtensionData_AndBaseBeforeDerivedOrder() {
        var model = new DerivedOrderedModel {
            BaseProperty = "base",
            DerivedProperty = "derived",
            ExtensionData = new Dictionary<string, JToken> {
                ["ExtraKey"] = JToken.FromObject("extra")
            }
        };

        var json = JsonConvert.SerializeObject(
            model,
            Formatting.None,
            new JsonSerializerSettings {
                ContractResolver = new OrderedContractResolver()
            }
        );

        var propertyNames = JObject.Parse(json).Properties().Select(property => property.Name).ToList();

        await Assert.That(propertyNames).IsEquivalentTo(["BaseProperty", "DerivedProperty", "ExtraKey"]);
        await Assert.That(propertyNames[0]).IsEqualTo("BaseProperty");
        await Assert.That(propertyNames[1]).IsEqualTo("DerivedProperty");
        await Assert.That(propertyNames[2]).IsEqualTo("ExtraKey");
    }

    [Test]
    public async Task RequiredAwareResolver_IncludesRequiredNull_WhenGlobalNullHandlingIgnoresNulls() {
        var json = JsonConvert.SerializeObject(
            new RequiredAwareModel(),
            Formatting.None,
            new JsonSerializerSettings {
                ContractResolver = new RequiredAwareContractResolver(),
                NullValueHandling = NullValueHandling.Ignore
            }
        );

        var root = JObject.Parse(json);

        await Assert.That(root.ContainsKey(nameof(RequiredAwareModel.RequiredName))).IsTrue();
        await Assert.That(root[nameof(RequiredAwareModel.RequiredName)]?.Type).IsEqualTo(JTokenType.Null);
        await Assert.That(root.ContainsKey(nameof(RequiredAwareModel.OptionalName))).IsFalse();
    }

    [Test]
    public async Task RevitTypeResolver_InitializesRegistry_OnDirectSerialization() {
        RevitTypeRegistry.Clear();

        var json = JsonConvert.SerializeObject(
            new RevitCategoryModel(),
            Formatting.None,
            new JsonSerializerSettings {
                ContractResolver = new RevitTypeContractResolver(),
                NullValueHandling = NullValueHandling.Include
            }
        );

        var root = JObject.Parse(json);

        await Assert.That(root.ContainsKey(nameof(RevitCategoryModel.Category))).IsTrue();
        await Assert.That(root[nameof(RevitCategoryModel.Category)]?.Type).IsEqualTo(JTokenType.Null);
    }

    private class BaseOrderedModel {
        public string BaseProperty { get; init; } = string.Empty;
    }

    private sealed class DerivedOrderedModel : BaseOrderedModel {
        public string DerivedProperty { get; init; } = string.Empty;

        [JsonExtensionData]
        public IDictionary<string, JToken> ExtensionData { get; init; } = new Dictionary<string, JToken>();
    }

    private sealed class RequiredAwareModel {
        [System.ComponentModel.DataAnnotations.Required]
        public string? RequiredName { get; init; }

        public string? OptionalName { get; init; }
    }

    private sealed class RevitCategoryModel {
        public BuiltInCategory Category { get; init; } = BuiltInCategory.INVALID;
    }
}
