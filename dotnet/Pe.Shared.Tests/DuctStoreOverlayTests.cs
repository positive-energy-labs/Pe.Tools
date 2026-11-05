using System.Collections;
using System.Reflection;
using Pe.Shared.RevitData.Ducts;

namespace Pe.Revit.Tests;

/// <summary>
///     K3: the loss store overlays per key. Every keyed map on <see cref="DuctLossStore" /> is discovered, not listed,
///     so a map added later is covered or this fails. A sparse request changing one key keeps every stored sentinel;
///     only an explicit delete removes one.
/// </summary>
[TestFixture]
public sealed class DuctStoreOverlayTests {
    private static IEnumerable<PropertyInfo> Maps() => typeof(DuctLossStore).GetProperties()
        .Where(p => p.PropertyType.IsGenericType && p.PropertyType.GetGenericTypeDefinition() == typeof(Dictionary<,>)
                    && p.Name != nameof(DuctLossStore.Unknown));

    [Test]
    public void Every_store_map_is_a_DuctStoreDeletes_key_so_none_can_only_be_replaced_whole() {
        var deletable = typeof(DuctStoreDeletes).GetProperties().Select(p => p.Name).ToHashSet();
        var maps = Maps().Select(p => p.Name).ToList();
        Assert.That(maps, Is.SubsetOf(deletable));
        Assert.That(maps, Has.Count.EqualTo(7));
    }

    [TestCaseSource(nameof(MapNames))]
    public void A_sparse_request_keeps_every_unstaged_sentinel_and_deletes_only_what_it_names(string map) {
        var property = typeof(DuctLossStore).GetProperty(map)!;
        var key = property.PropertyType.GetGenericArguments()[0];
        var value = property.PropertyType.GetGenericArguments()[1];
        object K(int n) => key == typeof(string) ? $"k{n}" : (object)(long)n;
        object V(string tag) => Activator.CreateInstance(value, value.GetConstructors()[0].GetParameters()
            .Select(p => p.ParameterType == typeof(string) ? tag : p.ParameterType == typeof(double) ? 1.0
                : p.ParameterType == typeof(DateTimeOffset) ? DateTimeOffset.UnixEpoch : p.ParameterType.IsValueType ? Activator.CreateInstance(p.ParameterType) : null)
            .ToArray())!;
        var stored = (IDictionary)Activator.CreateInstance(property.PropertyType)!;
        for (var n = 1; n <= 3; n++) stored[K(n)] = V($"stored-{n}");
        var asked = (IDictionary)Activator.CreateInstance(property.PropertyType)!;
        asked[K(2)] = V("changed-2");
        var deletes = Array.CreateInstance(key, 1);
        deletes.SetValue(K(3), 0);

        var overlay = typeof(DuctLossStore).GetMethod(nameof(DuctLossStore.Overlay))!.MakeGenericMethod(key, value);
        var next = (IDictionary)overlay.Invoke(null, [stored, asked, deletes, null])!;
        Assert.Multiple(() => {
            Assert.That(next[K(1)], Is.EqualTo(stored[K(1)]), "an unstaged stored key survives");
            Assert.That(next[K(2)], Is.EqualTo(asked[K(2)]), "the staged key takes the request's entry");
            Assert.That(next.Contains(K(3)), Is.False, "an explicit delete removes only the named key");
            Assert.That(next.Count, Is.EqualTo(2));
        });
        var omitted = (IDictionary)overlay.Invoke(null, [stored, null, null, null])!;
        Assert.That(omitted.Count, Is.EqualTo(3), "omission is never deletion");
    }

    private static IEnumerable<string> MapNames() => Maps().Select(p => p.Name);
}
